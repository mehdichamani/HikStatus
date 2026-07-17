import asyncio
import requests
import xml.etree.ElementTree as ET
import os
from datetime import datetime, timedelta
from requests.auth import HTTPDigestAuth
from sqlmodel import Session, select
from database import engine, NVR, Camera, Log, Settings, DowntimeEvent, UserSession
from alerts import send_email_batch, send_telegram_batch

_broadcast_callback = None

def set_broadcast_callback(callback):
    global _broadcast_callback
    _broadcast_callback = callback

async def broadcast(message):
    if _broadcast_callback:
        await _broadcast_callback(message)

def get_setting(session, key, default):
    s = session.get(Settings, key)
    return s.value if s else default

def sync_camera_names_from_nvr(ip, user, password, session=None):
    from database import decrypt_password
    password = decrypt_password(password)
    parts = ip.split(':')
    host = parts[0]
    port = parts[1] if len(parts) > 1 else '80'
    url = f"http://{host}:{port}/ISAPI/ContentMgmt/InputProxy/channels"
    
    is_local_session = session is None
    db_session = session if session is not None else Session(engine)
    
    try:
        nvr_obj = db_session.exec(select(NVR).where(NVR.ip == ip)).first()
        nvr_name = nvr_obj.name if (nvr_obj and nvr_obj.name) else ip
        
        req_sess = requests.Session()
        req_sess.trust_env = False
        resp = req_sess.get(url, auth=HTTPDigestAuth(user, password), timeout=8, proxies={})
        if resp.status_code == 200:
            root = ET.fromstring(resp.content)
            namespace = {'ns': 'http://www.hikvision.com/ver20/XMLSchema'}
            for channel in root.findall('ns:InputProxyChannel', namespace):
                chan_id = channel.find('ns:id', namespace).text
                name_elem = channel.find('ns:name', namespace)
                chan_name = name_elem.text if name_elem is not None else None
                
                # Fetch port to get the IP address and specs
                port_elem = channel.find('ns:sourceInputPortDescriptor', namespace)
                cam_ip = "0.0.0.0"
                model = None
                if port_elem is not None:
                    ip_node = port_elem.find('ns:ipAddress', namespace)
                    if ip_node is not None:
                        cam_ip = ip_node.text
                    model_node = port_elem.find('ns:model', namespace)
                    if model_node is not None:
                        model = model_node.text
                
                # Fallback to "nvr_name CH channel_id" if name is empty
                final_name = chan_name if chan_name else f"{nvr_name} CH {chan_id}"
                
                # Update database
                db_cam = db_session.exec(select(Camera).where(Camera.nvr_ip == ip, Camera.channel_id == chan_id)).first()
                if db_cam:
                    db_cam.name = final_name
                    # Also update IP if changed
                    if cam_ip and cam_ip != "0.0.0.0":
                        db_cam.ip = cam_ip
                    if model:
                        db_cam.model = model
                    db_session.add(db_cam)
                else:
                    # If it's not in db, we create it
                    new_cam = Camera(
                        name=final_name,
                        ip=cam_ip,
                        nvr_ip=ip,
                        channel_id=chan_id,
                        status="Unknown",
                        model=model
                    )
                    db_session.add(new_cam)
            db_session.commit()
            return True, f"Successfully synced camera names for {nvr_name}"
        else:
            return False, f"Failed to sync {nvr_name}: HTTP {resp.status_code}"
    except Exception as e:
        return False, f"Failed to sync {nvr_name}: {str(e)}"
    finally:
        if is_local_session:
            db_session.close()

def log_event(session, l_type, state, details):
    try:
        session.add(Log(log_type=l_type, state=state, details=details))
        session.commit() 
    except Exception as e:
        print(f"Warning: Failed to log event: {e}")

def cleanup_old_data(session, days=90):
    try:
        cutoff = datetime.now() - timedelta(days=days)
        session.query(Log).filter(Log.timestamp < cutoff).delete()
        session.query(DowntimeEvent).filter(
            DowntimeEvent.end_time < cutoff,
            DowntimeEvent.end_time != None
        ).delete()
        session.query(UserSession).filter(UserSession.expires_at < datetime.now()).delete()
        session.commit()
    except Exception as e:
        print(f"Warning: Failed to cleanup old data: {e}")

