import asyncio
import os
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from io import BytesIO

import requests
from requests.auth import HTTPDigestAuth
from sqlmodel import Session, select

from app.database import (
    NVR,
    Camera,
    CameraChangeEvent,
    DowntimeEvent,
    Log,
    NVRGroup,
    OutageExplanation,
    Settings,
    TaskExecutionLog,
    User,
    UserAlertSettings,
    UserSession,
    engine,
)
from app.logging_config import log_event, logger
from app.services.alerts import (
    build_aggregated_telegram_message,
    get_config_dict,
    is_notification_enabled,
    send_change_alert,
    send_email_batch,
    send_telegram_batch,
    send_telegram_raw,
)

_XML_STREAM_THRESHOLD = 1_000_000  # 1MB


def parse_xml_response(content: bytes):
    size = len(content)
    if size < _XML_STREAM_THRESHOLD:
        return ET.fromstring(content)
    logger.info(
        f"Large XML response ({size / 1024 / 1024:.1f} MB), using streaming parser"
    )
    context = ET.iterparse(BytesIO(content), events=("end",))
    root = None
    for event, elem in context:
        root = elem
    return root


_broadcast_callback = None


def set_broadcast_callback(callback):
    global _broadcast_callback
    _broadcast_callback = callback


async def broadcast(message):
    if _broadcast_callback:
        await _broadcast_callback(message)


async def broadcast_alert(event_type, title, body, alert_type, count: int = 1):
    """Deliver browser alerts only when their central policy permits it."""
    if is_notification_enabled(event_type, "browser"):
        await broadcast(
            {
                "type": "alert",
                "title": title,
                "body": body,
                "alert_type": alert_type,
                "event_type": event_type,
                "count": count,
            }
        )


def get_setting(session, key, default):
    s = session.get(Settings, key)
    return s.value if s else default


def sync_camera_names_from_nvr(ip, user, password, session=None):
    from app.database import decrypt_password

    password = decrypt_password(password)
    parts = ip.split(":")
    host = parts[0]
    port = parts[1] if len(parts) > 1 else "80"
    url = f"http://{host}:{port}/ISAPI/ContentMgmt/InputProxy/channels"

    is_local_session = session is None
    db_session = session if session is not None else Session(engine)

    try:
        nvr_obj = db_session.exec(select(NVR).where(NVR.ip == ip)).first()
        nvr_name = nvr_obj.name if (nvr_obj and nvr_obj.name) else ip
        nvr_group_id = nvr_obj.group_id if nvr_obj else None

        # Get existing cameras in DB for this NVR
        existing_cams = db_session.exec(select(Camera).where(Camera.nvr_ip == ip)).all()
        existing_channel_ids = {cam.channel_id: cam for cam in existing_cams}
        is_initial_sync = len(existing_cams) == 0

        req_sess = requests.Session()
        req_sess.trust_env = False
        resp = req_sess.get(
            url, auth=HTTPDigestAuth(user, password), timeout=8, proxies={}
        )
        if resp.status_code == 200:
            root = parse_xml_response(resp.content)
            namespace = {"ns": "http://www.hikvision.com/ver20/XMLSchema"}

            nvr_channel_ids = set()
            added_cameras = []

            for channel in root.findall("ns:InputProxyChannel", namespace):
                chan_id = channel.find("ns:id", namespace).text
                nvr_channel_ids.add(chan_id)
                name_elem = channel.find("ns:name", namespace)
                chan_name = name_elem.text if name_elem is not None else None

                # Fetch port to get the IP address and specs
                port_elem = channel.find("ns:sourceInputPortDescriptor", namespace)
                cam_ip = "0.0.0.0"
                model = None
                if port_elem is not None:
                    ip_node = port_elem.find("ns:ipAddress", namespace)
                    if ip_node is not None:
                        cam_ip = ip_node.text
                    model_node = port_elem.find("ns:model", namespace)
                    if model_node is not None:
                        model = model_node.text

                # Fallback to "nvr_name CH channel_id" if name is empty
                final_name = chan_name if chan_name else f"{nvr_name} CH {chan_id}"

                # Update database
                db_cam = existing_channel_ids.get(chan_id)
                if db_cam:
                    db_cam.name = final_name
                    # Also update IP if changed
                    if cam_ip and cam_ip != "0.0.0.0":
                        db_cam.ip = cam_ip
                    if model:
                        db_cam.model = model
                    db_session.add(db_cam)
                else:
                    # New camera detected — not in DB yet
                    new_cam = Camera(
                        name=final_name,
                        ip=cam_ip,
                        nvr_ip=ip,
                        channel_id=chan_id,
                        status="Unknown",
                        model=model,
                    )
                    db_session.add(new_cam)
                    added_cameras.append((chan_id, final_name, cam_ip))

            # Detect removed cameras: in DB but not in NVR response
            removed_cameras = []
            if not is_initial_sync:
                for chan_id, cam in existing_channel_ids.items():
                    if chan_id not in nvr_channel_ids:
                        removed_cameras.append((chan_id, cam.name, cam.ip))

            # Log change events for added cameras (تنها در صورتی که کشف اولیه نباشد هشدار ارسال می‌شود)
            alert_lines = []
            for chan_id, cam_name, cam_ip in added_cameras:
                if not is_initial_sync:
                    db_session.add(
                        CameraChangeEvent(
                            nvr_ip=ip,
                            camera_name=cam_name,
                            camera_channel_id=chan_id,
                            change_type="camera_added",
                            new_value=f"{cam_name} ({cam_ip})",
                            group_id=nvr_group_id,
                        )
                    )
                    alert_lines.append(
                        f"➕ دوربین جدید: {cam_name} ({cam_ip}) — کانال {chan_id}"
                    )
                log_event(
                    db_session,
                    category="Camera",
                    action="CAMERA_ADDED"
                    if not is_initial_sync
                    else "CAMERA_DISCOVERED",
                    details=f"دوربین {cam_name} ({cam_ip}) در {nvr_name} ثبت شد",
                    level="INFO",
                    group_id=nvr_group_id,
                    target_type="Camera",
                    target_id=cam_ip,
                )
                logger.info(
                    f"Camera registered on {nvr_name}: {cam_name} ({cam_ip}) CH {chan_id}"
                )

            # Log change events for removed cameras and delete them
            for chan_id, cam_name, cam_ip in removed_cameras:
                cam_to_del = existing_channel_ids[chan_id]
                db_session.add(
                    CameraChangeEvent(
                        nvr_ip=ip,
                        camera_name=cam_name,
                        camera_channel_id=chan_id,
                        change_type="camera_removed",
                        old_value=f"{cam_name} ({cam_ip})",
                        group_id=nvr_group_id,
                    )
                )
                log_event(
                    db_session,
                    category="Camera",
                    action="CAMERA_REMOVED",
                    details=f"دوربین {cam_name} ({cam_ip}) از {nvr_name} حذف شد",
                    level="WARNING",
                    group_id=nvr_group_id,
                    target_type="Camera",
                    target_id=str(cam_to_del.id),
                )
                alert_lines.append(
                    f"➖ دوربین حذف‌شده: {cam_name} ({cam_ip}) — کانال {chan_id}"
                )
                logger.info(
                    f"Camera removed from {nvr_name}: {cam_name} ({cam_ip}) CH {chan_id}"
                )

                # Cascade delete associated records
                dts = db_session.exec(
                    select(DowntimeEvent).where(
                        DowntimeEvent.camera_id == cam_to_del.id
                    )
                ).all()
                for dt in dts:
                    db_session.delete(dt)
                exps = db_session.exec(
                    select(OutageExplanation).where(
                        OutageExplanation.camera_id == cam_to_del.id
                    )
                ).all()
                for exp in exps:
                    db_session.delete(exp)

                db_session.delete(cam_to_del)

            db_session.commit()

            # Send combined alert for all changes on this NVR (تنها برای تغییرات واقعی پس از کشف اولیه)
            if alert_lines and not is_initial_sync:
                group_name = ""
                if nvr_group_id:
                    grp = db_session.get(NVRGroup, nvr_group_id)
                    group_name = f" [{grp.name}]" if grp else ""
                title = f"تغییرات ساختاری دوربین‌ها — {nvr_name}{group_name}"
                send_change_alert(
                    title,
                    alert_lines,
                    alert_type="warning",
                    group_id=nvr_group_id,
                    event_type="camera_topology_changed",
                )

            return True, f"Successfully synced camera names for {nvr_name}"
        else:
            return False, f"Failed to sync {nvr_name}: HTTP {resp.status_code}"
    except Exception as e:
        return False, f"Failed to sync {nvr_name}: {e!s}"
    finally:
        if is_local_session:
            db_session.close()


