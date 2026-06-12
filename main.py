import asyncio
import json
import os
import jdatetime
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
import secrets
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel
from sqlmodel import Session, select, col
from database import init_db, get_session, Camera, Log, NVR, Settings, DowntimeEvent, engine, sqlite_file_name
from monitor import start_monitor_loop
from alerts import send_email_raw, send_telegram_raw, get_config_dict

class CsvContent(BaseModel):
    content: str

monitor_task = None

def seed_defaults():
    with Session(engine) as session:
        # تنظیمات پیش‌فرض پایه (در صورت نبود فایل)
        defaults = {
            "MAIL_ENABLED": ("false", "Enable Email"),
            "MAIL_SERVER": ("smtp.gmail.com", "Server"),
            "MAIL_PORT": ("587", "Port"),
            "MAIL_USER": ("email@gmail.com", "User"),
            "MAIL_PASS": ("password", "Pass"),
            "MAIL_RECIPIENTS": ("admin@example.com", "Recipients"),
            "MAIL_FIRST_ALERT_DELAY_MINUTES": ("1", "Normal Delay"),
            "MAIL_LOW_IMPORTANCE_DELAY_MINUTES": ("30", "Low Imp. Delay"),
            "MAIL_ALERT_FREQUENCY_MINUTES": ("60", "Frequency"),
            "MAIL_MUTE_AFTER_N_ALERTS": ("3", "Mute After N"),
            "TELEGRAM_ENABLED": ("false", "Enable Telegram"),
            "TELEGRAM_BOT_TOKEN": ("", "Bot Token"),
            "TELEGRAM_CHAT_IDS": ("", "Chat IDs"),
            "TELEGRAM_PROXY": ("", "Proxy URL"),
            "TELEGRAM_FIRST_ALERT_DELAY_MINUTES": ("1", "Normal Delay"),
            "TELEGRAM_LOW_IMPORTANCE_DELAY_MINUTES": ("15", "Low Imp. Delay"),
            "TELEGRAM_ALERT_FREQUENCY_MINUTES": ("30", "Frequency"),
            "TELEGRAM_MUTE_AFTER_N_ALERTS": ("3", "Mute After N"),
        }

        # تلاش برای خواندن فایل تنظیمات اولیه
        init_data = {}
        if os.path.exists("init_config.json"):
            try:
                with open("init_config.json", "r", encoding="utf-8") as f:
                    init_data = json.load(f)
            except Exception as e:
                print(f"Error loading init_config.json: {e}")

        # ۱. وارد کردن تنظیمات (ترکیب فایل JSON با پیش‌فرض‌ها)
        json_settings = init_data.get("settings", {})
        for key, (default_val, desc) in defaults.items():
            # اگر در دیتابیس نبود، آن را ایجاد کن
            if not session.get(Settings, key):
                val = json_settings.get(key, default_val)
                session.add(Settings(key=key, value=str(val), description=desc))

        # ۲. وارد کردن NVR های اولیه
        json_nvrs = init_data.get("nvrs", [])
        for nvr_data in json_nvrs:
            if not session.get(NVR, nvr_data["ip"]):
                session.add(NVR(
                    ip=nvr_data["ip"],
                    user=nvr_data["user"],
                    password=nvr_data.get("password", ""),
                    enabled=nvr_data.get("enabled", True)
                ))

        session.commit()

@asynccontextmanager
async def lifespan(app: FastAPI):
    global monitor_task
    init_db()
    seed_defaults()
    monitor_task = asyncio.create_task(start_monitor_loop())
    yield
    if monitor_task: monitor_task.cancel()
    try: await monitor_task
    except: pass

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
security = HTTPBasic()

def authenticate_user(credentials: HTTPBasicCredentials = Depends(security)):
    correct_username = secrets.compare_digest(credentials.username, "admin")
    correct_password = secrets.compare_digest(credentials.password, "admin")
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="نام کاربری یا رمز عبور اشتباه است",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username
# Serve Static Assets (CSS, JS)
app.mount("/static", StaticFiles(directory="static"), name="static")
# Enforce authentication globally for all API requests under /api
app.router.dependencies.append(Depends(authenticate_user))

# Serve Index HTML
@app.get("/", dependencies=[Depends(authenticate_user)])
def read_root(): 
    return FileResponse('static/index.html')

@app.post("/api/monitor/restart")
async def restart_monitor():
    global monitor_task
    if monitor_task:
        monitor_task.cancel()
        try: await monitor_task
        except: pass
    monitor_task = asyncio.create_task(start_monitor_loop())
    return {"status": "restarted"}

@app.post("/api/data/purge")
def purge_data(session: Session = Depends(get_session)):
    # Reset Camera Status
    cameras = session.exec(select(Camera)).all()
    for cam in cameras:
        cam.status = "Unknown"
        cam.last_online = None
        cam.mail_alert_count = 0
        cam.mail_last_alert = None
        cam.telegram_alert_count = 0
        cam.telegram_last_alert = None
        session.add(cam)
    
    # Delete Logs and Downtime Events
    session.query(Log).delete()
    session.query(DowntimeEvent).delete()

    session.commit()
    return {"status": "ok"}


