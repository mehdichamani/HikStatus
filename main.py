from __future__ import annotations
import asyncio
import json
import os
import jdatetime
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
import secrets
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, Depends, HTTPException, status, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, PlainTextResponse, RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from sqlmodel import Session, select, col
from database import init_db, get_session, Camera, Log, NVR, Settings, DowntimeEvent, engine, sqlite_file_name
from monitor import start_monitor_loop, set_broadcast_callback
from alerts import send_email_raw, send_telegram_raw, get_config_dict, invalidate_config_cache, get_persian_datetime

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    
    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
    
    async def broadcast(self, message: dict):
        dead = []
        for conn in self.active_connections:
            try:
                await conn.send_json(message)
            except:
                dead.append(conn)
        for d in dead:
            self.active_connections.remove(d)

ws_manager = ConnectionManager()

class CsvContent(BaseModel):
    content: str

class LoginRequest(BaseModel):
    username: str
    password: str

monitor_task = None

def seed_defaults():
    with Session(engine) as session:
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
    set_broadcast_callback(ws_manager.broadcast)
    monitor_task = asyncio.create_task(start_monitor_loop())
    yield
    if monitor_task:
        monitor_task.cancel()
        try:
            await monitor_task
        except asyncio.CancelledError:
            pass

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if response.status_code == 401 and not request.url.path.startswith("/api/"):
            return RedirectResponse(url="/login")
        return response

app.add_middleware(AuthMiddleware)

_sessions = {}
_login_attempts = {}

def get_admin_credentials():
    username = os.environ.get("ADMIN_USER", "admin")
    password = os.environ.get("ADMIN_PASS", "admin")
    return username, password

def create_session_token():
    return secrets.token_hex(32)

def check_rate_limit(ip):
    now = datetime.now()
    if ip not in _login_attempts:
        _login_attempts[ip] = []
    _login_attempts[ip] = [t for t in _login_attempts[ip] if (now - t).seconds < 60]
    if len(_login_attempts[ip]) >= 5:
        return False
    _login_attempts[ip].append(now)
    return True

@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.cookies.get("session_token")
    if not token or token not in _sessions:
        await websocket.close(code=4001)
        return
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)

def require_auth(request: Request):
    token = request.cookies.get("session_token")
    if not token or token not in _sessions:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return _sessions[token]

@app.post("/api/auth/login")
def login(payload: LoginRequest, request: Request, response: Response):
    client_ip = request.client.host
    if not check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="تعداد تلاش‌ها بیش از حد مجاز است. لطفاً یک دقیقه صبر کنید")
    
    admin_user, admin_pass = get_admin_credentials()
    if payload.username == admin_user and payload.password == admin_pass:
        token = create_session_token()
        _sessions[token] = payload.username
        response.set_cookie(
            key="session_token",
            value=token,
            httponly=True,
            samesite="lax",
            max_age=86400
        )
        return {"status": "ok"}
    raise HTTPException(status_code=401, detail="نام کاربری یا رمز عبور اشتباه است")

@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token and token in _sessions:
        del _sessions[token]
    response.delete_cookie("session_token")
    return {"status": "ok"}
# Serve Static Assets (CSS, JS)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/login")
def login_page():
    return FileResponse('static/login.html')

@app.get("/", dependencies=[Depends(require_auth)])
def read_root(): 
    return FileResponse('static/index.html')

@app.post("/api/monitor/restart", dependencies=[Depends(require_auth)])
async def restart_monitor():
    global monitor_task
    if monitor_task:
        monitor_task.cancel()
        try:
            await monitor_task
        except asyncio.CancelledError:
            pass
    monitor_task = asyncio.create_task(start_monitor_loop())
    return {"status": "restarted"}

@app.post("/api/data/purge", dependencies=[Depends(require_auth)])
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
@app.post("/api/test/email", dependencies=[Depends(require_auth)])
def test_mail():
    conf = get_config_dict()
    res = send_email_raw(conf, "تست سامانه مانیتورینگ", "<div style='text-align:center;padding:20px;'><h3 style='color:#28a745;'>ایمیل به درستی کار میکنه!</h3><p>تاریخ: " + get_persian_datetime() + "</p></div>")
    if res is True: return {"status": "ok"}
    raise HTTPException(status_code=400, detail="خطا در ارسال ایمیل. تنظیمات را بررسی کنید.")