def cleanup_old_data(session, days=90):
    try:
        cutoff = datetime.now() - timedelta(days=days)
        session.query(Log).filter(Log.timestamp < cutoff).delete()
        session.query(DowntimeEvent).filter(
            DowntimeEvent.end_time < cutoff, DowntimeEvent.end_time != None
        ).delete()
        session.query(UserSession).filter(
            UserSession.expires_at < datetime.now()
        ).delete()
        session.query(TaskExecutionLog).filter(
            TaskExecutionLog.started_at < cutoff
        ).delete()
        session.commit()
    except Exception as e:
        logger.warning(f"Failed to cleanup old data: {e}")


def fetch_nvr_extended_info(ip, user, password, req_sess):
    info = {
        "model": None,
        "firmware_version": None,
        "serial_number": None,
        "mac_address": None,
        "uptime": None,
        "cpu_usage": None,
        "memory_usage": None,
        "hdd_status": None,
        "device_time": None,
    }

    import re
    import xml.etree.ElementTree as ET

    def _parse_xml(content):
        try:
            return ET.fromstring(content)
        except Exception:
            try:
                content_str = content.decode("utf-8", errors="ignore")
                content_str = re.sub(r'xmlns="[^"]+"', "", content_str, count=1)
                return ET.fromstring(content_str)
            except Exception:
                return None

    # 1. System Info
    try:
        url_info = f"http://{ip}/ISAPI/System/deviceInfo"
        r = req_sess.get(
            url_info, auth=HTTPDigestAuth(user, password), timeout=5, proxies={}
        )
        if r.status_code == 200:
            root = _parse_xml(r.content)
            ns = {"ns": "http://www.hikvision.com/ver20/XMLSchema"}
            m = root.find(".//ns:model", ns)
            if m is not None:
                info["model"] = m.text
            fv = root.find(".//ns:firmwareVersion", ns)
            if fv is not None:
                info["firmware_version"] = fv.text
            sn = root.find(".//ns:serialNumber", ns)
            if sn is not None:
                info["serial_number"] = sn.text
            ma = root.find(".//ns:macAddress", ns)
            if ma is not None:
                info["mac_address"] = ma.text
    except Exception:
        pass

    # 2. System Status (CPU, Memory, Uptime)
    try:
        url_status = f"http://{ip}/ISAPI/System/status"
        r = req_sess.get(
            url_status, auth=HTTPDigestAuth(user, password), timeout=5, proxies={}
        )
        if r.status_code == 200:
            root = _parse_xml(r.content)
            ns = {"ns": "http://www.hikvision.com/ver20/XMLSchema"}
            up = root.find(".//ns:deviceUpTime", ns)
            if up is not None and up.text and up.text.isdigit():
                info["uptime"] = int(up.text)

            cpus = root.findall(".//ns:CPUList/ns:CPU/ns:cpuUtilization", ns)
            # CPU and RAM extraction removed per user request
    except Exception:
        pass

    # 3. HDD Status
    try:
        url_hdd = f"http://{ip}/ISAPI/ContentMgmt/Storage"
        r = req_sess.get(
            url_hdd, auth=HTTPDigestAuth(user, password), timeout=5, proxies={}
        )
        if r.status_code == 200:
            root = _parse_xml(r.content)
            ns = {"ns": "http://www.hikvision.com/ver20/XMLSchema"}
            hdds = []
            for hdd in root.findall(".//ns:hdd", ns):
                hdd_info = {
                    "id": hdd.find("ns:id", ns).text
                    if hdd.find("ns:id", ns) is not None
                    else "",
                    "name": hdd.find("ns:hddName", ns).text
                    if hdd.find("ns:hddName", ns) is not None
                    else "",
                    "capacity": hdd.find("ns:capacity", ns).text
                    if hdd.find("ns:capacity", ns) is not None
                    else "0",
                    "freeSpace": hdd.find("ns:freeSpace", ns).text
                    if hdd.find("ns:freeSpace", ns) is not None
                    else "0",
                    "status": hdd.find("ns:status", ns).text
                    if hdd.find("ns:status", ns) is not None
                    else "",
                    "property": hdd.find("ns:property", ns).text
                    if hdd.find("ns:property", ns) is not None
                    else "",
                }
                hdds.append(hdd_info)
            import json

            if hdds:
                info["hdd_status"] = json.dumps(hdds)
    except Exception:
        pass

    # 4. Device Time
    try:
        url_time = f"http://{ip}/ISAPI/System/time"
        r = req_sess.get(
            url_time, auth=HTTPDigestAuth(user, password), timeout=5, proxies={}
        )
        if r.status_code == 200:
            root = _parse_xml(r.content)
            ns = {"ns": "http://www.hikvision.com/ver20/XMLSchema"}
            lt = root.find(".//ns:localTime", ns)
            if lt is not None and lt.text:
                try:
                    info["device_time"] = datetime.strptime(
                        lt.text[:19], "%Y-%m-%dT%H:%M:%S"
                    )
                except Exception:
                    pass
    except Exception:
        pass

    return info


def poll_nvr_thread(nvr_data):
    from app.database import decrypt_password

    ip, user, password = nvr_data
    password = decrypt_password(password)
    url = f"http://{ip}/ISAPI/ContentMgmt/InputProxy/channels/status"
    try:
        # Create a session and strictly disable environment proxy inheritance (Karing)
        session = requests.Session()
        session.trust_env = False
        resp = session.get(
            url, auth=HTTPDigestAuth(user, password), timeout=6, proxies={}
        )
        if resp.status_code == 200:
            root = parse_xml_response(resp.content)
            namespace = {"ns": "http://www.hikvision.com/ver20/XMLSchema"}
            results = []
            for channel in root.findall("ns:InputProxyChannelStatus", namespace):
                chan_id = channel.find("ns:id", namespace).text
                online = channel.find("ns:online", namespace).text == "true"
                port = channel.find("ns:sourceInputPortDescriptor", namespace)
                cam_ip = (
                    port.find("ns:ipAddress", namespace).text
                    if port is not None
                    else "0.0.0.0"
                )
                results.append({"channel_id": chan_id, "ip": cam_ip, "online": online})

            # Fetch extended info has been moved to a separate scheduled task sync_nvr_health to optimize resources
            return ("OK", (results, None))
        elif resp.status_code == 401:
            return ("AUTH_FAIL", "Authentication failed (401)")
        return ("FAIL", f"HTTP {resp.status_code}")
    except Exception as e:
        # Check if the exception message contains 401
        err_str = str(e)
        if "401" in err_str or "unauthorized" in err_str.lower():
            return ("AUTH_FAIL", f"Auth error via exception: {err_str}")
        return ("FAIL", err_str)


