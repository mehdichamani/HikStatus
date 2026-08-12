import smtplib
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests
from loguru import logger
from sqlmodel import select

from app.database import Session, Settings, User, UserAlertSettings, engine

# Central notification policy.  The Settings rows are seeded by main.py and
# deliberately default to enabled, so upgrading does not silence any existing
# alert.  A missing row is also treated as enabled for the same reason.
NOTIFICATION_EVENTS = (
    ("camera_offline", "قطع دوربین"),
    ("camera_recovered", "وصل مجدد دوربین"),
    ("nvr_offline", "قطع ارتباط NVR"),
    ("nvr_recovered", "وصل مجدد NVR"),
    ("nvr_auth_error", "خطای احراز هویت NVR"),
    ("camera_topology_changed", "افزودن یا حذف دوربین"),
    ("recording_changed", "تغییر تنظیمات ضبط"),
    ("downtime_hourly_summary", "گزارش قطعی ساعتی"),
    ("delivery_failure", "خطای ارسال اعلان"),
)
NOTIFICATION_CHANNELS = ("email", "telegram", "browser")


def notification_setting_key(event_type, channel=None):
    prefix = f"NOTIFY_{event_type.upper()}"
    return f"{prefix}_{channel.upper()}" if channel else f"{prefix}_ENABLED"


def notification_default_settings():
    event_labels = dict(NOTIFICATION_EVENTS)
    return {
        notification_setting_key(event_type): ("true", f"فعال‌سازی اعلان {label}")
        for event_type, label in NOTIFICATION_EVENTS
    } | {
        notification_setting_key(event_type, channel): (
            "true",
            f"ارسال {event_labels[event_type]} از کانال {channel}",
        )
        for event_type, _label in NOTIFICATION_EVENTS
        for channel in NOTIFICATION_CHANNELS
    }


def format_shamsi_datetime(dt):
    if not dt:
        return "نامشخص"
    import datetime

    import jdatetime

    if isinstance(dt, datetime.datetime):
        jd = jdatetime.datetime.fromgregorian(datetime=dt)
    elif isinstance(dt, jdatetime.datetime):
        jd = dt
    else:
        try:
            jd = jdatetime.datetime.fromgregorian(datetime=dt)
        except Exception:
            return str(dt)

    weekdays = {
        0: "شنبه",
        1: "یک‌شنبه",
        2: "دوشنبه",
        3: "سه‌شنبه",
        4: "چهارشنبه",
        5: "پنج‌شنبه",
        6: "جمعه",
    }

    months = {
        1: "فروردین",
        2: "اردیبهشت",
        3: "خرداد",
        4: "تیر",
        5: "مرداد",
        6: "شهریور",
        7: "مهر",
        8: "آبان",
        9: "آذر",
        10: "دی",
        11: "بهمن",
        12: "اسفند",
    }

    weekday_str = weekdays.get(jd.weekday(), "")
    day_str = str(jd.day)
    month_str = months.get(jd.month, "")
    time_str = jd.strftime("%H:%M")

    res = f"{weekday_str} {day_str} {month_str} {time_str}"

    eng = "0123456789"
    per = "۰۱۲۳۴۵۶۷۸۹"
    translation_table = str.maketrans(eng, per)
    return res.translate(translation_table)


def get_persian_datetime():
    import datetime

    return format_shamsi_datetime(datetime.datetime.now())


_config_cache = None
_config_cache_time = 0
_CACHE_TTL = 30


def get_config_dict():
    import time

    global _config_cache, _config_cache_time
    now = time.time()
    if _config_cache and (now - _config_cache_time) < _CACHE_TTL:
        return _config_cache
    with Session(engine) as session:
        settings = session.query(Settings).all()
        _config_cache = {s.key: s.value for s in settings}
        _config_cache_time = now
        return _config_cache


def invalidate_config_cache():
    global _config_cache, _config_cache_time
    _config_cache = None
    _config_cache_time = 0


def is_notification_enabled(event_type, channel):
    """Return whether an event may be delivered through a channel.

    Event detection and audit logging are intentionally outside this policy.
    """
    if not event_type:
        return True
    conf = get_config_dict()
    master = conf.get(notification_setting_key(event_type), "true") == "true"
    channel_enabled = (
        conf.get(notification_setting_key(event_type, channel), "true") == "true"
    )
    return master and channel_enabled


