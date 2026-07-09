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
from fastapi import FastAPI, Depends, HTTPException, status, Request, Response, WebSocket, WebSocketDisconnect, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, PlainTextResponse, RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from sqlmodel import Session, select, col
from database import init_db, get_session, Camera, Log, NVR, Settings, DowntimeEvent, engine, sqlite_file_name
from monitor import start_monitor_loop, set_broadcast_callback, sync_camera_names_from_nvr
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


class LoginRequest(BaseModel):
    username: str
    password: str

monitor_task = None

def seed_database(session: Session, init_from_json: bool):
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
        "MAP_TYPE": ("floor", "Map Type"),
        "MAP_IMAGE": ("", "Custom Floor Plan Image URL"),
        "MAP_START_LAT": ("37.796067", "Default Map Start Latitude"),
        "MAP_START_LNG": ("45.062508", "Default Map Start Longitude"),
    }

    # Delete all records from all tables
    session.query(DowntimeEvent).delete()
    session.query(Camera).delete()
    session.query(NVR).delete()
    session.query(Log).delete()
    session.query(Settings).delete()
    session.commit()

    init_data = {}
    if init_from_json and os.path.exists("init_config.json"):
        try:
            with open("init_config.json", "r", encoding="utf-8") as f:
                init_data = json.load(f)
        except Exception as e:
            print(f"Error loading init_config.json: {e}")

    # Seed Settings
    json_settings = init_data.get("settings", {})
    for key, (default_val, desc) in defaults.items():
        val = json_settings.get(key, default_val) if init_from_json else default_val
        session.add(Settings(key=key, value=str(val), description=desc))

    # Seed NVRs if init_from_json
    if init_from_json:
        json_nvrs = init_data.get("nvrs", [])
        for nvr_data in json_nvrs:
            session.add(NVR(
                ip=nvr_data["ip"],
                name=nvr_data.get("name"),
                user=nvr_data["user"],
                password=nvr_data.get("password", ""),
                enabled=nvr_data.get("enabled", True)
            ))
    session.commit()