async def process_batch_alerts(session, cams_to_check, startup_grace=False):
    tele_events = []
    mail_alerts = []
    mail_recoveries = []
    now = datetime.now()

    # Load Settings
    mail_delay = int(get_setting(session, "MAIL_FIRST_ALERT_DELAY_MINUTES", 1))
    mail_low_delay = int(get_setting(session, "MAIL_LOW_IMPORTANCE_DELAY_MINUTES", 30))
    mail_freq = int(get_setting(session, "MAIL_ALERT_FREQUENCY_MINUTES", 60))
    mail_mute = int(get_setting(session, "MAIL_MUTE_AFTER_N_ALERTS", 3))

    tele_delay = int(get_setting(session, "TELEGRAM_FIRST_ALERT_DELAY_MINUTES", 1))
    tele_low_delay = int(
        get_setting(session, "TELEGRAM_LOW_IMPORTANCE_DELAY_MINUTES", 15)
    )
    tele_freq = int(get_setting(session, "TELEGRAM_ALERT_FREQUENCY_MINUTES", 30))
    tele_mute = int(get_setting(session, "TELEGRAM_MUTE_AFTER_N_ALERTS", 3))

    for cam in cams_to_check:
        if cam.status == "Online":
            if cam.telegram_alert_count > 0:
                if not startup_grace:
                    tele_events.append(
                        {
                            "type": "camera_online",
                            "name": cam.name,
                            "ip": cam.ip,
                            "channel_id": cam.channel_id,
                        }
                    )
                cam.telegram_alert_count = 0
            if cam.mail_alert_count > 0:
                if not startup_grace:
                    mail_recoveries.append(f"{cam.name} مجددا متصل شد")
                cam.mail_alert_count = 0
            session.add(cam)
            continue

        # اگر دوربین تا کنون آنلاین نبوده (کانال خالی/استفاده‌نشده NVR)، هشدار قطعی صادر نشود
        if cam.last_online is None:
            continue

        downtime = now - cam.last_online
        downtime_mins = int(downtime.total_seconds() / 60)

        # --- TELEGRAM ---
        send_tele = False
        if not startup_grace and cam.telegram_alert_count < tele_mute:
            if cam.telegram_alert_count == 0:
                threshold = tele_low_delay if cam.importance == 1 else tele_delay
                if downtime_mins >= threshold:
                    send_tele = True
            else:
                last = cam.telegram_last_alert or now
                if (now - last).total_seconds() / 60 >= tele_freq:
                    send_tele = True

        if send_tele:
            tele_events.append(
                {
                    "type": "camera_offline",
                    "name": cam.name,
                    "ip": cam.ip,
                    "channel_id": cam.channel_id,
                    "downtime_mins": downtime_mins,
                    "is_muted": cam.telegram_alert_count + 1 >= tele_mute,
                }
            )
            cam.telegram_alert_count += 1
            cam.telegram_last_alert = now
            session.add(cam)

        # --- MAIL ---
        send_mail = False
        if not startup_grace and cam.mail_alert_count < mail_mute:
            if cam.mail_alert_count == 0:
                threshold = mail_low_delay if cam.importance == 1 else mail_delay
                if downtime_mins >= threshold:
                    send_mail = True
            else:
                last = cam.mail_last_alert or now
                if (now - last).total_seconds() / 60 >= mail_freq:
                    send_mail = True

        if send_mail:
            msg = f"{cam.name} قطع به مدت {downtime_mins} دقیقه"
            if cam.mail_alert_count + 1 >= mail_mute:
                msg += " (بی صدا)"
            mail_alerts.append(msg)
            cam.mail_alert_count += 1
            cam.mail_last_alert = now
            session.add(cam)

    return tele_events, mail_alerts, mail_recoveries


async def process_nvr_alerts(
    session, nvr_obj, is_failed, error_message=None, startup_grace=False
):
    now = datetime.now()

    mail_delay = int(get_setting(session, "MAIL_FIRST_ALERT_DELAY_MINUTES", 1))
    mail_freq = int(get_setting(session, "MAIL_ALERT_FREQUENCY_MINUTES", 60))
    mail_mute = int(get_setting(session, "MAIL_MUTE_AFTER_N_ALERTS", 3))

    tele_delay = int(get_setting(session, "TELEGRAM_FIRST_ALERT_DELAY_MINUTES", 1))
    tele_freq = int(get_setting(session, "TELEGRAM_ALERT_FREQUENCY_MINUTES", 30))
    tele_mute = int(get_setting(session, "TELEGRAM_MUTE_AFTER_N_ALERTS", 3))

    nvr_name = nvr_obj.name or nvr_obj.ip
    tele_event = None

    if not is_failed:
        if nvr_obj.status == "Offline":
            log_event(
                session,
                category="NVR",
                action="NVR_ONLINE",
                details=f"اتصال مجدد {nvr_name} برقرار شد",
                level="INFO",
                group_id=nvr_obj.group_id,
                target_type="NVR",
                target_id=nvr_obj.ip,
            )
            await broadcast_alert(
                "nvr_recovered",
                "اتصال مجدد NVR",
                f"اتصال NVR {nvr_name} مجدداً برقرار شد",
                "success",
            )

        nvr_obj.status = "Online"
        nvr_obj.last_online = now

        if nvr_obj.telegram_alert_count > 0:
            if not startup_grace:
                tele_event = {
                    "type": "nvr_recovered",
                    "name": nvr_name,
                    "ip": nvr_obj.ip,
                    "group_id": nvr_obj.group_id,
                }
            nvr_obj.telegram_alert_count = 0

        if nvr_obj.mail_alert_count > 0:
            if not startup_grace:
                res = await asyncio.to_thread(
                    send_email_batch,
                    "NVR برگشت",
                    [f"{nvr_name} مجددا متصل شد"],
                    "success",
                    nvr_obj.group_id,
                    "nvr_recovered",
                )
                if res is not True:
                    await broadcast_alert(
                        "delivery_failure",
                        "خطای ارسال ایمیل (NVR)",
                        f"خطا در ارسال ایمیل برای NVR {nvr_name}: {res}",
                        "warning",
                    )
            nvr_obj.mail_alert_count = 0

        session.add(nvr_obj)
        return tele_event

    if nvr_obj.status != "Offline":
        nvr_obj.status = "Offline"
        nvr_obj.last_online = nvr_obj.last_online or now
        log_event(
            session,
            category="NVR",
            action="NVR_OFFLINE",
            details=error_message,
            level="ERROR",
            group_id=nvr_obj.group_id,
            target_type="NVR",
            target_id=nvr_obj.ip,
        )
        await broadcast_alert(
            "nvr_offline",
            "خطای اتصال NVR",
            f"اتصال NVR {nvr_name} قطع شد: {error_message}",
            "error",
        )

    downtime_mins = int((now - (nvr_obj.last_online or now)).total_seconds() / 60)

    send_tele = False
    if not startup_grace and nvr_obj.telegram_alert_count < tele_mute:
        if nvr_obj.telegram_alert_count == 0:
            send_tele = downtime_mins >= tele_delay
        else:
            last = nvr_obj.telegram_last_alert or now
            send_tele = (now - last).total_seconds() / 60 >= tele_freq

    if send_tele:
        tele_event = {
            "type": "nvr_offline",
            "name": nvr_name,
            "ip": nvr_obj.ip,
            "error": error_message,
            "downtime_mins": downtime_mins,
            "group_id": nvr_obj.group_id,
        }
        nvr_obj.telegram_alert_count += 1
        nvr_obj.telegram_last_alert = now

    send_mail = False
    if not startup_grace and nvr_obj.mail_alert_count < mail_mute:
        if nvr_obj.mail_alert_count == 0:
            send_mail = downtime_mins >= mail_delay
        else:
            last = nvr_obj.mail_last_alert or now
            send_mail = (now - last).total_seconds() / 60 >= mail_freq

    if send_mail:
        res = await asyncio.to_thread(
            send_email_batch,
            "خطای اتصال NVR",
            [error_message],
            "error",
            nvr_obj.group_id,
            "nvr_offline",
        )
        if res is not True:
            await broadcast_alert(
                "delivery_failure",
                "خطای ارسال ایمیل (NVR)",
                f"خطا در ارسال ایمیل برای NVR {nvr_name}: {res}",
                "warning",
            )
        nvr_obj.mail_alert_count += 1
        nvr_obj.mail_last_alert = now

    session.add(nvr_obj)
    return tele_event


