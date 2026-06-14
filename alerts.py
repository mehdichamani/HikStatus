import smtplib
import requests
import jdatetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from database import Session, engine, Settings


def get_persian_datetime():
    now = jdatetime.datetime.now()
    months = {1:'فروردین',2:'اردیبهشت',3:'خرداد',4:'تیر',5:'مرداد',6:'شهریور',7:'مهر',8:'آبان',9:'آذر',10:'دی',11:'بهمن',12:'اسفند'}
    days = {'Sat':'شنبه','Sun':'یکشنبه','Mon':'دوشنبه','Tue':'سه‌شنبه','Wed':'چهارشنبه','Thu':'پنج‌شنبه','Fri':'جمعه'}
    return f"{days[now.strftime('%a')]} {now.day} {months[now.month]} {now.year} - ساعت {now.strftime('%H:%M')}"

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

def send_email_batch(subject, lines, alert_type="warning"):
    conf = get_config_dict()
    if conf.get("MAIL_ENABLED") != "true" or not lines: return False
    
    colors = {
        "error": "#dc3545",
        "warning": "#ffc107", 
        "success": "#28a745",
        "info": "#17a2b8"
    }
    icons = {
        "error": "🚨",
        "warning": "⚠️",
        "success": "✅",
        "info": "ℹ️"
    }
    
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
    
    return send_email_raw(conf, subject, body)

def send_email_raw(conf, subject, body):
    try:
        sender = conf.get("MAIL_USER")
        recipients = conf.get("MAIL_RECIPIENTS", "").split(",")
        server = conf.get("MAIL_SERVER")
        port = int(conf.get("MAIL_PORT", 587))
        password = conf.get("MAIL_PASS")
        
        msg = MIMEMultipart()
        msg['From'] = sender
        msg['To'] = ", ".join(recipients)
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'html'))

        with smtplib.SMTP(server, port) as s:
            s.starttls()
            s.login(sender, password)
            s.sendmail(sender, recipients, msg.as_string())
        return True
    except Exception as e:
        print(f"📧 خطای ایمیل: {e}")
        return str(e)

def send_telegram_batch(header, lines, alert_type="warning"):
    conf = get_config_dict()
    if conf.get("TELEGRAM_ENABLED") != "true" or not lines: return False
    
    icons = {
        "error": "🚨",
        "warning": "⚠️", 
        "success": "✅",
        "info": "ℹ️"
    }
    icon = icons.get(alert_type, "⚠️")
    
    msg = f"{icon} <b>{header}</b>\n"
    msg += "━" * 20 + "\n"
    for line in lines:
        safe_line = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        msg += f"  • {safe_line}\n"
    msg += "━" * 20 + "\n"
    msg += f"📅 {get_persian_datetime()}"
    
    return send_telegram_raw(conf, msg)

def send_telegram_raw(conf, message):
    token = conf.get("TELEGRAM_BOT_TOKEN")
    raw_ids = conf.get("TELEGRAM_CHAT_IDS", "")
    proxy_url = conf.get("TELEGRAM_PROXY", "")
    
    if not token or not raw_ids: return "Missing Token/ID"
    
    chat_ids = [c.strip() for c in raw_ids.split(",") if c.strip()]
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    
    # Configure Proxy
    proxies = {'https': proxy_url, 'http': proxy_url} if proxy_url else None

    errors = []
    for cid in chat_ids:
        try:
            payload = {'chat_id': cid, 'text': message, 'parse_mode': 'HTML'}
            requests.post(url, data=payload, proxies=proxies, timeout=10)
        except Exception as e:
            print(f"✈️ خطای تلگرام: {e}")
            errors.append(str(e))
            
    return errors[0] if errors else True