def seed_defaults():
    with Session(engine) as session:
        # Check if settings table is already seeded
        existing_settings_count = len(session.exec(select(Settings)).all())
        if existing_settings_count > 0:
            return

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
            "MAP_TYPE": ("floor", "Map Type"),
            "MAP_IMAGE": ("", "Custom Floor Plan Image URL"),
            "MAP_START_LAT": ("37.796067", "Default Map Start Latitude"),
            "MAP_START_LNG": ("45.062508", "Default Map Start Longitude"),
        }

        init_data = {}
        if os.path.exists("init_config.json"):
            try:
                with open("init_config.json", "r", encoding="utf-8") as f:
                    init_data = json.load(f)
            except Exception as e:
                print(f"Error loading init_config.json: {e}")

        json_settings = init_data.get("settings", {})
        for key, (default_val, desc) in defaults.items():
            if not session.get(Settings, key):
                val = json_settings.get(key, default_val)
                session.add(Settings(key=key, value=str(val), description=desc))

        json_nvrs = init_data.get("nvrs", [])
        for nvr_data in json_nvrs:
            if not session.get(NVR, nvr_data["ip"]):
                session.add(NVR(
                    ip=nvr_data["ip"],
                    name=nvr_data.get("name"),
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

async def restart_monitor():
    global monitor_task
    if monitor_task:
        monitor_task.cancel()
        try:
            await monitor_task
        except asyncio.CancelledError:
            pass
    monitor_task = asyncio.create_task(start_monitor_loop())

@app.post("/api/monitor/restart", dependencies=[Depends(require_auth)])
async def api_restart_monitor():
    await restart_monitor()
    return {"status": "restarted"}

@app.post("/api/data/purge/empty", dependencies=[Depends(require_auth)])
async def purge_empty(session: Session = Depends(get_session)):
    seed_database(session, init_from_json=False)
    invalidate_config_cache()
    await restart_monitor()
    return {"status": "ok"}

@app.post("/api/data/purge/init", dependencies=[Depends(require_auth)])
async def purge_init(session: Session = Depends(get_session)):
    seed_database(session, init_from_json=True)
    invalidate_config_cache()
    await restart_monitor()
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
    cams = session.exec(select(Camera).where(Camera.nvr_ip == ip)).all()
    for cam in cams:
        downtimes = session.exec(select(DowntimeEvent).where(DowntimeEvent.camera_id == cam.id)).all()
        for dt in downtimes:
            session.delete(dt)
        session.delete(cam)
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
    if "latitude" in p:
        c.latitude = float(p["latitude"]) if p["latitude"] is not None else None
    if "longitude" in p:
        c.longitude = float(p["longitude"]) if p["longitude"] is not None else None
    if "x_pos" in p:
        c.x_pos = float(p["x_pos"]) if p["x_pos"] is not None else None
    if "y_pos" in p:
        c.y_pos = float(p["y_pos"]) if p["y_pos"] is not None else None
    if "fov_angle" in p:
        c.fov_angle = float(p["fov_angle"]) if p["fov_angle"] is not None else None
    if "fov_radius" in p:
        c.fov_radius = float(p["fov_radius"]) if p["fov_radius"] is not None else None
    if "fov_spread" in p:
        c.fov_spread = float(p["fov_spread"]) if p["fov_spread"] is not None else None
    session.add(c)
    session.commit()
    return c

@app.post("/api/map/upload", dependencies=[Depends(require_auth)])
async def upload_map(file: UploadFile = File(...)):
    os.makedirs("static", exist_ok=True)
    ext = file.filename.split(".")[-1].lower()
    if ext not in ["png", "jpg", "jpeg", "svg"]:
        raise HTTPException(status_code=400, detail="فرمت فایل باید JPG، PNG یا SVG باشد")
    
    filename = f"floor_plan.{ext}"
    filepath = os.path.join("static", filename)
    
    for old_ext in ["png", "jpg", "jpeg", "svg"]:
        old_path = os.path.join("static", f"floor_plan.{old_ext}")
        if os.path.exists(old_path):
            try:
                os.remove(old_path)
            except:
                pass
                
    with open(filepath, "wb") as f:
        f.write(await file.read())
        
    with Session(engine) as session:
        s = session.get(Settings, "MAP_IMAGE")
        if s:
            s.value = f"/static/{filename}"
            session.add(s)
            session.commit()
            invalidate_config_cache()
            
    return {"status": "ok", "url": f"/static/{filename}"}

@app.get("/api/stats/heatmap", dependencies=[Depends(require_auth)])
def get_heatmap_stats(session: Session = Depends(get_session)):
    now = datetime.now()
    thirty_days_ago = now - timedelta(days=30)
    
    events = session.exec(select(DowntimeEvent).where(
        (DowntimeEvent.end_time == None) | (DowntimeEvent.end_time >= thirty_days_ago)
    )).all()
    
    grid = [[0 for _ in range(24)] for _ in range(7)]
    
    for event in events:
        start = max(event.start_time, thirty_days_ago)
        end = event.end_time or now
        end = min(end, now)
        
        if end <= start:
            continue
            
        current = start
        while current < end:
            next_hour = (current + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
            next_hour = min(next_hour, end)
            
            overlap_minutes = (next_hour - current).total_seconds() / 60
            
            day = current.weekday()
            hour = current.hour
            grid[day][hour] += overlap_minutes
            
            current = next_hour
            
    output = []
    for d in range(7):
        for h in range(24):
            output.append({"day": d, "hour": h, "value": int(grid[d][h])})
    return output

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

@app.post("/api/config/sync-names", dependencies=[Depends(require_auth)])
async def sync_names(session: Session = Depends(get_session)):
    nvrs = session.exec(select(NVR).where(NVR.enabled == True)).all()
    if not nvrs:
        raise HTTPException(status_code=400, detail="No enabled NVRs found to sync")
    
    results = []
    for n in nvrs:
        success, msg = await asyncio.to_thread(sync_camera_names_from_nvr, n.ip, n.user, n.password, session)
        results.append({"nvr": n.ip, "success": success, "message": msg})
        
    return {"results": results}

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