def poll_nvr_thread(nvr_data):
    from database import decrypt_password
    ip, user, password = nvr_data
    password = decrypt_password(password)
    url = f"http://{ip}/ISAPI/ContentMgmt/InputProxy/channels/status"
    try:
        # Create a session and strictly disable environment proxy inheritance (Karing)
        session = requests.Session()
        session.trust_env = False 
        resp = session.get(url, auth=HTTPDigestAuth(user, password), timeout=6, proxies={})
        if resp.status_code == 200:
            root = ET.fromstring(resp.content)
            namespace = {'ns': 'http://www.hikvision.com/ver20/XMLSchema'}
            results = []
            for channel in root.findall('ns:InputProxyChannelStatus', namespace):
                chan_id = channel.find('ns:id', namespace).text
                online = channel.find('ns:online', namespace).text == 'true'
                port = channel.find('ns:sourceInputPortDescriptor', namespace)
                cam_ip = port.find('ns:ipAddress', namespace).text if port is not None else "0.0.0.0"
                results.append({"channel_id": chan_id, "ip": cam_ip, "online": online})
            return ("OK", results)
        return ("FAIL", f"HTTP {resp.status_code}")
    except Exception as e:
        return ("FAIL", str(e))

async def process_batch_alerts(session, cams_to_check):
    tele_alerts = []
    mail_alerts = []
    tele_recoveries = []
    mail_recoveries = []
    now = datetime.now()

    # Load Settings
    mail_delay = int(get_setting(session, "MAIL_FIRST_ALERT_DELAY_MINUTES", 1))
    mail_low_delay = int(get_setting(session, "MAIL_LOW_IMPORTANCE_DELAY_MINUTES", 30)) # NEW
    mail_freq = int(get_setting(session, "MAIL_ALERT_FREQUENCY_MINUTES", 60))
    mail_mute = int(get_setting(session, "MAIL_MUTE_AFTER_N_ALERTS", 3))

    tele_delay = int(get_setting(session, "TELEGRAM_FIRST_ALERT_DELAY_MINUTES", 1))
    tele_low_delay = int(get_setting(session, "TELEGRAM_LOW_IMPORTANCE_DELAY_MINUTES", 15)) # NEW
    tele_freq = int(get_setting(session, "TELEGRAM_ALERT_FREQUENCY_MINUTES", 30))
    tele_mute = int(get_setting(session, "TELEGRAM_MUTE_AFTER_N_ALERTS", 3))

    for cam in cams_to_check:
        if cam.status == "Online":
            if cam.telegram_alert_count > 0:
                tele_recoveries.append(f"✅ {cam.name} مجددا متصل شد")
                cam.telegram_alert_count = 0
            if cam.mail_alert_count > 0:
                mail_recoveries.append(f"{cam.name} مجددا متصل شد")
                cam.mail_alert_count = 0
            session.add(cam)
            continue

        downtime = now - (cam.last_online or now)
        downtime_mins = int(downtime.total_seconds() / 60)

        # --- TELEGRAM ---
        send_tele = False
        if cam.telegram_alert_count < tele_mute:
            if cam.telegram_alert_count == 0:
                # Use Low Delay if imp=1, else Normal Delay
                threshold = tele_low_delay if cam.importance == 1 else tele_delay
                if downtime_mins >= threshold: send_tele = True
            else:
                last = cam.telegram_last_alert or now
                if (now - last).total_seconds() / 60 >= tele_freq: send_tele = True
        
        if send_tele:
            msg = f"🚨 دوربین {cam.name} ({downtime_mins}دقیقه)"
            if cam.telegram_alert_count + 1 >= tele_mute: msg += " 🔕(بی صدا)"
            tele_alerts.append(msg)
            cam.telegram_alert_count += 1
            cam.telegram_last_alert = now
            session.add(cam)

        # --- MAIL ---
        send_mail = False
        if cam.mail_alert_count < mail_mute:
            if cam.mail_alert_count == 0:
                threshold = mail_low_delay if cam.importance == 1 else mail_delay
                if downtime_mins >= threshold: send_mail = True
            else:
                last = cam.mail_last_alert or now
                if (now - last).total_seconds() / 60 >= mail_freq: send_mail = True
        
        if send_mail:
            msg = f"{cam.name} قطع به مدت {downtime_mins} دقیقه"
            if cam.mail_alert_count + 1 >= mail_mute: msg += " (بی صدا)"
            mail_alerts.append(msg)
            cam.mail_alert_count += 1
            cam.mail_last_alert = now
            session.add(cam)

    return tele_alerts, mail_alerts, tele_recoveries, mail_recoveries