def get_email_body(subject, lines, alert_type):
    colors = {
        "error": "#dc3545",
        "warning": "#ffc107",
        "success": "#28a745",
        "info": "#17a2b8",
    }
    icons = {"error": "🚨", "warning": "⚠️", "success": "✅", "info": "ℹ️"}

    color = colors.get(alert_type, "#ffc107")
    icon = icons.get(alert_type, "⚠️")

    items_html = ""
    for line in lines:
        items_html += f"""
        <tr>
            <td style="padding:12px 15px;border-bottom:1px solid #eee;font-size:14px;color:#333;">{line}</td>
        </tr>"""

    body = f"""
    <!DOCTYPE html>
    <html dir="rtl" lang="fa">
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Tahoma,Arial,sans-serif;">
        <div style="max-width:600px;margin:20px auto;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
            <div style="background-color:{color};padding:20px;text-align:center;">
                <span style="font-size:32px;">{icon}</span>
                <h1 style="color:#fff;margin:10px 0 0 0;font-size:20px;">سامانه مانیتورینگ HikStatus</h1>
            </div>
            <div style="padding:25px;">
                <h2 style="color:{color};margin-top:0;font-size:18px;border-bottom:2px solid {color};padding-bottom:10px;">{subject}</h2>
                <table style="width:100%;border-collapse:collapse;margin-top:15px;">
                    {items_html}
                </table>
                <div style="margin-top:25px;padding:15px;background-color:#f8f9fa;border-radius:5px;text-align:center;">
                    <p style="margin:0;color:#666;font-size:12px;">تاریخ ارسال: {get_persian_datetime()}</p>
                </div>
            </div>
            <div style="background-color:#333;padding:15px;text-align:center;">
                <p style="margin:0;color:#aaa;font-size:11px;">گروه صنعتی شیشه کاوه | شرکت اروم شیشه ساچی</p>
            </div>
        </div>
    </body>
    </html>"""
    return body


def send_email_batch(
    subject, lines, alert_type="warning", group_id=None, event_type=None
):
    if not is_notification_enabled(event_type, "email"):
        return True
    conf = get_config_dict()
    sent_status = True

    # 1. Send to admin
    if conf.get("MAIL_ENABLED") == "true" and lines:
        body = get_email_body(subject, lines, alert_type)
        recipients = [
            r.strip() for r in conf.get("MAIL_RECIPIENTS", "").split(",") if r.strip()
        ]
        if recipients:
            res = send_email_raw(conf, subject, body, recipients)
            if res is not True:
                sent_status = res

    # 2. Send to IT manager users
    if group_id is not None and lines:
        with Session(engine) as session:
            all_it_users = session.exec(
                select(User).where(User.role == "it_manager", User.is_active == True)
            ).all()
            users = []
            for u in all_it_users:
                if u.group_id == group_id:
                    users.append(u)
                elif u.accessible_group_ids:
                    try:
                        ids = [
                            int(x.strip())
                            for x in u.accessible_group_ids.split(",")
                            if x.strip().isdigit()
                        ]
                        if group_id in ids:
                            users.append(u)
                    except Exception:
                        pass
                elif u.group_id is None and not u.accessible_group_ids:
                    users.append(u)
            for u in users:
                alert_settings = session.exec(
                    select(UserAlertSettings).where(UserAlertSettings.user_id == u.id)
                ).first()
                if (
                    alert_settings
                    and alert_settings.mail_enabled
                    and alert_settings.mail_recipients
                ):
                    # Pick only the first item in case database still has commas
                    recipients = [
                        r.strip()
                        for r in alert_settings.mail_recipients.split(",")
                        if r.strip()
                    ][:1]
                    if recipients:
                        body = get_email_body(subject, lines, alert_type)
                        res = send_email_raw(conf, subject, body, recipients)
                        if res is not True:
                            sent_status = res

    return sent_status


def send_email_raw(conf, subject, body, recipients):
    try:
        sender = conf.get("MAIL_USER")
        server = conf.get("MAIL_SERVER")
        port = int(conf.get("MAIL_PORT", 587))
        password = conf.get("MAIL_PASS")

        msg = MIMEMultipart()
        msg["From"] = sender
        msg["To"] = ", ".join(recipients)
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "html"))

        with smtplib.SMTP(server, port) as s:
            s.starttls()
            s.login(sender, password)
            s.sendmail(sender, recipients, msg.as_string())
        return True
    except Exception as e:
        logger.error(f"Email error: {e}")
        return str(e)