def sync_recording_schedule_config(ip, user, password, session=None):
    from app.database import decrypt_password

    password = decrypt_password(password)
    is_local_session = session is None
    db_session = session if session is not None else Session(engine)

    try:
        # Sync camera channels/names first to add/remove cameras in DB
        try:
            sync_camera_names_from_nvr(ip, user, password, session=db_session)
        except Exception as sync_err:
            logger.warning(
                f"Failed to sync camera names prior to recording config sync for {ip}: {sync_err}"
            )

        nvr_obj = db_session.exec(select(NVR).where(NVR.ip == ip)).first()
        nvr_name = nvr_obj.name if (nvr_obj and nvr_obj.name) else ip
        nvr_group_id = nvr_obj.group_id if nvr_obj else None

        cams = db_session.exec(select(Camera).where(Camera.nvr_ip == ip)).all()
        if not cams:
            return

        url_all = f"http://{ip}/ISAPI/ContentMgmt/record/tracks"
        req_sess = requests.Session()
        req_sess.trust_env = False

        # Try fetching all tracks at once
        tracks_data = {}
        try:
            resp = req_sess.get(
                url_all, auth=HTTPDigestAuth(user, password), timeout=8, proxies={}
            )
            if resp.status_code == 200:
                root = parse_xml_response(resp.content)

                def get_local_name(elem):
                    return elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag

                for elem in root.iter():
                    local_name = get_local_name(elem)
                    if local_name in ("RecordTrack", "Track"):
                        t_id = None
                        enabled = None
                        sched_type = None

                        # Check enableSchedule first
                        enable_sched_elem = None
                        for sub_elem in elem.iter():
                            if get_local_name(sub_elem) == "enableSchedule":
                                enable_sched_elem = sub_elem
                                break
                        if enable_sched_elem is not None:
                            enabled = enable_sched_elem.text == "true"

                        for child in elem:
                            c_local = get_local_name(child)
                            if c_local == "id":
                                t_id = child.text
                            elif c_local in ("enabled", "Enable", "Enabled"):
                                if enabled is None:
                                    enabled = child.text == "true"
                            elif c_local in (
                                "recordScheduleType",
                                "scheduleType",
                                "recordType",
                            ):
                                sched_type = child.text
                            elif c_local in ("RecordSchedule", "TrackSchedule"):
                                for sub_child in child:
                                    sc_local = get_local_name(sub_child)
                                    if sc_local in (
                                        "scheduleType",
                                        "ScheduleType",
                                        "recordScheduleType",
                                    ):
                                        sched_type = sub_child.text

                        # Search for ActionRecordingMode inside Actions (per-camera type)
                        if sched_type is None:
                            for sub_elem in elem.iter():
                                if get_local_name(sub_elem) == "Actions":
                                    for action_child in sub_elem:
                                        if (
                                            get_local_name(action_child)
                                            == "ActionRecordingMode"
                                        ):
                                            sched_type = action_child.text
                                            break
                                    if sched_type is not None:
                                        break

                        if t_id is not None:
                            tracks_data[t_id] = {"enabled": enabled, "type": sched_type}
        except Exception as e:
            logger.warning(f"Failed to fetch all tracks config at once for {ip}: {e}")

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
            "NONE": "غیرفعال (None)",
        }

        alert_lines = []

        for cam in cams:
            try:
                chan_int = int(cam.channel_id)
                track_id = str(chan_int * 100 + 1) if chan_int < 100 else cam.channel_id
            except ValueError:
                track_id = cam.channel_id

            enabled = None
            sched_type = None

            if track_id in tracks_data:
                enabled = tracks_data[track_id]["enabled"]
                sched_type = tracks_data[track_id]["type"]
            else:
                try:
                    url_single = (
                        f"http://{ip}/ISAPI/ContentMgmt/record/tracks/{track_id}"
                    )
                    resp_single = req_sess.get(
                        url_single,
                        auth=HTTPDigestAuth(user, password),
                        timeout=5,
                        proxies={},
                    )
                    if resp_single.status_code == 200:
                        root_s = parse_xml_response(resp_single.content)

                        def get_local_name(elem):
                            return (
                                elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                            )

                        # Try to find enableSchedule first
                        enable_sched_elem = None
                        for elem in root_s.iter():
                            if get_local_name(elem) == "enableSchedule":
                                enable_sched_elem = elem
                                break
                        if enable_sched_elem is not None:
                            enabled = enable_sched_elem.text == "true"

                        for elem in root_s.iter():
                            local_name = get_local_name(elem)
                            if local_name in ("enabled", "Enable", "Enabled"):
                                if enabled is None:
                                    enabled = elem.text == "true"
                            elif local_name in (
                                "recordScheduleType",
                                "scheduleType",
                                "recordType",
                            ):
                                sched_type = elem.text
                            elif local_name in ("RecordSchedule", "TrackSchedule"):
                                for sub_child in elem:
                                    sc_local = get_local_name(sub_child)
                                    if sc_local in (
                                        "scheduleType",
                                        "ScheduleType",
                                        "recordScheduleType",
                                    ):
                                        sched_type = sub_child.text

                        # Search for ActionRecordingMode inside Actions (per-camera type)
                        if sched_type is None:
                            for elem in root_s.iter():
                                if get_local_name(elem) == "Actions":
                                    for action_child in elem:
                                        if (
                                            get_local_name(action_child)
                                            == "ActionRecordingMode"
                                        ):
                                            sched_type = action_child.text
                                            break
                                    if sched_type is not None:
                                        break
                except Exception as e_single:
                    logger.warning(
                        f"Failed to fetch single track {track_id} for NVR {ip}: {e_single}"
                    )

            # Translate new schedule type
            if sched_type:
                new_schedule_type = translation_map.get(sched_type, sched_type)
                if sched_type not in translation_map:
                    logger.debug(
                        f"Unmapped recording type '{sched_type}' for {cam.name} (CH {cam.channel_id}) on {nvr_name}, using raw value"
                    )
            else:
                new_schedule_type = None

            # Detect recording changes (only if camera had previous data — skip first sync)
            old_enabled = cam.recording_scheduled
            old_type = cam.recording_schedule_type

            if old_enabled is not None and enabled is not None:
                # Recording enabled/disabled changed
                if old_enabled != enabled:
                    old_label = "روشن" if old_enabled else "خاموش"
                    new_label = "روشن" if enabled else "خاموش"
                    db_session.add(
                        CameraChangeEvent(
                            nvr_ip=ip,
                            camera_name=cam.name,
                            camera_channel_id=cam.channel_id,
                            change_type="recording_changed",
                            old_value=f"ضبط: {old_label}",
                            new_value=f"ضبط: {new_label}",
                            group_id=nvr_group_id,
                        )
                    )
                    log_event(
                        db_session,
                        category="Camera",
                        action="RECORDING_CHANGE",
                        details=f"وضعیت ضبط {cam.name} تغییر کرد: {old_label} → {new_label}",
                        level="WARNING",
                        group_id=nvr_group_id,
                        target_type="Camera",
                        target_id=cam.id,
                    )
                    alert_lines.append(f"🔄 {cam.name}: ضبط {old_label} → {new_label}")
                    logger.info(
                        f"Recording state changed for {cam.name} on {nvr_name}: {old_label} -> {new_label}"
                    )

                # Recording type changed (only when both are enabled)
                elif (
                    old_enabled
                    and enabled
                    and old_type
                    and new_schedule_type
                    and old_type != new_schedule_type
                ):
                    db_session.add(
                        CameraChangeEvent(
                            nvr_ip=ip,
                            camera_name=cam.name,
                            camera_channel_id=cam.channel_id,
                            change_type="recording_changed",
                            old_value=old_type,
                            new_value=new_schedule_type,
                            group_id=nvr_group_id,
                        )
                    )
                    log_event(
                        db_session,
                        category="Camera",
                        action="RECORDING_CHANGE",
                        details=f"نوع ضبط {cam.name} تغییر کرد: {old_type} → {new_schedule_type}",
                        level="WARNING",
                        group_id=nvr_group_id,
                        target_type="Camera",
                        target_id=cam.id,
                    )
                    alert_lines.append(
                        f"🔄 {cam.name}: نوع ضبط {old_type} → {new_schedule_type}"
                    )
                    logger.info(
                        f"Recording type changed for {cam.name} on {nvr_name}: {old_type} -> {new_schedule_type}"
                    )

            # Apply new values
            cam.recording_scheduled = enabled
            cam.recording_schedule_type = new_schedule_type

            db_session.add(cam)

        db_session.commit()

        # Send combined alert for all recording changes on this NVR
        if alert_lines:
            group_name = ""
            if nvr_group_id:
                grp = db_session.get(NVRGroup, nvr_group_id)
                group_name = f" [{grp.name}]" if grp else ""
            title = f"تغییرات تنظیمات ضبط — {nvr_name}{group_name}"
            send_change_alert(
                title,
                alert_lines,
                alert_type="warning",
                group_id=nvr_group_id,
                event_type="recording_changed",
            )

    except Exception as outer_err:
        logger.warning(
            f"Error syncing recording schedule config for NVR {ip}: {outer_err}"
        )
    finally:
        if is_local_session:
            db_session.close()


def run_config_sync_in_thread(ip, user, password):
    sync_recording_schedule_config(ip, user, password)