async def process_nvr_alerts(session, nvr_obj, is_failed, error_message=None):
    now = datetime.now()

    mail_delay = int(get_setting(session, "MAIL_FIRST_ALERT_DELAY_MINUTES", 1))
    mail_freq = int(get_setting(session, "MAIL_ALERT_FREQUENCY_MINUTES", 60))
    mail_mute = int(get_setting(session, "MAIL_MUTE_AFTER_N_ALERTS", 3))

    tele_delay = int(get_setting(session, "TELEGRAM_FIRST_ALERT_DELAY_MINUTES", 1))
    tele_freq = int(get_setting(session, "TELEGRAM_ALERT_FREQUENCY_MINUTES", 30))
    tele_mute = int(get_setting(session, "TELEGRAM_MUTE_AFTER_N_ALERTS", 3))

    nvr_name = nvr_obj.name or nvr_obj.ip

    if not is_failed:
        if nvr_obj.status == "Offline":
            log_event(session, "NVR", "Online", f"{nvr_name} reconnected")
            await broadcast({
                "type": "alert",
                "title": "اتصال مجدد NVR",
                "body": f"اتصال NVR {nvr_name} مجدداً برقرار شد",
                "alert_type": "success"
            })

        nvr_obj.status = "Online"
        nvr_obj.last_online = now

        if nvr_obj.telegram_alert_count > 0:
            res = await asyncio.to_thread(send_telegram_batch, "NVR برگشت", [f"✅ {nvr_name} مجددا متصل شد"], "success", nvr_obj.group_id)
            if res is not True:
                await broadcast({
                    "type": "alert",
                    "title": "خطای ارسال تلگرام (NVR)",
                    "body": f"خطا در ارسال پیام تلگرام برای NVR {nvr_name}: {res}",
                    "alert_type": "warning"
                })
        if nvr_obj.mail_alert_count > 0:
            res = await asyncio.to_thread(send_email_batch, "NVR برگشت", [f"{nvr_name} مجددا متصل شد"], "success", nvr_obj.group_id)
            if res is not True:
                await broadcast({
                    "type": "alert",
                    "title": "خطای ارسال ایمیل (NVR)",
                    "body": f"خطا در ارسال ایمیل برای NVR {nvr_name}: {res}",
                    "alert_type": "warning"
                })

        nvr_obj.telegram_alert_count = 0
        nvr_obj.mail_alert_count = 0
        session.add(nvr_obj)
        return

    if nvr_obj.status != "Offline":
        nvr_obj.status = "Offline"
        nvr_obj.last_online = nvr_obj.last_online or now
        log_event(session, "NVR", "Offline", error_message)
        await broadcast({
            "type": "alert",
            "title": "خطای اتصال NVR",
            "body": f"اتصال NVR {nvr_name} قطع شد: {error_message}",
            "alert_type": "error"
        })

    downtime_mins = int((now - (nvr_obj.last_online or now)).total_seconds() / 60)

    send_tele = False
    if nvr_obj.telegram_alert_count < tele_mute:
        if nvr_obj.telegram_alert_count == 0:
            send_tele = downtime_mins >= tele_delay
        else:
            last = nvr_obj.telegram_last_alert or now
            send_tele = (now - last).total_seconds() / 60 >= tele_freq

    if send_tele:
        res = await asyncio.to_thread(send_telegram_batch, "خطای اتصال NVR", [error_message], "error", nvr_obj.group_id)
        if res is not True:
            await broadcast({
                "type": "alert",
                "title": "خطای ارسال تلگرام (NVR)",
                "body": f"خطا در ارسال پیام تلگرام برای NVR {nvr_name}: {res}",
                "alert_type": "warning"
            })
        nvr_obj.telegram_alert_count += 1
        nvr_obj.telegram_last_alert = now

    send_mail = False
    if nvr_obj.mail_alert_count < mail_mute:
        if nvr_obj.mail_alert_count == 0:
            send_mail = downtime_mins >= mail_delay
        else:
            last = nvr_obj.mail_last_alert or now
            send_mail = (now - last).total_seconds() / 60 >= mail_freq

    if send_mail:
        res = await asyncio.to_thread(send_email_batch, "خطای اتصال NVR", [error_message], "error", nvr_obj.group_id)
        if res is not True:
            await broadcast({
                "type": "alert",
                "title": "خطای ارسال ایمیل (NVR)",
                "body": f"خطا در ارسال ایمیل برای NVR {nvr_name}: {res}",
                "alert_type": "warning"
            })
        nvr_obj.mail_alert_count += 1
        nvr_obj.mail_last_alert = now

    session.add(nvr_obj)