def get_telegram_message(header, lines, alert_type):
    icons = {"error": "🚨", "warning": "⚠️", "success": "✅", "info": "ℹ️"}
    icon = icons.get(alert_type, "⚠️")

    msg = f"{icon} <b>{header}</b>\n"
    msg += "━" * 20 + "\n"
    for line in lines:
        safe_line = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        msg += f"  • {safe_line}\n"
    msg += "━" * 20 + "\n"
    msg += f"📅 {get_persian_datetime()}"
    return msg


def build_aggregated_telegram_message(events_by_group):
    """
    ساخت پیام تجمیعی HTML برای ارسال به تلگرام بر اساس گروه‌های NVR و دوربین‌ها.
    """
    total_groups = len(events_by_group)
    total_offline = 0
    total_online = 0

    for group_name, events in events_by_group.items():
        for ev in events:
            if isinstance(ev, dict):
                ev_type = str(ev.get("type", "")).lower()
                if "offline" in ev_type or "off" in ev_type:
                    total_offline += 1
                else:
                    total_online += 1
            else:
                total_offline += 1

    summary_parts = [f"{total_groups} گروه درگیر"]
    if total_offline > 0:
        summary_parts.append(f"🔴 {total_offline} دوربین قطع")
    if total_online > 0:
        summary_parts.append(f"🟢 {total_online} دوربین وصل مجدد")
    summary_str = " | ".join(summary_parts)

    msg = "🚨 <b>گزارش تجمیعی پایش HikStatus</b>\n"
    msg += f"📅 <i>تاریخ: {get_persian_datetime()}</i>\n"
    msg += f"📊 <b>خلاصه وضعیت:</b> {summary_str}\n"

    for group_name, events in events_by_group.items():
        g_offline = 0
        g_online = 0
        event_lines = []
        for ev in events:
            if isinstance(ev, dict):
                ev_type = str(ev.get("type", "")).lower()
                is_off = "offline" in ev_type or "off" in ev_type
                if is_off:
                    g_offline += 1
                    icon = "🔴"
                else:
                    g_online += 1
                    icon = "🟢"
                name = ev.get("name", "دوربین")
                ip = ev.get("ip", "")
                time_str = ev.get("time", "")
                ip_part = f" (<code>{ip}</code>)" if ip else ""
                time_part = (
                    f" - قطعی از {time_str}"
                    if (is_off and time_str)
                    else (f" - {time_str}" if time_str else "")
                )
                event_lines.append(f"• {icon} {name}{ip_part}{time_part}")
            else:
                g_offline += 1
                event_lines.append(f"• 🔴 {ev}")

        status_parts = []
        if g_offline > 0:
            status_parts.append(f"🔴 {g_offline} قطعی")
        if g_online > 0:
            status_parts.append(f"🟢 {g_online} وصل")
        status_str = f" ({', '.join(status_parts)})" if status_parts else ""

        msg += "\n───────────────────\n"
        msg += f"🏢 <b>گروه: {group_name}</b>{status_str}\n"
        msg += "<blockquote expandable>\n"
        msg += "\n".join(event_lines) + "\n"
        msg += "</blockquote>\n"

    msg += "───────────────────\n"
    msg += "⚙️ <i>سامانه هوشمند پایش تجهیزات HikStatus</i>"
    return msg


def split_telegram_message(message, max_chars=3800):
    """
    تقسیم هوشمند پیام‌های عریض تلگرام به چنک‌های متوازن زیر max_chars
    همراه با حفظ توازن کامل تگ‌های HTML (b, blockquote) و درج شماره بخش.
    """
    if not message or len(message) <= max_chars:
        return [message]

    effective_max = max_chars - 50

    lines = message.split("\n")
    flattened_lines = []
    for l in lines:
        if len(l) <= effective_max:
            flattened_lines.append(l)
        else:
            for start in range(0, len(l), effective_max):
                flattened_lines.append(l[start : start + effective_max])

    raw_chunks = []
    current_lines = []
    current_len = 0

    for line in flattened_lines:
        line_len = len(line) + 1
        if current_len + line_len > effective_max and current_lines:
            raw_chunks.append("\n".join(current_lines))
            current_lines = [line]
            current_len = line_len
        else:
            current_lines.append(line)
            current_len += line_len

    if current_lines:
        raw_chunks.append("\n".join(current_lines))

    total = len(raw_chunks)
    final_chunks = []

    for i, chunk in enumerate(raw_chunks, 1):
        suffix = f"\n\n<i>(بخش {i} از {total})</i>" if total > 1 else ""
        text = chunk + suffix

        # حفظ توازن تگ‌های <b>
        b_diff = text.count("<b>") - text.count("</b>")
        if b_diff > 0:
            text = text + ("</b>" * b_diff)
        elif b_diff < 0:
            text = ("<b>" * abs(b_diff)) + text

        # حفظ توازن تگ‌های <blockquote>
        bq_open = text.count("<blockquote expandable>") + text.count("<blockquote>")
        bq_close = text.count("</blockquote>")
        bq_diff = bq_open - bq_close
        if bq_diff > 0:
            text = text + ("\n</blockquote>" * bq_diff)
        elif bq_diff < 0:
            text = ("<blockquote expandable>\n" * abs(bq_diff)) + text

        final_chunks.append(text)

    return final_chunks