def sync_recording_stats_from_nvr(ip, user, password, session=None):
    from app.database import decrypt_password

    password = decrypt_password(password)
    import urllib.parse
    import uuid

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
                resp = req_sess.post(
                    url,
                    auth=HTTPDigestAuth(user, password),
                    data=payload,
                    headers=headers,
                    timeout=10,
                    proxies={},
                )

                if resp.status_code == 200:
                    root = parse_xml_response(resp.content)
                    namespace = {"ns": "http://www.hikvision.com/ver20/XMLSchema"}

                    num_matches_node = root.find("ns:numOfMatches", namespace)
                    num_matches = (
                        int(num_matches_node.text)
                        if num_matches_node is not None
                        else 0
                    )

                    oldest_record = None
                    total_size_bytes = 0
                    total_duration_seconds = 0
                    recording_hours_24h = 0.0

                    match_items = root.findall(".//ns:searchMatchItem", namespace)
                    if match_items:
                        first_item = match_items[0]
                        start_time_str = first_item.find(
                            ".//ns:startTime", namespace
                        ).text
                        if start_time_str:
                            dt_clean = start_time_str.replace("Z", "")
                            oldest_record = datetime.fromisoformat(dt_clean)

                        page_size_sum = 0
                        page_items_count = 0
                        for item in match_items:
                            playback_node = item.find(".//ns:playbackURI", namespace)
                            if playback_node is not None and playback_node.text:
                                uri = playback_node.text
                                parsed_url = urllib.parse.urlparse(uri)
                                query_params = urllib.parse.parse_qs(parsed_url.query)
                                if "size" in query_params:
                                    page_size_sum += int(query_params["size"][0])
                                    page_items_count += 1

                        if page_items_count > 0:
                            avg_segment_size = page_size_sum / page_items_count
                            total_size_bytes = int(avg_segment_size * num_matches)

                        # Duration is the total span from oldest record to now
                        total_duration_seconds = (
                            now_utc - oldest_record
                        ).total_seconds()

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
                        resp_recent = req_sess.post(
                            url,
                            auth=HTTPDigestAuth(user, password),
                            data=recent_payload,
                            headers=headers,
                            timeout=10,
                            proxies={},
                        )

                        if resp_recent.status_code == 200:
                            root_recent = parse_xml_response(resp_recent.content)
                            match_items_24h = root_recent.findall(
                                ".//ns:searchMatchItem", namespace
                            )

                            total_seconds_24h = 0
                            recent_threshold = now_utc - timedelta(minutes=15)

                            for item in match_items_24h:
                                st_str = item.find(".//ns:startTime", namespace).text
                                et_str = item.find(".//ns:endTime", namespace).text

                                if st_str and et_str:
                                    st_dt = datetime.fromisoformat(
                                        st_str.replace("Z", "")
                                    )
                                    et_dt = datetime.fromisoformat(
                                        et_str.replace("Z", "")
                                    )

                                    # Calculate 24h overlap
                                    overlap_start = max(st_dt, yesterday_utc)
                                    overlap_end = min(et_dt, now_utc)
                                    if overlap_end > overlap_start:
                                        total_seconds_24h += (
                                            overlap_end - overlap_start
                                        ).total_seconds()

                            recording_hours_24h = total_seconds_24h / 3600

                cam.recording_hours_24h = recording_hours_24h
                cam.oldest_record = oldest_record
                cam.total_record_size_gb = round(
                    total_size_bytes / (1024 * 1024 * 1024), 2
                )
                cam.total_record_duration_hours = round(
                    total_duration_seconds / 3600, 1
                )
                cam.stats_last_updated = now_local
                db_session.add(cam)

            except Exception as e:
                logger.warning(
                    f"Failed to update recording stats for cam {cam.name}: {e}"
                )

        db_session.commit()
    except Exception as outer_err:
        logger.warning(f"Recording stats update error: {outer_err}")
    finally:
        if is_local_session:
            db_session.close()


def run_stats_sync_in_thread(ip, user, password):
    sync_recording_stats_from_nvr(ip, user, password)


_monitor_startup_time = None
last_summary_hour = -1