def sync_recording_schedule_config(ip, user, password, session=None):
    from database import decrypt_password
    password = decrypt_password(password)
    is_local_session = session is None
    db_session = session if session is not None else Session(engine)
    
    try:
        cams = db_session.exec(select(Camera).where(Camera.nvr_ip == ip)).all()
        if not cams:
            return
            
        url_all = f"http://{ip}/ISAPI/ContentMgmt/record/tracks"
        req_sess = requests.Session()
        req_sess.trust_env = False
        
        # Try fetching all tracks at once
        tracks_data = {}
        try:
            resp = req_sess.get(url_all, auth=HTTPDigestAuth(user, password), timeout=8, proxies={})
            if resp.status_code == 200:
                root = ET.fromstring(resp.content)
                
                def get_local_name(elem):
                    return elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag

                for elem in root.iter():
                    local_name = get_local_name(elem)
                    if local_name in ('RecordTrack', 'Track'):
                        t_id = None
                        enabled = None
                        sched_type = None
                        
                        # Check enableSchedule first
                        enable_sched_elem = None
                        for sub_elem in elem.iter():
                            if get_local_name(sub_elem) == 'enableSchedule':
                                enable_sched_elem = sub_elem
                                break
                        if enable_sched_elem is not None:
                            enabled = enable_sched_elem.text == 'true'
                        
                        for child in elem:
                            c_local = get_local_name(child)
                            if c_local == 'id':
                                t_id = child.text
                            elif c_local in ('enabled', 'Enable', 'Enabled'):
                                if enabled is None:
                                    enabled = child.text == 'true'
                            elif c_local in ('recordScheduleType', 'scheduleType', 'recordType'):
                                sched_type = child.text
                            elif c_local == 'RecordSchedule':
                                for sub_child in child:
                                    sc_local = get_local_name(sub_child)
                                    if sc_local in ('scheduleType', 'ScheduleType', 'recordScheduleType'):
                                        sched_type = sub_child.text
                                        
                        # Fallback for schedule type
                        if sched_type is None:
                            def_rec_elem = None
                            for sub_elem in elem.iter():
                                if get_local_name(sub_elem) in ('DefaultRecordingMode', 'ActionRecordingMode'):
                                    def_rec_elem = sub_elem
                                    break
                            if def_rec_elem is not None:
                                sched_type = def_rec_elem.text

                        if t_id is not None:
                            tracks_data[t_id] = {'enabled': enabled, 'type': sched_type}
        except Exception as e:
            print(f"Warning: Failed to fetch all tracks config at once for {ip}: {e}")

        for cam in cams:
            try:
                chan_int = int(cam.channel_id)
                track_id = str(chan_int * 100 + 1) if chan_int < 100 else cam.channel_id
            except ValueError:
                track_id = cam.channel_id
                
            enabled = None
            sched_type = None
            
            if track_id in tracks_data:
                enabled = tracks_data[track_id]['enabled']
                sched_type = tracks_data[track_id]['type']
            else:
                try:
                    url_single = f"http://{ip}/ISAPI/ContentMgmt/record/tracks/{track_id}"
                    resp_single = req_sess.get(url_single, auth=HTTPDigestAuth(user, password), timeout=5, proxies={})
                    if resp_single.status_code == 200:
                        root_s = ET.fromstring(resp_single.content)
                        
                        def get_local_name(elem):
                            return elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                            
                        # Try to find enableSchedule first
                        enable_sched_elem = None
                        for elem in root_s.iter():
                            if get_local_name(elem) == 'enableSchedule':
                                enable_sched_elem = elem
                                break
                        if enable_sched_elem is not None:
                            enabled = enable_sched_elem.text == 'true'
                            
                        for elem in root_s.iter():
                            local_name = get_local_name(elem)
                            if local_name in ('enabled', 'Enable', 'Enabled'):
                                if enabled is None:
                                    enabled = elem.text == 'true'
                            elif local_name in ('recordScheduleType', 'scheduleType', 'recordType'):
                                sched_type = elem.text
                            elif local_name == 'RecordSchedule':
                                for sub_child in elem:
                                    sc_local = get_local_name(sub_child)
                                    if sc_local in ('scheduleType', 'ScheduleType', 'recordScheduleType'):
                                        sched_type = sub_child.text
                                        
                        # Fallback for schedule type
                        if sched_type is None:
                            def_rec_elem = None
                            for elem in root_s.iter():
                                if get_local_name(elem) in ('DefaultRecordingMode', 'ActionRecordingMode'):
                                    def_rec_elem = elem
                                    break
                            if def_rec_elem is not None:
                                sched_type = def_rec_elem.text
                except Exception as e_single:
                    print(f"Warning: Failed to fetch single track {track_id} for NVR {ip}: {e_single}")

            cam.recording_scheduled = enabled
            if sched_type:
                translation_map = {
                    "Continuous": "مداوم (Continuous)",
                    "CMR": "مداوم (Continuous)",
                    "Motion": "حرکتی (Motion)",
                    "MOTION": "حرکتی (Motion)",
                    "Alarm": "آلارم (Alarm)",
                    "ALARM": "آلارم (Alarm)",
                    "Motion | Alarm": "حرکت و آلارم (Motion/Alarm)",
                    "Motion/Alarm": "حرکت و آلارم (Motion/Alarm)",
                    "ALARMANDMOTION": "حرکت و آلارم (Motion/Alarm)",
                    "EDR": "رویداد (Event)",
                    "Event": "رویداد (Event)",
                    "NONE": "غیرفعال (None)"
                }
                cam.recording_schedule_type = translation_map.get(sched_type, sched_type)
            else:
                cam.recording_schedule_type = None
                
            db_session.add(cam)
            
        db_session.commit()
    except Exception as outer_err:
        print(f"Warning: Error syncing recording schedule config for NVR {ip}: {outer_err}")
    finally:
        if is_local_session:
            db_session.close()

