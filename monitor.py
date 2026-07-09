import asyncio
import requests
import xml.etree.ElementTree as ET
import os
from datetime import datetime, timedelta
from requests.auth import HTTPDigestAuth
from sqlmodel import Session, select
from database import engine, NVR, Camera, Log, Settings, DowntimeEvent
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

def sync_camera_names_from_nvr(ip, user, password, session):
    parts = ip.split(':')
    host = parts[0]
    port = parts[1] if len(parts) > 1 else '80'
    url = f"http://{host}:{port}/ISAPI/ContentMgmt/InputProxy/channels"
    
    nvr_obj = session.exec(select(NVR).where(NVR.ip == ip)).first()
    nvr_name = nvr_obj.name if (nvr_obj and nvr_obj.name) else ip
    
    try:
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
                
                # Fetch port to get the IP address
                port_elem = channel.find('ns:sourceInputPortDescriptor', namespace)
                cam_ip = port_elem.find('ns:ipAddress', namespace).text if port_elem is not None else "0.0.0.0"
                
                # Fallback to "nvr_name CH channel_id" if name is empty
                final_name = chan_name if chan_name else f"{nvr_name} CH {chan_id}"
                
                # Update database
                db_cam = session.exec(select(Camera).where(Camera.nvr_ip == ip, Camera.channel_id == chan_id)).first()
                if db_cam:
                    db_cam.name = final_name
                    # Also update IP if changed
                    if cam_ip and cam_ip != "0.0.0.0":
                        db_cam.ip = cam_ip
                    session.add(db_cam)
                else:
                    # If it's not in db, we create it
                    new_cam = Camera(
                        name=final_name,
                        ip=cam_ip,
                        nvr_ip=ip,
                        channel_id=chan_id,
                        status="Unknown"
                    )
                    session.add(new_cam)
            session.commit()
            return True, f"Successfully synced camera names for {nvr_name}"
        else:
            return False, f"Failed to sync {nvr_name}: HTTP {resp.status_code}"
    except Exception as e:
        return False, f"Failed to sync {nvr_name}: {str(e)}"

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
        session.commit()
    except Exception as e:
        print(f"Warning: Failed to cleanup old data: {e}")

def poll_nvr_thread(nvr_data):
    ip, user, password = nvr_data
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

async def start_monitor_loop():
    print("Monitor loop started...")
    last_summary_hour = -1
    
    with Session(engine) as session:
        log_event(session, "Service", "Started", "Monitor loop initialized")
        
        # Run startup camera name sync
        try:
            nvrs = session.exec(select(NVR).where(NVR.enabled == True)).all()
            for n in nvrs:
                print(f"Syncing camera names for NVR {n.ip} on startup...")
                await asyncio.to_thread(sync_camera_names_from_nvr, n.ip, n.user, n.password, session)
        except Exception as startup_sync_err:
            print(f"Warning: Startup camera sync failed: {startup_sync_err}")

    while True:
        try:
            with Session(engine) as session:
                nvrs = session.exec(select(NVR).where(NVR.enabled == True)).all()

            if not nvrs:
                await asyncio.sleep(10)
                continue
            
            tasks = [asyncio.to_thread(poll_nvr_thread, (n.ip, n.user, n.password)) for n in nvrs]
            results = await asyncio.gather(*tasks)

            cams_processed = []

            with Session(engine) as session:
                for nvr_obj, res in zip(nvrs, results):
                    status, payload = res
                    if status == "FAIL":
                        nvr_label = f"{nvr_obj.name} ({nvr_obj.ip})" if nvr_obj.name else f"NVR {nvr_obj.ip}"
                        error_message = f"{nvr_label} Failed: {payload}"
                        log_event(session, "Camera", "Error", error_message)
                        
                        # Send failure alerts
                        await asyncio.to_thread(send_telegram_batch, "خطای اتصال NVR", [error_message], "error")
                        await asyncio.to_thread(send_email_batch, "خطای اتصال NVR", [error_message], "error")
                        continue
                        
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

                t_alerts, m_alerts, t_recov, m_recov = await process_batch_alerts(session, cams_processed)
                
                if t_alerts:
                    res = await asyncio.to_thread(send_telegram_batch, "دوربین‌ها قطع شدند", t_alerts, "warning")
                    log_event(session, "Telegram", "Sent" if res is True else "Failed", f"Sent {len(t_alerts)} alerts")
                if t_recov:
                    await asyncio.to_thread(send_telegram_batch, "دوربین‌ها برگشتند", t_recov, "success")
                if m_alerts:
                    await asyncio.to_thread(send_email_batch, "دوربین‌ها قطع شدند", m_alerts, "warning")
                if m_recov:
                    await asyncio.to_thread(send_email_batch, "دوربین‌ها برگشتند", m_recov, "success")

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
                        "x_pos": c.x_pos, "y_pos": c.y_pos
                    })
                await broadcast({"type": "cameras", "data": cam_data})
                
                if now.hour == 2 and now.minute == 0:
                    cleanup_old_data(session)
            await asyncio.sleep(60) 

        except asyncio.CancelledError:
            break
        except Exception as e: 
            print(f"Error: {e}")
            await asyncio.sleep(5)