async def task_ping_cameras():
    global last_summary_hour, _monitor_startup_time
    now = datetime.now()

    if _monitor_startup_time is None:
        _monitor_startup_time = now
        is_startup_grace = True
    else:
        is_startup_grace = (now - _monitor_startup_time).total_seconds() < 30

    with Session(engine) as session:
        nvrs = session.exec(
            select(NVR).where(NVR.enabled == True, NVR.status != "AuthError")
        ).all()
    if not nvrs:
        return

    tasks = [
        asyncio.to_thread(poll_nvr_thread, (n.ip, n.user, n.password)) for n in nvrs
    ]
    results = await asyncio.gather(*tasks)

    cams_processed = []
    cycle_nvr_events = []

    from collections import defaultdict

    browser_offline_by_group = defaultdict(list)
    browser_recovered_by_group = defaultdict(list)

    with Session(engine) as session:
        for nvr_obj, res in zip(nvrs, results):
            status, payload = res
            if status == "AUTH_FAIL":
                nvr_label = (
                    f"{nvr_obj.name} ({nvr_obj.ip})"
                    if nvr_obj.name
                    else f"NVR {nvr_obj.ip}"
                )
                error_message = (
                    f"خطای احراز هویت: رمز عبور نامعتبر است برای {nvr_label}"
                )
                nvr_obj.status = "AuthError"
                log_event(
                    session,
                    category="NVR",
                    action="NVR_AUTH_ERROR",
                    details=error_message,
                    level="ERROR",
                    group_id=nvr_obj.group_id,
                    target_type="NVR",
                    target_id=nvr_obj.ip,
                )
                await broadcast_alert(
                    "nvr_auth_error", "خطای احراز هویت NVR", error_message, "error"
                )
                # Mark all cameras of this NVR as Offline since we cannot authenticate to poll them
                offline_cams = session.exec(
                    select(Camera).where(Camera.nvr_ip == nvr_obj.ip)
                ).all()
                for cam in offline_cams:
                    if cam.status != "Offline":
                        log_event(
                            session,
                            category="Camera",
                            action="CAMERA_OFFLINE",
                            details=f"{cam.name} ({cam.ip}) - خطای احراز هویت NVR",
                            level="ERROR",
                            group_id=nvr_obj.group_id,
                            target_type="Camera",
                            target_id=cam.id,
                        )
                        cam.status = "Offline"
                        browser_offline_by_group[nvr_obj.group_id].append(cam)
                        open_evt = session.exec(
                            select(DowntimeEvent).where(
                                DowntimeEvent.camera_id == cam.id,
                                DowntimeEvent.end_time == None,
                            )
                        ).first()
                        if not open_evt:
                            session.add(
                                DowntimeEvent(
                                    camera_id=cam.id, start_time=datetime.now()
                                )
                            )
                        session.add(cam)
                    cams_processed.append(cam)
                session.add(nvr_obj)
                continue
            elif status == "FAIL":
                nvr_label = (
                    f"{nvr_obj.name} ({nvr_obj.ip})"
                    if nvr_obj.name
                    else f"NVR {nvr_obj.ip}"
                )
                error_message = f"خطا در {nvr_label}: {payload}"
                nvr_evt = await process_nvr_alerts(
                    session,
                    nvr_obj,
                    True,
                    error_message,
                    startup_grace=is_startup_grace,
                )
                if nvr_evt:
                    cycle_nvr_events.append(nvr_evt)

                # Mark all cameras of this offline NVR as Offline and include in broadcast
                offline_cams = session.exec(
                    select(Camera).where(Camera.nvr_ip == nvr_obj.ip)
                ).all()
                for cam in offline_cams:
                    if cam.status != "Offline":
                        log_event(
                            session,
                            category="Camera",
                            action="CAMERA_OFFLINE",
                            details=f"{cam.name} ({cam.ip}) - قطع ارتباط با NVR",
                            level="ERROR",
                            group_id=nvr_obj.group_id,
                            target_type="Camera",
                            target_id=cam.id,
                        )
                        cam.status = "Offline"
                        browser_offline_by_group[nvr_obj.group_id].append(cam)
                        open_evt = session.exec(
                            select(DowntimeEvent).where(
                                DowntimeEvent.camera_id == cam.id,
                                DowntimeEvent.end_time == None,
                            )
                        ).first()
                        if not open_evt:
                            session.add(
                                DowntimeEvent(
                                    camera_id=cam.id, start_time=datetime.now()
                                )
                            )
                        session.add(cam)
                    cams_processed.append(cam)
                continue
            else:
                nvr_evt = await process_nvr_alerts(
                    session, nvr_obj, False, startup_grace=is_startup_grace
                )
                if nvr_evt:
                    cycle_nvr_events.append(nvr_evt)

                # Update NVR extended info
                if isinstance(payload, tuple) and len(payload) == 2:
                    cam_payload, ext_info = payload
                else:
                    cam_payload, ext_info = payload, None

                if ext_info:
                    if ext_info["model"] is not None:
                        nvr_obj.model = ext_info["model"]
                    if ext_info["firmware_version"] is not None:
                        nvr_obj.firmware_version = ext_info["firmware_version"]
                    if ext_info["serial_number"] is not None:
                        nvr_obj.serial_number = ext_info["serial_number"]
                    if ext_info["mac_address"] is not None:
                        nvr_obj.mac_address = ext_info["mac_address"]
                    if ext_info["uptime"] is not None:
                        nvr_obj.uptime = ext_info["uptime"]
                    if ext_info["cpu_usage"] is not None:
                        nvr_obj.cpu_usage = ext_info["cpu_usage"]
                    if ext_info["memory_usage"] is not None:
                        nvr_obj.memory_usage = ext_info["memory_usage"]
                    if ext_info["hdd_status"] is not None:
                        nvr_obj.hdd_status = ext_info["hdd_status"]
                    if ext_info["device_time"] is not None:
                        nvr_obj.device_time = ext_info["device_time"]
                    session.add(nvr_obj)

                payload = cam_payload

            for d in payload:
                stmt = select(Camera).where(
                    Camera.nvr_ip == nvr_obj.ip, Camera.channel_id == d["channel_id"]
                )
                db_cam = session.exec(stmt).first()
                new_status = "Online" if d["online"] else "Offline"

                nvr_label = nvr_obj.name if nvr_obj.name else nvr_obj.ip
                final_name = f"{nvr_label} CH {d['channel_id']}"

                if not db_cam:
                    db_cam = Camera(
                        name=final_name,
                        ip=d["ip"],
                        nvr_ip=nvr_obj.ip,
                        channel_id=d["channel_id"],
                        status=new_status,
                        last_online=datetime.now() if d["online"] else None,
                    )
                    session.add(db_cam)
                    session.flush()
                    session.refresh(db_cam)
                else:
                    if db_cam.ip != d["ip"]:
                        db_cam.ip = d["ip"]

                    if db_cam.status != new_status:
                        was_ever_online = db_cam.last_online is not None
                        log_event(
                            session,
                            category="Camera",
                            action=f"CAMERA_{new_status.upper()}",
                            details=f"{db_cam.name} ({db_cam.ip})",
                            level="INFO" if new_status == "Online" else "WARNING",
                            group_id=nvr_obj.group_id,
                            target_type="Camera",
                            target_id=db_cam.id,
                        )
                        if new_status == "Offline" and was_ever_online:
                            browser_offline_by_group[nvr_obj.group_id].append(db_cam)
                            session.add(
                                DowntimeEvent(
                                    camera_id=db_cam.id, start_time=datetime.now()
                                )
                            )
                        elif new_status == "Online":
                            if was_ever_online:
                                browser_recovered_by_group[nvr_obj.group_id].append(
                                    db_cam
                                )
                            open_evt = session.exec(
                                select(DowntimeEvent).where(
                                    DowntimeEvent.camera_id == db_cam.id,
                                    DowntimeEvent.end_time == None,
                                )
                            ).first()
                            if open_evt:
                                open_evt.end_time = datetime.now()
                                session.add(open_evt)

                        db_cam.status = new_status

                    if d["online"]:
                        db_cam.last_online = datetime.now()
                    session.add(db_cam)

                cams_processed.append(db_cam)

        # Broadcast aggregated browser alerts per group for offline cameras
        for gid, cams in browser_offline_by_group.items():
            count = len(cams)
            if count == 0:
                continue
            grp_name = ""
            if gid:
                grp = session.get(NVRGroup, gid)
                if grp and grp.name:
                    grp_name = f" [{grp.name}]"
            if count == 1:
                c = cams[0]
                title = f"قطع ارتباط: {c.name}"
                body = f"ارتباط دوربین {c.name} ({c.ip}) قطع شد"
            else:
                names_str = "، ".join([c.name for c in cams[:3]])
                if count > 3:
                    names_str += f" و {count - 3} دوربین دیگر"
                title = f"قطع ارتباط تجمیعی {count} دوربین{grp_name}"
                body = f"{count} دوربین قطع شدند: {names_str}"

            await broadcast_alert("camera_offline", title, body, "error", count=count)

        # Broadcast aggregated browser alerts per group for recovered cameras
        for gid, cams in browser_recovered_by_group.items():
            count = len(cams)
            if count == 0:
                continue
            grp_name = ""
            if gid:
                grp = session.get(NVRGroup, gid)
                if grp and grp.name:
                    grp_name = f" [{grp.name}]"
            if count == 1:
                c = cams[0]
                title = f"اتصال مجدد: {c.name}"
                body = f"ارتباط دوربین {c.name} ({c.ip}) مجدداً برقرار شد"
            else:
                names_str = "، ".join([c.name for c in cams[:3]])
                if count > 3:
                    names_str += f" و {count - 3} دوربین دیگر"
                title = f"اتصال مجدد تجمیعی {count} دوربین{grp_name}"
                body = f"{count} دوربین مجدداً متصل شدند: {names_str}"

            await broadcast_alert(
                "camera_recovered", title, body, "success", count=count
            )

        nvr_list = session.exec(select(NVR)).all()
        nvr_groups = {n.ip: n.group_id for n in nvr_list}

        # دسته‌بندی دوربین‌ها به ازای هر گروه
        groups_map = {}
        for cam in cams_processed:
            gid = nvr_groups.get(cam.nvr_ip)
            if gid not in groups_map:
                groups_map[gid] = []
            groups_map[gid].append(cam)

        all_group_tele_events = {}
        group_id_to_name = {}

        # کشف نام همه گروه‌ها
        all_db_groups = session.exec(select(NVRGroup)).all()
        group_names_db = {g.id: g.name for g in all_db_groups}

        for gid, group_cams in groups_map.items():
            gname = group_names_db.get(gid, f"گروه {gid}" if gid else "دوربین‌های عمومی")
            group_id_to_name[gid] = gname

            t_events, m_alerts, m_recov = await process_batch_alerts(
                session, group_cams, startup_grace=is_startup_grace
            )

            if t_events:
                all_group_tele_events[gid] = t_events

            # ارسال ایمیل‌های گروهی
            if m_alerts:
                res = await asyncio.to_thread(
                    send_email_batch,
                    "دوربین‌ها قطع شدند",
                    m_alerts,
                    "warning",
                    gid,
                    "camera_offline",
                )
                is_ok = res is True
                status_txt = "با موفقیت انجام شد" if is_ok else "با خطا مواجه شد"
                log_event(
                    session,
                    category="Alert",
                    action="MAIL_ALERT",
                    details=f"ارسال {len(m_alerts)} هشدار ایمیل برای گروه {gid} {status_txt}",
                    level="INFO" if is_ok else "ERROR",
                    group_id=gid,
                )
                if not is_ok:
                    await broadcast_alert(
                        "delivery_failure",
                        "خطای ارسال ایمیل",
                        f"خطا در ارسال ایمیل برای دوربین‌های قطع شده: {res}",
                        "warning",
                    )
            if m_recov:
                res = await asyncio.to_thread(
                    send_email_batch,
                    "دوربین‌ها برگشتند",
                    m_recov,
                    "success",
                    gid,
                    "camera_recovered",
                )
                if res is not True:
                    await broadcast_alert(
                        "delivery_failure",
                        "خطای ارسال ایمیل",
                        f"خطا در ارسال ایمیل برای دوربین‌های متصل شده: {res}",
                        "warning",
                    )

        # ----------------------------------------------------
        # تجمیع کامل و ارسال تک‌پیام چرخه‌ای تلگرام (Rich Messages)
        # ----------------------------------------------------
        if (all_group_tele_events or cycle_nvr_events) and not is_startup_grace:
            events_by_group = {
                group_id_to_name.get(gid, "بدون گروه"): evts
                for gid, evts in all_group_tele_events.items()
                if evts
            }
            conf = get_config_dict()

            # ۱. ارسال تک‌پیام جامع به مدیران کل (Super Admins)
            if conf.get("TELEGRAM_ENABLED") == "true":
                admin_chat_ids = [
                    c.strip()
                    for c in conf.get("TELEGRAM_CHAT_IDS", "").split(",")
                    if c.strip()
                ]
                if admin_chat_ids:
                    admin_msg = build_aggregated_telegram_message(
                        events_by_group=events_by_group,
                        nvr_events=cycle_nvr_events,
                    )
                    res = await asyncio.to_thread(
                        send_telegram_raw, conf, admin_msg, admin_chat_ids
                    )
                    is_ok = res is True
                    log_event(
                        session,
                        category="Alert",
                        action="TELEGRAM_ALERT",
                        details=f"ارسال گزارش تجمیعی تلگرام برای مدیران ارشد ({'موفق' if is_ok else 'خطا'})",
                        level="INFO" if is_ok else "ERROR",
                    )
                    if not is_ok:
                        await broadcast_alert(
                            "delivery_failure",
                            "خطای ارسال تلگرام",
                            f"خطا در ارسال پیام تجمیعی تلگرام: {res}",
                            "warning",
                        )

            # ۲. ارسال پیام‌های تفکیک‌شده برای مدیران IT
            all_it_users = session.exec(
                select(User).where(User.role == "it_manager", User.is_active == True)
            ).all()

            for u in all_it_users:
                alert_settings = session.exec(
                    select(UserAlertSettings).where(UserAlertSettings.user_id == u.id)
                ).first()
                if not (
                    alert_settings
                    and alert_settings.telegram_enabled
                    and alert_settings.telegram_chat_ids
                ):
                    continue

                user_chat_ids = [
                    c.strip()
                    for c in alert_settings.telegram_chat_ids.split(",")
                    if c.strip()
                ][:1]
                if not user_chat_ids:
                    continue

                allowed_gids = set()
                if u.group_id is not None:
                    allowed_gids.add(u.group_id)
                if u.accessible_group_ids:
                    try:
                        for x in u.accessible_group_ids.split(","):
                            if x.strip().isdigit():
                                allowed_gids.add(int(x.strip()))
                    except Exception:
                        pass
                has_all_access = u.group_id is None and not u.accessible_group_ids

                user_events_by_group = {
                    group_id_to_name.get(gid, "بدون گروه"): evts
                    for gid, evts in all_group_tele_events.items()
                    if (has_all_access or gid in allowed_gids) and evts
                }
                user_nvr_events = [
                    nev
                    for nev in cycle_nvr_events
                    if has_all_access or (nev.get("group_id") in allowed_gids)
                ]

                if user_events_by_group or user_nvr_events:
                    user_msg = build_aggregated_telegram_message(
                        events_by_group=user_events_by_group,
                        nvr_events=user_nvr_events,
                    )
                    await asyncio.to_thread(
                        send_telegram_raw, conf, user_msg, user_chat_ids
                    )

        # Check hourly downtime summary
        now = datetime.now()
        if last_summary_hour != now.hour:
            summary_lines = []
            hour_start = now.replace(minute=0, second=0, microsecond=0)
            for c in cams_processed:
                if c.status == "Offline":
                    offline_since = c.last_online or now
                    overlap_start = max(hour_start, offline_since)
                    minutes_down = int((now - overlap_start).total_seconds() / 60)
                    if minutes_down > 0:
                        summary_lines.append(f"{c.name}: {minutes_down}m")

            if summary_lines:
                header = f"📊 گزارش قطعی ساعتی ({now.strftime('%H:00')})"
                await asyncio.to_thread(
                    send_telegram_batch,
                    header,
                    summary_lines,
                    "info",
                    None,
                    "downtime_hourly_summary",
                )
                log_event(session, "Telegram", "Sent", "گزارش خلاصه ساعتی")
            last_summary_hour = now.hour

        session.commit()

        cam_data = []
        for c in cams_processed:
            cam_data.append(
                {
                    "id": c.id,
                    "name": c.name,
                    "ip": c.ip,
                    "nvr_ip": c.nvr_ip,
                    "channel_id": c.channel_id,
                    "status": c.status,
                    "importance": c.importance,
                    "last_online": c.last_online.isoformat() if c.last_online else None,
                    "latitude": c.latitude,
                    "longitude": c.longitude,
                    "x_pos": c.x_pos,
                    "y_pos": c.y_pos,
                    "fov_angle": c.fov_angle,
                    "fov_radius": c.fov_radius,
                    "fov_spread": c.fov_spread,
                    "plan_id": c.plan_id,
                    "model": c.model,
                    "recording_scheduled": c.recording_scheduled,
                    "recording_schedule_type": c.recording_schedule_type,
                    "recording_hours_24h": c.recording_hours_24h,
                    "oldest_record": c.oldest_record.isoformat()
                    if c.oldest_record
                    else None,
                    "total_record_size_gb": c.total_record_size_gb,
                    "total_record_duration_hours": c.total_record_duration_hours,
                    "stats_last_updated": c.stats_last_updated.isoformat()
                    if c.stats_last_updated
                    else None,
                }
            )
        await broadcast({"type": "cameras", "data": cam_data})