@app.post("/api/test/telegram", dependencies=[Depends(require_auth)])
def test_telegram():
    conf = get_config_dict()
    res = send_telegram_raw(conf, "✅ <b>تست سامانه مانیتورینگ</b>\nاعلان‌های تلگرام درسته!\n📅 " + get_persian_datetime())
    if res is True: return {"status": "ok"}
    raise HTTPException(status_code=400, detail="خطا در ارسال تلگرام. تنظیمات را بررسی کنید.")

# --- API ---
@app.get("/api/nvrs", response_model=list[NVR], dependencies=[Depends(require_auth)])
def get_nvrs(session: Session = Depends(get_session)): return session.exec(select(NVR)).all()

@app.post("/api/nvrs", dependencies=[Depends(require_auth)])
def create_nvr(nvr: NVR, session: Session = Depends(get_session)):
    session.add(nvr)
    session.commit()
    return nvr

@app.delete("/api/nvrs/{ip}", dependencies=[Depends(require_auth)])
def delete_nvr(ip: str, session: Session = Depends(get_session)):
    nvr = session.get(NVR, ip)
    if not nvr:
        raise HTTPException(status_code=404, detail="NVR not found")
    session.delete(nvr)
    session.commit()
    return {"ok": True}

@app.get("/api/cameras", response_model=list[Camera], dependencies=[Depends(require_auth)])
def get_cameras(session: Session = Depends(get_session)): return session.exec(select(Camera).order_by(Camera.nvr_ip, Camera.channel_id)).all()

@app.put("/api/cameras/{id}", dependencies=[Depends(require_auth)])
def update_cam(id: int, p: dict, session: Session = Depends(get_session)):
    c = session.get(Camera, id)
    if not c:
        raise HTTPException(status_code=404, detail="Camera not found")
    if "importance" in p:
        importance = int(p["importance"])
        if importance not in (1, 2, 3):
            raise HTTPException(status_code=400, detail="Importance must be 1, 2, or 3")
        c.importance = importance
    session.add(c)
    session.commit()
    return c

@app.get("/api/settings", response_model=list[Settings], dependencies=[Depends(require_auth)])
def get_settings(session: Session = Depends(get_session)): return session.exec(select(Settings)).all()

@app.put("/api/settings/{key}", dependencies=[Depends(require_auth)])
def update_setting(key: str, p: Settings, session: Session = Depends(get_session)):
    s = session.get(Settings, key)
    if not s:
        raise HTTPException(status_code=404, detail="Setting not found")
    s.value = p.value
    session.add(s)
    session.commit()
    invalidate_config_cache()
    return s

@app.get("/api/config/csv", response_class=PlainTextResponse, dependencies=[Depends(require_auth)])
def get_csv():
    if os.path.exists("camera_names.csv"):
        with open("camera_names.csv", "r", encoding="utf-8-sig") as f: return f.read()
    return ""

@app.post("/api/config/csv", dependencies=[Depends(require_auth)])
def save_csv(payload: CsvContent):
    with open("camera_names.csv", "w", encoding="utf-8-sig") as f: f.write(payload.content)
    return {"ok": True}

@app.get("/api/logs", dependencies=[Depends(require_auth)])
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
        days = ['دوشنبه','سه‌شنبه','چهارشنبه','پنج‌شنبه','جمعه','شنبه','یکشنبه']
        shamsi = f"{days[l.timestamp.weekday()]} {jd.day} {months[jd.month]} {jd.year} {jd.strftime('%H:%M')}"
        
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

@app.get("/api/stats/{cam_id}", dependencies=[Depends(require_auth)])
def get_cam_stats(cam_id: int, session: Session = Depends(get_session)):
    now = datetime.now()
    d1 = calculate_downtime_range(session, cam_id, now - timedelta(hours=1), now)
    d24 = calculate_downtime_range(session, cam_id, now - timedelta(hours=24), now)
    return {"down_1h": d1, "down_24h": d24}

@app.get("/api/reports/generate", dependencies=[Depends(require_auth)])
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