# --- TEST ENDPOINTS ---
@app.post("/api/test/email")
def test_mail():
    conf = get_config_dict()
    res = send_email_raw(conf, "تست سامانه مانیتورینگ", "<h3>ایمیل به درستی کار میکنه!</h3>")
    if res is True: return {"status": "ok"}
    raise HTTPException(status_code=400, detail=str(res))

@app.post("/api/test/telegram")
def test_telegram():
    conf = get_config_dict()
    res = send_telegram_raw(conf, "✅ *تست سامانه مانیتورینگ*\nاعلان های تلگرام درسته!")
    if res is True: return {"status": "ok"}
    raise HTTPException(status_code=400, detail=str(res))

# --- API ---
@app.get("/api/nvrs", response_model=list[NVR])
def get_nvrs(session: Session = Depends(get_session)): return session.exec(select(NVR)).all()

@app.post("/api/nvrs")
def create_nvr(nvr: NVR, session: Session = Depends(get_session)):
    session.add(nvr)
    session.commit()
    return nvr

@app.delete("/api/nvrs/{ip}")
def delete_nvr(ip: str, session: Session = Depends(get_session)):
    session.delete(session.get(NVR, ip))
    session.commit()
    return {"ok": True}

@app.get("/api/cameras", response_model=list[Camera])
def get_cameras(session: Session = Depends(get_session)): return session.exec(select(Camera).order_by(Camera.nvr_ip, Camera.channel_id)).all()

@app.put("/api/cameras/{id}")
def update_cam(id: int, p: dict, session: Session = Depends(get_session)):
    c = session.get(Camera, id)
    if "importance" in p: c.importance = int(p["importance"])
    session.add(c)
    session.commit()
    return c

@app.get("/api/settings", response_model=list[Settings])
def get_settings(session: Session = Depends(get_session)): return session.exec(select(Settings)).all()

@app.put("/api/settings/{key}")
def update_setting(key: str, p: Settings, session: Session = Depends(get_session)):
    s = session.get(Settings, key)
    s.value = p.value
    session.add(s)
    session.commit()
    return s

@app.get("/api/config/csv", response_class=PlainTextResponse)
def get_csv():
    if os.path.exists("camera_names.csv"):
        with open("camera_names.csv", "r", encoding="utf-8-sig") as f: return f.read()
    return ""

@app.post("/api/config/csv")
def save_csv(payload: CsvContent):
    with open("camera_names.csv", "w", encoding="utf-8-sig") as f: f.write(payload.content)
    return {"ok": True}

@app.get("/api/logs")
def search_logs(q: str = None, limit: int = 50, offset: int = 0, session: Session = Depends(get_session)):
    query = select(Log).order_by(Log.timestamp.desc()).offset(offset).limit(limit)
    if q: 
        if q in ['Camera','Telegram','Mail','Service']: query = query.where(col(Log.log_type) == q)
        else: query = query.where(col(Log.details).contains(q) | col(Log.log_type).contains(q))
    logs = session.exec(query).all()
    
    output = []
    for l in logs:
        jd = jdatetime.datetime.fromgregorian(datetime=l.timestamp)
        months = {1:'فروردین',2:'اردیبهشت',3:'خرداد',4:'تیر',5:'مرداد',6:'شهریور',7:'مهر',8:'آبان',9:'آذر',10:'دی',11:'بهمن',12:'اسفند'}
        days = {'Sat':'شنبه','Sun':'یکشنبه','Mon':'دوشنبه','Tue':'سه‌شنبه','Wed':'چهارشنبه','Thu':'پنج‌شنبه','Fri':'جمعه'}
        shamsi = f"{days[l.timestamp.strftime('%a')]} {jd.day} {months[jd.month]} {jd.year} {jd.strftime('%H:%M')}"
        
        item = l.model_dump()
        item['shamsi_date'] = shamsi
        output.append(item)
    return output

def calculate_downtime_range(session, cam_id, start_ts, end_ts):
    events = session.exec(select(DowntimeEvent).where(
        DowntimeEvent.camera_id == cam_id,
        DowntimeEvent.start_time < end_ts,
        (DowntimeEvent.end_time == None) | (DowntimeEvent.end_time > start_ts)
    )).all()
    total_minutes = 0
    now = datetime.now()
    for e in events:
        e_end = e.end_time or now
        overlap_start = max(e.start_time, start_ts)
        overlap_end = min(e_end, end_ts)
        if overlap_end > overlap_start:
            total_minutes += (overlap_end - overlap_start).total_seconds() / 60
    return int(total_minutes)

@app.get("/api/stats/{cam_id}")
def get_cam_stats(cam_id: int, session: Session = Depends(get_session)):
    now = datetime.now()
    d1 = calculate_downtime_range(session, cam_id, now - timedelta(hours=1), now)
    d24 = calculate_downtime_range(session, cam_id, now - timedelta(hours=24), now)
    return {"down_1h": d1, "down_24h": d24}

@app.get("/api/reports/generate")
def generate_report(start: float, end: float, session: Session = Depends(get_session)):
    start_dt = datetime.fromtimestamp(start)
    end_dt = datetime.fromtimestamp(end)
    cameras = session.exec(select(Camera)).all()
    report_data = []
    for c in cameras:
        mins = calculate_downtime_range(session, c.id, start_dt, end_dt)
        if mins > 0:
            report_data.append({"name": c.name, "ip": c.ip, "mins": mins})
    report_data.sort(key=lambda x: x['mins'], reverse=True)
    return report_data