def run_config_sync_in_thread(ip, user, password):
    sync_recording_schedule_config(ip, user, password)

def sync_recording_stats_from_nvr(ip, user, password, session=None):
    from database import decrypt_password
    password = decrypt_password(password)
    import uuid
    import urllib.parse
    
    is_local_session = session is None
    db_session = session if session is not None else Session(engine)
    
    try:
        # Query all cameras in DB for this NVR
        cams = db_session.exec(select(Camera).where(Camera.nvr_ip == ip)).all()
        if not cams:
            return
            
        url = f"http://{ip}/ISAPI/ContentMgmt/search"
        headers = {"Content-Type": "application/xml"}
        now_local = datetime.now()
        from datetime import timezone
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        now_str = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        
        for cam in cams:
            try:
                chan_int = int(cam.channel_id)
                track_id = str(chan_int * 100 + 1) if chan_int < 100 else cam.channel_id
            except ValueError:
                track_id = cam.channel_id
                
            search_uuid = str(uuid.uuid4()).upper()
            
            # We search from 2010 to now
            payload = f"""<CMSearchDescription version="1.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
    <searchID>{search_uuid}</searchID>
    <trackIDList>
        <trackID>{track_id}</trackID>
    </trackIDList>
    <timeSpanList>
        <timeSpan>
            <startTime>2010-01-01T00:00:00Z</startTime>
            <endTime>{now_str}</endTime>
        </timeSpan>
    </timeSpanList>
    <maxResults>40</maxResults>
    <searchResultPostion>0</searchResultPostion>
</CMSearchDescription>"""

            try:
                req_sess = requests.Session()
                req_sess.trust_env = False
                resp = req_sess.post(url, auth=HTTPDigestAuth(user, password), data=payload, headers=headers, timeout=10, proxies={})
                
                if resp.status_code == 200:
                    root = ET.fromstring(resp.content)
                    namespace = {'ns': 'http://www.hikvision.com/ver20/XMLSchema'}
                    
                    num_matches_node = root.find('ns:numOfMatches', namespace)
                    num_matches = int(num_matches_node.text) if num_matches_node is not None else 0
                    
                    oldest_record = None
                    total_size_bytes = 0
                    total_duration_seconds = 0
                    recording_hours_24h = 0.0
                    
                    match_items = root.findall('.//ns:searchMatchItem', namespace)
                    if match_items:
                        first_item = match_items[0]
                        start_time_str = first_item.find('.//ns:startTime', namespace).text
                        if start_time_str:
                            dt_clean = start_time_str.replace("Z", "")
                            oldest_record = datetime.fromisoformat(dt_clean)
                        
                        page_size_sum = 0
                        page_items_count = 0
                        for item in match_items:
                            playback_node = item.find('.//ns:playbackURI', namespace)
                            if playback_node is not None and playback_node.text:
                                uri = playback_node.text
                                parsed_url = urllib.parse.urlparse(uri)
                                query_params = urllib.parse.parse_qs(parsed_url.query)
                                if 'size' in query_params:
                                    page_size_sum += int(query_params['size'][0])
                                    page_items_count += 1
                                    
                        if page_items_count > 0:
                            avg_segment_size = page_size_sum / page_items_count
                            total_size_bytes = int(avg_segment_size * num_matches)
                            
                        # Duration is the total span from oldest record to now
                        total_duration_seconds = (now_utc - oldest_record).total_seconds()
                        
                        # Query the last 24 hours of recordings to compute 24h stats and current status
                        yesterday_utc = now_utc - timedelta(hours=24)
                        yesterday_str = yesterday_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
                        
                        recent_payload = f"""<CMSearchDescription version="1.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
    <searchID>{str(uuid.uuid4()).upper()}</searchID>
    <trackIDList>
        <trackID>{track_id}</trackID>
    </trackIDList>
    <timeSpanList>
        <timeSpan>
            <startTime>{yesterday_str}</startTime>
            <endTime>{now_str}</endTime>
        </timeSpan>
    </timeSpanList>
    <maxResults>2000</maxResults>
    <searchResultPostion>0</searchResultPostion>
</CMSearchDescription>"""
                        resp_recent = req_sess.post(url, auth=HTTPDigestAuth(user, password), data=recent_payload, headers=headers, timeout=10, proxies={})
                        
                        if resp_recent.status_code == 200:
                            root_recent = ET.fromstring(resp_recent.content)
                            match_items_24h = root_recent.findall('.//ns:searchMatchItem', namespace)
                            
                            total_seconds_24h = 0
                            recent_threshold = now_utc - timedelta(minutes=15)
                            
                            for item in match_items_24h:
                                st_str = item.find('.//ns:startTime', namespace).text
                                et_str = item.find('.//ns:endTime', namespace).text
                                
                                if st_str and et_str:
                                    st_dt = datetime.fromisoformat(st_str.replace("Z", ""))
                                    et_dt = datetime.fromisoformat(et_str.replace("Z", ""))
                                    
                                    # Calculate 24h overlap
                                    overlap_start = max(st_dt, yesterday_utc)
                                    overlap_end = min(et_dt, now_utc)
                                    if overlap_end > overlap_start:
                                        total_seconds_24h += (overlap_end - overlap_start).total_seconds()
                                    
                            recording_hours_24h = total_seconds_24h / 3600
                
                cam.recording_hours_24h = recording_hours_24h
                cam.oldest_record = oldest_record
                cam.total_record_size_gb = round(total_size_bytes / (1024 * 1024 * 1024), 2)
                cam.total_record_duration_hours = round(total_duration_seconds / 3600, 1)
                cam.stats_last_updated = now_local
                db_session.add(cam)
                
            except Exception as e:
                print(f"Warning: Failed to update recording stats for cam {cam.name}: {e}")
            
        db_session.commit()
    except Exception as outer_err:
        print(f"Warning: Recording stats update error: {outer_err}")
    finally:
        if is_local_session:
            db_session.close()