async def task_sync_nvr_configs(nvr_ip: str | None = None):
    with Session(engine) as session:
        query = select(NVR).where(NVR.enabled == True, NVR.status != "AuthError")
        if nvr_ip:
            query = query.where(NVR.ip == nvr_ip)
        nvrs = session.exec(query).all()
    if not nvrs:
        return
    logger.info(f"Syncing recording config for {len(nvrs)} NVRs in parallel...")
    results = await asyncio.gather(
        *[
            asyncio.to_thread(sync_recording_schedule_config, n.ip, n.user, n.password)
            for n in nvrs
        ],
        return_exceptions=True,
    )
    for n, r in zip(nvrs, results):
        if isinstance(r, Exception):
            logger.error(f"Config sync failed for {n.ip}: {r}")


async def task_sync_nvr_stats(nvr_ip: str | None = None):
    with Session(engine) as session:
        query = select(NVR).where(NVR.enabled == True, NVR.status != "AuthError")
        if nvr_ip:
            query = query.where(NVR.ip == nvr_ip)
        nvrs = session.exec(query).all()
    if not nvrs:
        return
    logger.info(f"Syncing recording stats for {len(nvrs)} NVRs in parallel...")
    results = await asyncio.gather(
        *[
            asyncio.to_thread(sync_recording_stats_from_nvr, n.ip, n.user, n.password)
            for n in nvrs
        ],
        return_exceptions=True,
    )
    for n, r in zip(nvrs, results):
        if isinstance(r, Exception):
            logger.error(f"Stats sync failed for {n.ip}: {r}")


async def task_sync_nvr_health(nvr_ip: str | None = None):
    from app.database import decrypt_password

    with Session(engine) as session:
        query = select(NVR).where(NVR.enabled == True, NVR.status != "AuthError")
        if nvr_ip:
            query = query.where(NVR.ip == nvr_ip)
        nvrs = session.exec(query).all()
    if not nvrs:
        return
    logger.info(f"Syncing NVR health/extended info for {len(nvrs)} NVRs in parallel...")

    def sync_one_nvr_health(n_ip, n_user, n_pass_enc):
        try:
            password = decrypt_password(n_pass_enc)
            req_sess = requests.Session()
            req_sess.trust_env = False
            return fetch_nvr_extended_info(n_ip, n_user, password, req_sess)
        except Exception as e:
            logger.error(f"Failed to fetch health info for {n_ip}: {e}")
            return None

    results = await asyncio.gather(
        *[
            asyncio.to_thread(sync_one_nvr_health, n.ip, n.user, n.password)
            for n in nvrs
        ],
        return_exceptions=True,
    )

    with Session(engine) as session:
        for nvr, ext_info in zip(nvrs, results):
            if isinstance(ext_info, Exception) or not ext_info:
                continue

            db_nvr = session.get(NVR, nvr.ip)
            if db_nvr and ext_info:
                if ext_info["model"] is not None:
                    db_nvr.model = ext_info["model"]
                if ext_info["firmware_version"] is not None:
                    db_nvr.firmware_version = ext_info["firmware_version"]
                if ext_info["serial_number"] is not None:
                    db_nvr.serial_number = ext_info["serial_number"]
                if ext_info["mac_address"] is not None:
                    db_nvr.mac_address = ext_info["mac_address"]
                if ext_info["uptime"] is not None:
                    db_nvr.uptime = ext_info["uptime"]
                # CPU and RAM saved fields cleared/removed per user request
                db_nvr.cpu_usage = None
                db_nvr.memory_usage = None
                if ext_info["hdd_status"] is not None:
                    db_nvr.hdd_status = ext_info["hdd_status"]
                if ext_info["device_time"] is not None:
                    db_nvr.device_time = ext_info["device_time"]
                session.add(db_nvr)
        session.commit()


async def task_cleanup_database():
    with Session(engine) as session:
        logger.info("Starting database logs cleanup...")
        retention_setting = session.get(Settings, "LIMIT_LOG_RETENTION_DAYS")
        days = (
            int(retention_setting.value)
            if retention_setting and retention_setting.value.isdigit()
            else 90
        )
        cleanup_old_data(session, days=days)
        session.commit()


async def task_sync_camera_names():
    with Session(engine) as session:
        nvrs = session.exec(
            select(NVR).where(NVR.enabled == True, NVR.status != "AuthError")
        ).all()
    if not nvrs:
        return
    logger.info(f"Syncing camera names for {len(nvrs)} NVRs in parallel...")
    results = await asyncio.gather(
        *[
            asyncio.to_thread(sync_camera_names_from_nvr, n.ip, n.user, n.password)
            for n in nvrs
        ],
        return_exceptions=True,
    )
    for n, r in zip(nvrs, results):
        if isinstance(r, Exception):
            logger.error(f"Camera name sync failed for {n.ip}: {r}")