def send_telegram_batch(
    header, lines, alert_type="warning", group_id=None, event_type=None
):
    if not is_notification_enabled(event_type, "telegram"):
        return True
    conf = get_config_dict()
    sent_status = True

    # 1. Send to admin
    if conf.get("TELEGRAM_ENABLED") == "true" and lines:
        msg = get_telegram_message(header, lines, alert_type)
        chat_ids = [
            c.strip() for c in conf.get("TELEGRAM_CHAT_IDS", "").split(",") if c.strip()
        ]
        if chat_ids:
            res = send_telegram_raw(conf, msg, chat_ids)
            if res is not True:
                sent_status = res

    # 2. Send to IT manager users
    if group_id is not None and lines:
        with Session(engine) as session:
            all_it_users = session.exec(
                select(User).where(User.role == "it_manager", User.is_active == True)
            ).all()
            users = []
            for u in all_it_users:
                if u.group_id == group_id:
                    users.append(u)
                elif u.accessible_group_ids:
                    try:
                        ids = [
                            int(x.strip())
                            for x in u.accessible_group_ids.split(",")
                            if x.strip().isdigit()
                        ]
                        if group_id in ids:
                            users.append(u)
                    except Exception:
                        pass
                elif u.group_id is None and not u.accessible_group_ids:
                    users.append(u)
            for u in users:
                alert_settings = session.exec(
                    select(UserAlertSettings).where(UserAlertSettings.user_id == u.id)
                ).first()
                if (
                    alert_settings
                    and alert_settings.telegram_enabled
                    and alert_settings.telegram_chat_ids
                ):
                    chat_ids = [
                        c.strip()
                        for c in alert_settings.telegram_chat_ids.split(",")
                        if c.strip()
                    ][:1]
                    if chat_ids:
                        msg = get_telegram_message(header, lines, alert_type)
                        res = send_telegram_raw(conf, msg, chat_ids)
                        if res is not True:
                            sent_status = res

    return sent_status


def send_telegram_raw(conf, message, chat_ids):
    token = conf.get("TELEGRAM_BOT_TOKEN")
    proxy_url = conf.get("TELEGRAM_PROXY", "")

    if not token or not chat_ids:
        return "Missing Token/ID"

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    proxies = {"https": proxy_url, "http": proxy_url} if proxy_url else None

    # اگر طول پیام بیشتر از ۳۸۰۰ کاراکتر باشد، به چند بخش شکسته می‌شود
    if isinstance(message, str) and len(message) > 3800:
        chunks = split_telegram_message(message, max_chars=3800)
    elif isinstance(message, str):
        chunks = [message]
    else:
        chunks = [str(message)]

    errors = []
    for cid in chat_ids:
        for chunk in chunks:
            try:
                payload = {"chat_id": cid, "text": chunk, "parse_mode": "HTML"}
                resp = requests.post(url, data=payload, proxies=proxies, timeout=10)
                if resp.status_code != 200:
                    logger.warning(
                        f"Telegram sendMessage status {resp.status_code}: {resp.text}"
                    )
                    errors.append(f"HTTP {resp.status_code}: {resp.text}")
            except Exception as e:
                logger.error(f"Telegram error: {e}")
                errors.append(str(e))

    return errors[0] if errors else True


def send_change_alert(
    title, lines, alert_type="warning", group_id=None, event_type=None
):
    """Send both email and telegram alerts in a background thread (non-blocking)."""

    def _bg_send():
        try:
            send_email_batch(
                title,
                lines,
                alert_type=alert_type,
                group_id=group_id,
                event_type=event_type,
            )
        except Exception as e:
            logger.error(f"Change alert email error: {e}")
        try:
            send_telegram_batch(
                title,
                lines,
                alert_type=alert_type,
                group_id=group_id,
                event_type=event_type,
            )
        except Exception as e:
            logger.error(f"Change alert telegram error: {e}")

    threading.Thread(target=_bg_send, daemon=True).start()