def run_stats_sync_in_thread(ip, user, password):
    sync_recording_stats_from_nvr(ip, user, password)

last_summary_hour = -1

async def task_ping_cameras():
    global last_summary_hour
    with Session(engine) as session:
        nvrs = session.exec(select(NVR).where(NVR.enabled == True)).all()
    if not nvrs:
        return
        
    tasks = [asyncio.to_thread(poll_nvr_thread, (n.ip, n.user, n.password)) for n in nvrs]
    results = await asyncio.gather(*tasks)

    cams_processed = []

    with Session(engine) as session:
        for nvr_obj, res in zip(nvrs, results):
            status, payload = res
            if status == "FAIL":
                nvr_label = f"{nvr_obj.name} ({nvr_obj.ip})" if nvr_obj.name else f"NVR {nvr_obj.ip}"
                error_message = f"{nvr_label} Failed: {payload}"
                await process_nvr_alerts(session, nvr_obj, True, error_message)
                continue
            else:
                await process_nvr_alerts(session, nvr_obj, False)
                
            for d in payload:
                stmt = select(Camera).where(Camera.nvr_ip == nvr_obj.ip, Camera.channel_id == d['channel_id'])
                db_cam = session.exec(stmt).first()
                new_status = "Online" if d['online'] else "Offline"
                
                nvr_label = nvr_obj.name if nvr_obj.name else nvr_obj.ip
                final_name = f"{nvr_label} CH {d['channel_id']}"

                if not db_cam:
                    db_cam = Camera(name=final_name, ip=d['ip'], nvr_ip=nvr_obj.ip, channel_id=d['channel_id'], status=new_status, last_online=datetime.now() if d['online'] else None)
                    session.add(db_cam)
                    session.flush() 
                    session.refresh(db_cam)
                    if new_status == "Offline":
                        session.add(DowntimeEvent(camera_id=db_cam.id, start_time=datetime.now()))
                else:
                    if db_cam.ip != d['ip']: db_cam.ip = d['ip']
                    
                    if db_cam.status != new_status:
                        log_event(session, "Camera", new_status, f"{db_cam.name} ({db_cam.ip})")
                        await broadcast({
                            "type": "alert",
                            "title": f"تغییر وضعیت: {db_cam.name}",
                            "body": f"دوربین {db_cam.name} ({db_cam.ip}) { 'متصل' if new_status == 'Online' else 'قطع' } شد",
                            "alert_type": "success" if new_status == "Online" else "error"
                        })
                        db_cam.status = new_status
                        if new_status == "Offline":
                            session.add(DowntimeEvent(camera_id=db_cam.id, start_time=datetime.now()))
                        elif new_status == "Online":
                            open_evt = session.exec(select(DowntimeEvent).where(DowntimeEvent.camera_id == db_cam.id, DowntimeEvent.end_time == None)).first()
                            if open_evt:
                                open_evt.end_time = datetime.now()
                                session.add(open_evt)
                    
                    if d['online']: db_cam.last_online = datetime.now()
                    session.add(db_cam)
                
                cams_processed.append(db_cam)

        nvr_list = session.exec(select(NVR)).all()
        nvr_groups = {n.ip: n.group_id for n in nvr_list}
        
        groups_map = {}
        for cam in cams_processed:
            gid = nvr_groups.get(cam.nvr_ip)
            if gid not in groups_map:
                groups_map[gid] = []
            groups_map[gid].append(cam)
            
        for gid, group_cams in groups_map.items():
            t_alerts, m_alerts, t_recov, m_recov = await process_batch_alerts(session, group_cams)
            
            if t_alerts:
                res = await asyncio.to_thread(send_telegram_batch, "دوربین‌ها قطع شدند", t_alerts, "warning", gid)
                is_ok = res is True
                log_event(session, "Telegram", "Sent" if is_ok else "Failed", f"Sent {len(t_alerts)} alerts for group {gid}")
                if not is_ok:
                    await broadcast({
                        "type": "alert",
                        "title": "خطای ارسال تلگرام",
                        "body": f"خطا در ارسال پیام تلگرام برای دوربین‌های قطع شده: {res}",
                        "alert_type": "warning"
                    })
            if t_recov:
                res = await asyncio.to_thread(send_telegram_batch, "دوربین‌ها برگشتند", t_recov, "success", gid)
                if res is not True:
                    await broadcast({
                        "type": "alert",
                        "title": "خطای ارسال تلگرام",
                        "body": f"خطا در ارسال پیام تلگرام برای دوربین‌های متصل شده: {res}",
                        "alert_type": "warning"
                    })
            if m_alerts:
                res = await asyncio.to_thread(send_email_batch, "دوربین‌ها قطع شدند", m_alerts, "warning", gid)
                is_ok = res is True
                log_event(session, "Mail", "Sent" if is_ok else "Failed", f"Sent {len(m_alerts)} alerts for group {gid}")
                if not is_ok:
                    await broadcast({
                        "type": "alert",
                        "title": "خطای ارسال ایمیل",
                        "body": f"خطا در ارسال ایمیل برای دوربین‌های قطع شده: {res}",
                        "alert_type": "warning"
                    })
            if m_recov:
                res = await asyncio.to_thread(send_email_batch, "دوربین‌ها برگشتند", m_recov, "success", gid)
                if res is not True:
                    await broadcast({
                        "type": "alert",
                        "title": "خطای ارسال ایمیل",
                        "body": f"خطا در ارسال ایمیل برای دوربین‌های متصل شده: {res}",
                        "alert_type": "warning"
                    })

        now = datetime.now()
        if now.minute == 0 and now.hour != last_summary_hour:
            hour_start = now.replace(minute=0, second=0, microsecond=0)
            summary_lines = []
            for c in cams_processed:
                if c.status == "Offline":
                    offline_since = c.last_online or now
                    overlap_start = max(hour_start, offline_since)
                    minutes_down = int((now - overlap_start).total_seconds() / 60)
                    if minutes_down > 0:
                        summary_lines.append(f"{c.name}: {minutes_down}m")

            if summary_lines:
                header = f"📊 گزارش قطعی ساعتی ({now.strftime('%H:00')})"
                await asyncio.to_thread(send_telegram_batch, header, summary_lines, "info")
                log_event(session, "Telegram", "Sent", "Hourly Summary")
            last_summary_hour = now.hour

        session.commit()
        
        cam_data = []
        for c in cams_processed:
            cam_data.append({
                "id": c.id, "name": c.name, "ip": c.ip,
                "nvr_ip": c.nvr_ip, "channel_id": c.channel_id,
                "status": c.status, "importance": c.importance,
                "last_online": c.last_online.isoformat() if c.last_online else None,
                "latitude": c.latitude, "longitude": c.longitude,
                "x_pos": c.x_pos, "y_pos": c.y_pos,
                "fov_angle": c.fov_angle,
                "fov_radius": c.fov_radius,
                "fov_spread": c.fov_spread,
                "plan_id": c.plan_id,
                "model": c.model,
                "recording_scheduled": c.recording_scheduled,
                "recording_schedule_type": c.recording_schedule_type,
                "recording_hours_24h": c.recording_hours_24h,
                "oldest_record": c.oldest_record.isoformat() if c.oldest_record else None,
                "total_record_size_gb": c.total_record_size_gb,
                "total_record_duration_hours": c.total_record_duration_hours,
                "stats_last_updated": c.stats_last_updated.isoformat() if c.stats_last_updated else None
            })
        await broadcast({"type": "cameras", "data": cam_data})