def get_substream_channel_id(chan_id_str: str) -> str:
    try:
        val = int(chan_id_str)
        if val >= 100:
            return f"{(val // 10) * 10 + 2}"
        else:
            return f"{val * 100 + 2}"
    except Exception:
        return f"{chan_id_str}02"


async def task_capture_camera_snapshots(nvr_ip: str | None = None):
    from app.database import decrypt_password

    with Session(engine) as session:
        query = select(Camera).where(Camera.status == "Online")
        if nvr_ip:
            query = query.where(Camera.nvr_ip == nvr_ip)
        cameras = session.exec(query).all()
        nvrs = {n.ip: n for n in session.exec(select(NVR)).all()}

    os.makedirs("data/snapshots", exist_ok=True)

    async def capture_one(cam):
        nvr = nvrs.get(cam.nvr_ip)
        if not nvr or not nvr.enabled:
            return

        password = decrypt_password(nvr.password)
        sub_chan = get_substream_channel_id(cam.channel_id)
        url = f"http://{nvr.ip}/ISAPI/Streaming/channels/{sub_chan}/picture"

        def fetch():
            s = requests.Session()
            s.trust_env = False
            r = s.get(
                url, auth=HTTPDigestAuth(nvr.user, password), timeout=8, proxies={}
            )
            if r.status_code == 200:
                return r.content
            try:
                main_chan = f"{(int(sub_chan) // 10) * 10 + 1}"
            except Exception:
                main_chan = f"{cam.channel_id}01"
            fallback_url = (
                f"http://{nvr.ip}/ISAPI/Streaming/channels/{main_chan}/picture"
            )
            r = s.get(
                fallback_url,
                auth=HTTPDigestAuth(nvr.user, password),
                timeout=8,
                proxies={},
            )
            if r.status_code == 200:
                return r.content
            return None

        try:
            img_data = await asyncio.to_thread(fetch)
            if img_data:
                file_path = f"data/snapshots/camera_{cam.id}.jpg"
                with open(file_path, "wb") as f:
                    f.write(img_data)
                logger.info(f"Captured snapshot for camera {cam.name} (id: {cam.id})")
            else:
                logger.warning(
                    f"Failed to capture snapshot for camera {cam.name} (id: {cam.id}) - NVR returned error status"
                )
        except Exception as e:
            logger.error(
                f"Failed to capture snapshot for camera {cam.name} (id: {cam.id}): {e}"
            )

    if cameras:
        logger.info(f"Capturing snapshots for {len(cameras)} cameras in parallel...")
        await asyncio.gather(*[capture_one(cam) for cam in cameras])


async def task_analyze_outages(override_now: datetime | None = None):
    from collections import defaultdict
    from datetime import datetime, timedelta

    from sqlmodel import select

    from app.database import NVR, Camera, DowntimeEvent, OutageExplanation, Settings

    logger.info("شروع تسک تحلیل قطعی‌های قطعی...")
    now = override_now or datetime.now()
    # نرمال‌سازی زمان فعلی جهت جلوگیری از تفاوت‌های میکروثانیه‌ای
    now = now.replace(second=0, microsecond=0)

    with Session(engine) as session:
        # ۱. خواندن تنظیمات مربوطه
        min_hours_cfg = session.get(Settings, "OUTAGE_MIN_HOURS_TO_EXPLAIN")
        try:
            min_hours = float(min_hours_cfg.value) if min_hours_cfg else 2.0
        except ValueError:
            min_hours = 2.0

        deadline_hours_cfg = session.get(Settings, "OUTAGE_EXPLANATION_DEADLINE_HOURS")
        deadline_hours = int(deadline_hours_cfg.value) if deadline_hours_cfg else 24

        # مشخص کردن بازه روزهای تقویمی برای جلوگیری از گپ‌های محاسباتی
        yesterday_date = (now - timedelta(days=1)).date()

        # واکشی زمان آخرین تحلیل موفق
        last_run_cfg = session.get(Settings, "OUTAGE_LAST_ANALYSIS_TIME")
        start_date = yesterday_date
        if last_run_cfg:
            try:
                last_run_dt = datetime.fromisoformat(last_run_cfg.value)
                start_date = last_run_dt.date()
            except Exception:
                start_date = yesterday_date

        # محدود کردن حداکثر تحلیل به ۷ روز گذشته برای جلوگیری از پردازش فوق سنگین
        seven_days_ago = (now - timedelta(days=7)).date()
        start_date = max(start_date, seven_days_ago)

        # تولید لیست روزهایی که باید تحلیل شوند
        days_to_analyze = []
        current_day = start_date
        while current_day <= yesterday_date:
            days_to_analyze.append(current_day)
            current_day += timedelta(days=1)

        if not days_to_analyze:
            days_to_analyze = [yesterday_date]

        logger.info(f"روزهای مورد بررسی جهت تحلیل قطعی‌ها: {days_to_analyze}")
        cameras = session.exec(select(Camera)).all()
        added_count = 0

        for day in days_to_analyze:
            start_dt = datetime.combine(day, datetime.min.time()).replace(microsecond=0)
            end_dt = datetime.combine(day, datetime.max.time()).replace(microsecond=0)

            logger.info(f"در حال تحلیل بازه استاندارد {start_dt} تا {end_dt}...")

            # واکشی فله‌ای تمام رویدادهای خاموشی هم‌پوشان با بازه کل برای رفع گلوگاه N+1
            events = session.exec(
                select(DowntimeEvent).where(
                    DowntimeEvent.start_time < end_dt,
                    (DowntimeEvent.end_time == None)
                    | (DowntimeEvent.end_time > start_dt),
                )
            ).all()

            # دسته‌بندی کارآمد رویدادها در حافظه
            events_by_camera = defaultdict(list)
            for e in events:
                events_by_camera[e.camera_id].append(e)

            # بررسی خاموشی برای هر دوربین
            for camera in cameras:
                cam_events = events_by_camera[camera.id]
                total_seconds = 0
                for e in cam_events:
                    e_end = e.end_time or now
                    overlap_start = max(e.start_time, start_dt)
                    overlap_end = min(e_end, end_dt)
                    if overlap_end > overlap_start:
                        total_seconds += (overlap_end - overlap_start).total_seconds()

                total_mins = int(total_seconds / 60)
                if total_mins >= min_hours * 60:
                    # بررسی عدم وجود تکرار بر اساس بازه نرمال‌شده منحصربه‌فرد روزانه
                    existing = session.exec(
                        select(OutageExplanation).where(
                            OutageExplanation.camera_id == camera.id,
                            OutageExplanation.start_time == start_dt,
                            OutageExplanation.end_time == end_dt,
                        )
                    ).first()
                    if existing:
                        continue

                    nvr = session.get(NVR, camera.nvr_ip)
                    group_id = nvr.group_id if nvr else None

                    # ثبت رکورد رفع ابهام تجمیعی روزانه
                    outage_exp = OutageExplanation(
                        camera_id=camera.id,
                        downtime_event_id=None,
                        group_id=group_id,
                        start_time=start_dt,
                        end_time=end_dt,
                        created_at=now,
                        assigned_deadline=now + timedelta(hours=deadline_hours),
                        explanation_type=None,
                        explanation_detail=None,
                        explained_by_user_id=None,
                        explained_at=None,
                    )
                    session.add(outage_exp)
                    added_count += 1

        # به‌روزرسانی تنظیمات آخرین زمان تحلیل موفق
        if not last_run_cfg:
            last_run_cfg = Settings(
                key="OUTAGE_LAST_ANALYSIS_TIME",
                value=now.isoformat(),
                description="Last time outages were analyzed",
            )
        else:
            last_run_cfg.value = now.isoformat()
        session.add(last_run_cfg)

        session.commit()
        logger.info(
            f"تسک تحلیل قطعی‌ها با موفقیت پایان یافت. تعداد {added_count} مورد قطعی جدید ثبت شد."
        )


async def start_monitor_loop():
    logger.info("Monitor loop started (via scheduler)...")
    with Session(engine) as session:
        log_event(
            session,
            category="System",
            action="SERVICE_STARTED",
            details="راه‌اندازی سرویس مانیتورینگ (توسط زمان‌بند)",
            level="INFO",
        )
    from app.services.scheduler import scheduler

    try:
        await scheduler.start()
    except asyncio.CancelledError:
        await scheduler.stop()