async def task_sync_nvr_configs():
    with Session(engine) as session:
        nvrs = session.exec(select(NVR).where(NVR.enabled == True)).all()
    for n in nvrs:
        print(f"Triggering NVR recording config sync for {n.ip}...")
        await asyncio.to_thread(sync_recording_schedule_config, n.ip, n.user, n.password)

async def task_sync_nvr_stats():
    with Session(engine) as session:
        nvrs = session.exec(select(NVR).where(NVR.enabled == True)).all()
    for n in nvrs:
        print(f"Triggering NVR recording stats sync for {n.ip}...")
        await asyncio.to_thread(sync_recording_stats_from_nvr, n.ip, n.user, n.password)

async def task_cleanup_database():
    with Session(engine) as session:
        print("Starting database logs cleanup...")
        cleanup_old_data(session)
        session.commit()

async def task_sync_camera_names():
    with Session(engine) as session:
        nvrs = session.exec(select(NVR).where(NVR.enabled == True)).all()
    for n in nvrs:
        print(f"Triggering NVR camera name sync for {n.ip}...")
        await asyncio.to_thread(sync_camera_names_from_nvr, n.ip, n.user, n.password)

def get_substream_channel_id(chan_id_str: str) -> str:
    try:
        val = int(chan_id_str)
        if val >= 100:
            return f"{(val // 10) * 10 + 2}"
        else:
            return f"{val * 100 + 2}"
    except Exception:
        return f"{chan_id_str}02"

async def task_capture_camera_snapshots():
    from database import decrypt_password
    with Session(engine) as session:
        cameras = session.exec(select(Camera).where(Camera.status == "Online")).all()
        nvrs = {n.ip: n for n in session.exec(select(NVR)).all()}
        
    os.makedirs("data/snapshots", exist_ok=True)
    
    for cam in cameras:
        nvr = nvrs.get(cam.nvr_ip)
        if not nvr or not nvr.enabled:
            continue
            
        password = decrypt_password(nvr.password)
        sub_chan = get_substream_channel_id(cam.channel_id)
        url = f"http://{nvr.ip}/ISAPI/Streaming/channels/{sub_chan}/picture"
        
        try:
            def fetch():
                s = requests.Session()
                s.trust_env = False
                r = s.get(url, auth=HTTPDigestAuth(nvr.user, password), timeout=8, proxies={})
                if r.status_code == 200:
                    return r.content
                try:
                    main_chan = f"{(int(sub_chan) // 10) * 10 + 1}"
                except Exception:
                    main_chan = f"{cam.channel_id}01"
                fallback_url = f"http://{nvr.ip}/ISAPI/Streaming/channels/{main_chan}/picture"
                r = s.get(fallback_url, auth=HTTPDigestAuth(nvr.user, password), timeout=8, proxies={})
                if r.status_code == 200:
                    return r.content
                return None
                
            img_data = await asyncio.to_thread(fetch)
            if img_data:
                file_path = f"data/snapshots/camera_{cam.id}.jpg"
                with open(file_path, "wb") as f:
                    f.write(img_data)
                print(f"Captured snapshot for camera {cam.name} (id: {cam.id})")
            else:
                print(f"Failed to capture snapshot for camera {cam.name} (id: {cam.id}) - NVR returned error status")
        except Exception as e:
            print(f"Failed to capture snapshot for camera {cam.name} (id: {cam.id}): {e}")

async def start_monitor_loop():
    print("Monitor loop started (via scheduler)...")
    with Session(engine) as session:
        log_event(session, "Service", "Started", "Monitor loop initialized (via scheduler)")
    from scheduler import scheduler
    try:
        await scheduler.start()
    except asyncio.CancelledError:
        await scheduler.stop()