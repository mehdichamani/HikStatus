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
from typing import Optional
from sqlmodel import Session, select, col
from database import init_db, get_session, Camera, Log, NVR, NVRGroup, Settings, DowntimeEvent, User, UserAlertSettings, UserSession, MapPlan, hash_password, verify_password, engine, sqlite_file_name, encrypt_password, decrypt_password
from monitor import start_monitor_loop, set_broadcast_callback, sync_camera_names_from_nvr
from alerts import send_email_raw, send_telegram_raw, get_config_dict, invalidate_config_cache, get_persian_datetime, format_shamsi_datetime

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
    session.query(UserAlertSettings).delete()
    session.query(User).delete()
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

_login_attempts = {}

def get_admin_credentials():
    username = os.environ.get("ADMIN_USER", "admin")
    password = os.environ.get("ADMIN_PASS", "admin")
    return username, password

def verify_admin_password(input_password: str, env_password_val: str) -> tuple[bool, bool]:
    parts = env_password_val.split(":")
    is_hash = False
    if len(parts) == 2:
        salt_hex, hash_hex = parts
        if len(salt_hex) == 32 and len(hash_hex) == 64:
            try:
                int(salt_hex, 16)
                int(hash_hex, 16)
                is_hash = True
            except ValueError:
                pass
    if is_hash:
        return verify_password(input_password, env_password_val), False
    return input_password == env_password_val, True


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
    if not token:
        await websocket.close(code=4001)
        return
    with Session(engine) as db:
        session_record = db.exec(select(UserSession).where(UserSession.token == token)).first()
        if not session_record or session_record.expires_at < datetime.now():
            await websocket.close(code=4001)
            return
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)

def require_auth(request: Request, response: Response, db: Session = Depends(get_session)) -> dict:
    """Returns {username, role, group_id, user_id} or raises 401."""
    if request.method in ("POST", "PUT", "DELETE", "PATCH"):
        origin = request.headers.get("origin")
        referer = request.headers.get("referer")
        base_url = str(request.base_url).rstrip("/")
        
        if origin:
            if not origin.rstrip("/").startswith(base_url):
                raise HTTPException(status_code=403, detail="درخواست غیرمجاز (CSRF Origin)")
        elif referer:
            if not referer.rstrip("/").startswith(base_url):
                raise HTTPException(status_code=403, detail="درخواست غیرمجاز (CSRF Referer)")

    token = request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    session_record = db.exec(select(UserSession).where(UserSession.token == token)).first()
    if not session_record:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    now = datetime.now()
    if session_record.expires_at < now:
        db.delete(session_record)
        db.commit()
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    # Sliding Expiration: تمدید سشن در صورت فعالیت بیش از ۱ روز
    if session_record.last_activity < now - timedelta(days=1):
        session_record.last_activity = now
        session_record.expires_at = now + timedelta(days=30)
        db.add(session_record)
        db.commit()
        db.refresh(session_record)
        response.set_cookie(key="session_token", value=token, httponly=True, samesite="lax", max_age=30 * 86400)
        
    return {
        "username": session_record.username,
        "role": session_record.role,
        "group_id": session_record.group_id,
        "user_id": session_record.user_id
    }

def require_admin(user: dict = Depends(require_auth)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="فقط مدیر سیستم دسترسی دارد")
    return user

def require_control(user: dict = Depends(require_auth)):
    """admin or group_control."""
    if user["role"] not in ("admin", "group_control"):
        raise HTTPException(status_code=403, detail="دسترسی کنترل الزامی است")
    return user

@app.get("/api/auth/me")
def get_me(user: dict = Depends(require_auth)):
    return user

@app.post("/api/auth/login")
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_session)):
    client_ip = request.client.host
    if not check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="تعداد تلاش‌ها بیش از حد مجاز است. لطفاً یک دقیقه صبر کنید")
    
    admin_user, admin_pass = get_admin_credentials()
    password_ok, password_is_plain = verify_admin_password(payload.password, admin_pass)
    if payload.username == admin_user and password_ok:
        if password_is_plain:
            print("⚠️ SECURITY WARNING: Admin password in .env is stored in plain text (not hashed). Please hash it and replace. Guide: static/admin-password-help.html")
        token = create_session_token()
        
        expires_at = datetime.now() + timedelta(days=30)
        session_record = UserSession(
            token=token,
            username=payload.username,
            role="admin",
            group_id=None,
            user_id=None,
            expires_at=expires_at
        )
        db.add(session_record)
        db.commit()
        
        response.set_cookie(key="session_token", value=token, httponly=True, samesite="lax", max_age=30 * 86400)
        return {"status": "ok", "role": "admin", "password_is_plain": password_is_plain}

    # Check database users
    db_user = db.exec(select(User).where(User.username == payload.username, User.is_active == True)).first()
    if db_user and verify_password(payload.password, db_user.password_hash):
        if ":" not in db_user.password_hash:
            db_user.password_hash = hash_password(payload.password)
            db.add(db_user)
            db.commit()
            db.refresh(db_user)
            
        token = create_session_token()
        
        expires_at = datetime.now() + timedelta(days=30)
        session_record = UserSession(
            token=token,
            username=db_user.username,
            role=db_user.role,
            group_id=db_user.group_id,
            user_id=db_user.id,
            expires_at=expires_at
        )
        db.add(session_record)
        db.commit()
        
        response.set_cookie(key="session_token", value=token, httponly=True, samesite="lax", max_age=30 * 86400)
        return {"status": "ok", "role": db_user.role, "group_id": db_user.group_id}

    raise HTTPException(status_code=401, detail="نام کاربری یا رمز عبور اشتباه است")

@app.post("/api/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_session)):
    token = request.cookies.get("session_token")
    if token:
        session_record = db.exec(select(UserSession).where(UserSession.token == token)).first()
        if session_record:
            db.delete(session_record)
            db.commit()
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


@app.get("/api/data/backup", dependencies=[Depends(require_auth)])
def backup_database():
    if not os.path.exists(sqlite_file_name):
        raise HTTPException(status_code=404, detail="Database file not found")
    from datetime import datetime
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"hikstatus_backup_{timestamp}.db"
    return FileResponse(
        path=sqlite_file_name,
        media_type="application/octet-stream",
        filename=filename,
    )


@app.post("/api/data/restore", dependencies=[Depends(require_auth)])
async def restore_database(file: UploadFile = File(...)):
    if not file.filename or not file.filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="فایل باید با پسوند .db باشد")
    
    MAX_SIZE = 50 * 1024 * 1024
    size = 0
    chunks = []
    while True:
        chunk = await file.read(8192)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_SIZE:
            raise HTTPException(status_code=413, detail="حجم فایل پشتیبان بیش از حد مجاز (۵۰ مگابایت) است")
        chunks.append(chunk)
    contents = b"".join(chunks)

    if not contents.startswith(b"SQLite format 3\x00"):
        raise HTTPException(status_code=400, detail="فایل معتبر SQLite نیست")
    tmp_path = sqlite_file_name + ".restore_tmp"
    try:
        with open(tmp_path, "wb") as f:
            f.write(contents)
        os.replace(tmp_path, sqlite_file_name)
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise HTTPException(status_code=500, detail=f"خطا در بازیابی: {e}")
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
@app.get("/api/nvrs", response_model=list[NVR], response_model_exclude={"password"})
def get_nvrs(session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    if user["role"] == "admin":
        return session.exec(select(NVR)).all()
    return session.exec(select(NVR).where(NVR.group_id == user["group_id"])).all()

@app.post("/api/nvrs")
def create_nvr(nvr: NVR, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    if nvr.password:
        nvr.password = encrypt_password(nvr.password)
    session.add(nvr)
    session.commit()
    return nvr

@app.delete("/api/nvrs/{ip}")
def delete_nvr(ip: str, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
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

@app.put("/api/nvrs/{ip}")
def update_nvr(ip: str, p: dict, session: Session = Depends(get_session), user: dict = Depends(require_control)):
    n = session.get(NVR, ip)
    if not n:
        raise HTTPException(status_code=404, detail="NVR not found")
    if user["role"] != "admin" and n.group_id != user["group_id"]:
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز به این NVR")
    if "name" in p:
        n.name = p["name"]
    if "user" in p:
        n.user = p["user"]
    if "password" in p:
        if p["password"]:
            n.password = encrypt_password(p["password"])
    if "group_id" in p and user["role"] == "admin":
        n.group_id = p["group_id"] if p["group_id"] is not None else None
    session.add(n)
    session.commit()
    return n

@app.get("/api/groups", response_model=list[NVRGroup])
def get_groups(session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    return session.exec(select(NVRGroup)).all()

@app.post("/api/groups")
def create_group(group: NVRGroup, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    session.add(group)
    session.commit()
    return group

@app.put("/api/groups/{id}")
def update_group(id: int, p: dict, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    g = session.get(NVRGroup, id)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    if "name" in p:
        g.name = p["name"]
    if "description" in p:
        g.description = p["description"]
    if "map_center_lat" in p:
        g.map_center_lat = float(p["map_center_lat"]) if p["map_center_lat"] is not None else None
    if "map_center_lng" in p:
        g.map_center_lng = float(p["map_center_lng"]) if p["map_center_lng"] is not None else None
    if "map_zoom" in p:
        g.map_zoom = int(p["map_zoom"]) if p["map_zoom"] is not None else None
    session.add(g)
    session.commit()
    return g

@app.delete("/api/groups/{id}")
def delete_group(id: int, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    g = session.get(NVRGroup, id)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    nvrs = session.exec(select(NVR).where(NVR.group_id == id)).all()
    for n in nvrs:
        n.group_id = None
        session.add(n)
    plans = session.exec(select(MapPlan).where(MapPlan.group_id == id)).all()
    for plan in plans:
        try:
            old_path = plan.image_url.lstrip("/")
            if os.path.exists(old_path):
                os.remove(old_path)
        except Exception:
            pass
        session.delete(plan)
    session.delete(g)
    session.commit()
    return {"ok": True}

@app.get("/api/groups/{id}/plans")
def get_group_plans(id: int, session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    g = session.get(NVRGroup, id)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    plans = session.exec(select(MapPlan).where(MapPlan.group_id == id).order_by(MapPlan.sort_order)).all()
    return [{"id": p.id, "name": p.name, "image_url": p.image_url, "sort_order": p.sort_order} for p in plans]

@app.post("/api/groups/{id}/plans")
async def upload_group_plan(id: int, file: UploadFile = File(...), name: str = "", session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    g = session.get(NVRGroup, id)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    
    os.makedirs("static/plans", exist_ok=True)
    ext = file.filename.split(".")[-1].lower()
    if ext not in ["png", "jpg", "jpeg", "svg"]:
        raise HTTPException(status_code=400, detail="فرمت فایل باید JPG، PNG یا SVG باشد")
    
    import time
    plan_name = name.strip() if name.strip() else file.filename.rsplit(".", 1)[0]
    filename = f"plan_{id}_{int(time.time())}.{ext}"
    filepath = os.path.join("static/plans", filename)
    
    with open(filepath, "wb") as f:
        f.write(await file.read())
    
    existing_count = session.exec(select(MapPlan).where(MapPlan.group_id == id)).all()
    plan = MapPlan(
        group_id=id,
        name=plan_name,
        image_url=f"/static/plans/{filename}",
        sort_order=len(existing_count)
    )
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return {"id": plan.id, "name": plan.name, "image_url": plan.image_url, "sort_order": plan.sort_order}

@app.put("/api/groups/{gid}/plans/{pid}")
def update_group_plan(gid: int, pid: int, p: dict, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    plan = session.get(MapPlan, pid)
    if not plan or plan.group_id != gid:
        raise HTTPException(status_code=404, detail="Plan not found")
    if "name" in p:
        plan.name = p["name"]
    if "sort_order" in p:
        plan.sort_order = int(p["sort_order"])
    session.add(plan)
    session.commit()
    return {"id": plan.id, "name": plan.name, "image_url": plan.image_url, "sort_order": plan.sort_order}

@app.delete("/api/groups/{gid}/plans/{pid}")
def delete_group_plan(gid: int, pid: int, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    plan = session.get(MapPlan, pid)
    if not plan or plan.group_id != gid:
        raise HTTPException(status_code=404, detail="Plan not found")
    try:
        old_path = plan.image_url.lstrip("/")
        if os.path.exists(old_path):
            os.remove(old_path)
    except Exception:
        pass
    session.delete(plan)
    session.commit()
    return {"ok": True}

@app.get("/api/cameras", response_model=list[Camera])
def get_cameras(session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    if user["role"] == "admin":
        return session.exec(select(Camera).order_by(Camera.nvr_ip, Camera.channel_id)).all()
    nvrs = session.exec(select(NVR).where(NVR.group_id == user["group_id"])).all()
    nvr_ips = [n.ip for n in nvrs]
    if not nvr_ips:
        return []
    return session.exec(select(Camera).where(Camera.nvr_ip.in_(nvr_ips)).order_by(Camera.nvr_ip, Camera.channel_id)).all()

@app.put("/api/cameras/{id}")
def update_cam(id: int, p: dict, session: Session = Depends(get_session), user: dict = Depends(require_control)):
    c = session.get(Camera, id)
    if not c:
        raise HTTPException(status_code=404, detail="Camera not found")
    if user["role"] != "admin":
        nvr = session.get(NVR, c.nvr_ip)
        if not nvr or nvr.group_id != user["group_id"]:
            raise HTTPException(status_code=403, detail="دسترسی غیرمجاز به این دوربین")
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
    if "plan_id" in p:
        c.plan_id = int(p["plan_id"]) if p["plan_id"] is not None else None
    if "fov_angle" in p:
        c.fov_angle = float(p["fov_angle"]) if p["fov_angle"] is not None else None
    if "fov_radius" in p:
        c.fov_radius = float(p["fov_radius"]) if p["fov_radius"] is not None else None
    if "fov_spread" in p:
        c.fov_spread = float(p["fov_spread"]) if p["fov_spread"] is not None else None
    session.add(c)
    session.commit()
    return c

@app.get("/api/cameras/{id}/snapshot")
async def get_camera_snapshot(id: int, session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    import requests
    from requests.auth import HTTPDigestAuth
    
    camera = session.get(Camera, id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
        
    nvr = session.exec(select(NVR).where(NVR.ip == camera.nvr_ip)).first()
    if not nvr:
        raise HTTPException(status_code=404, detail="NVR not found")
        
    if user["role"] != "admin" and nvr.group_id != user["group_id"]:
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز به این دوربین")
        
    try:
        chan_int = int(camera.channel_id)
        track_id = str(chan_int * 100 + 1) if chan_int < 100 else camera.channel_id
    except ValueError:
        track_id = camera.channel_id
        
    url = f"http://{nvr.ip}/ISAPI/Streaming/channels/{track_id}/picture"
    
    try:
        def fetch_pic():
            req_sess = requests.Session()
            req_sess.trust_env = False
            decrypted_pass = decrypt_password(nvr.password)
            resp = req_sess.get(url, auth=HTTPDigestAuth(nvr.user, decrypted_pass), timeout=5, proxies={})
            if resp.status_code == 200:
                return resp.content, resp.headers.get("Content-Type", "image/jpeg")
            return None, resp.status_code
            
        content, mime_or_status = await asyncio.to_thread(fetch_pic)
        
        if content:
            return Response(content=content, media_type=mime_or_status)
        else:
            raise HTTPException(status_code=400, detail=f"NVR returned HTTP {mime_or_status}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch snapshot: {str(e)}")

@app.post("/api/map/upload")
async def upload_map(file: UploadFile = File(...), user: dict = Depends(require_admin)):
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

@app.get("/api/stats/heatmap")
def get_heatmap_stats(session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    now = datetime.now()
    thirty_days_ago = now - timedelta(days=30)
    
    if user["role"] == "admin":
        events = session.exec(select(DowntimeEvent).where(
            (DowntimeEvent.end_time == None) | (DowntimeEvent.end_time >= thirty_days_ago)
        )).all()
    else:
        nvrs = session.exec(select(NVR).where(NVR.group_id == user["group_id"])).all()
        nvr_ips = [n.ip for n in nvrs]
        if not nvr_ips:
            return []
        cams = session.exec(select(Camera).where(Camera.nvr_ip.in_(nvr_ips))).all()
        cam_ids = [c.id for c in cams]
        if not cam_ids:
            return []
        events = session.exec(select(DowntimeEvent).where(
            (DowntimeEvent.camera_id.in_(cam_ids)) &
            ((DowntimeEvent.end_time == None) | (DowntimeEvent.end_time >= thirty_days_ago))
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

@app.get("/api/settings", response_model=list[Settings])
def get_settings(session: Session = Depends(get_session), user: dict = Depends(require_admin)): return session.exec(select(Settings)).all()

@app.put("/api/settings/{key}")
def update_setting(key: str, p: Settings, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    s = session.get(Settings, key)
    if not s:
        raise HTTPException(status_code=404, detail="Setting not found")
    s.value = p.value
    session.add(s)
    session.commit()
    invalidate_config_cache()
    return s

@app.post("/api/config/sync-names")
async def sync_names(session: Session = Depends(get_session), user: dict = Depends(require_control)):
    if user["role"] == "admin":
        nvrs = session.exec(select(NVR).where(NVR.enabled == True)).all()
    else:
        nvrs = session.exec(select(NVR).where(NVR.enabled == True, NVR.group_id == user["group_id"])).all()
    if not nvrs:
        raise HTTPException(status_code=400, detail="No enabled NVRs found to sync")
    
    results = []
    for n in nvrs:
        decrypted_pass = decrypt_password(n.password)
        success, msg = await asyncio.to_thread(sync_camera_names_from_nvr, n.ip, n.user, decrypted_pass, session)
        results.append({"nvr": n.ip, "success": success, "message": msg})
        
    return {"results": results}

@app.get("/api/logs")
def search_logs(q: str = None, limit: int = 50, offset: int = 0, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    query = select(Log).order_by(Log.timestamp.desc()).offset(offset).limit(limit)
    if q: 
        if q in ['Camera','NVR','Telegram','Mail','Service']: query = query.where(col(Log.log_type) == q)
        else: query = query.where(col(Log.details).contains(q) | col(Log.log_type).contains(q))
    logs = session.exec(query).all()
    
    output = []
    for l in logs:
        shamsi = format_shamsi_datetime(l.timestamp)
        
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
def get_cam_stats(cam_id: int, session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    c = session.get(Camera, cam_id)
    if not c:
        raise HTTPException(status_code=404, detail="Camera not found")
    if user["role"] != "admin":
        nvr = session.get(NVR, c.nvr_ip)
        if not nvr or nvr.group_id != user["group_id"]:
            raise HTTPException(status_code=403, detail="دسترسی غیرمجاز")
    now = datetime.now()
    d1 = calculate_downtime_range(session, cam_id, now - timedelta(hours=1), now)
    d24 = calculate_downtime_range(session, cam_id, now - timedelta(hours=24), now)
    return {"down_1h": d1, "down_24h": d24}

@app.get("/api/reports/generate")
def generate_report(start: float, end: float, session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    start_dt = datetime.fromtimestamp(start)
    end_dt = datetime.fromtimestamp(end)
    if user["role"] == "admin":
        cameras = session.exec(select(Camera)).all()
    else:
        nvrs = session.exec(select(NVR).where(NVR.group_id == user["group_id"])).all()
        nvr_ips = [n.ip for n in nvrs]
        if not nvr_ips:
            return []
        cameras = session.exec(select(Camera).where(Camera.nvr_ip.in_(nvr_ips))).all()
    report_data = []
    for c in cameras:
        mins = calculate_downtime_range(session, c.id, start_dt, end_dt)
        if mins > 0:
            report_data.append({"name": c.name, "ip": c.ip, "mins": mins})
    report_data.sort(key=lambda x: x['mins'], reverse=True)
    return report_data

# --- User & Personal Alerts API ---
class UserCreate(BaseModel):
    username: str
    password: str
    role: str
    group_id: Optional[int] = None

class UserUpdate(BaseModel):
    password: Optional[str] = None
    role: Optional[str] = None
    group_id: Optional[int] = None
    is_active: Optional[bool] = None

@app.get("/api/users", response_model=list[User])
def get_users(session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    return session.exec(select(User)).all()

@app.post("/api/users")
def create_user(payload: UserCreate, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    existing = session.exec(select(User).where(User.username == payload.username)).first()
    if existing:
        raise HTTPException(status_code=400, detail="نام کاربری تکراری است")
    
    db_user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        group_id=payload.group_id,
        is_active=True
    )
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    
    alert_settings = UserAlertSettings(user_id=db_user.id)
    session.add(alert_settings)
    session.commit()
    
    return db_user

@app.put("/api/users/{id}")
def update_user(id: int, payload: UserUpdate, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    db_user = session.get(User, id)
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if payload.password:
        db_user.password_hash = hash_password(payload.password)
    if payload.role is not None:
        db_user.role = payload.role
    if payload.group_id is not None or "group_id" in payload.model_fields_set:
        db_user.group_id = payload.group_id
    if payload.is_active is not None:
        db_user.is_active = payload.is_active
        
    session.add(db_user)
    session.commit()
    return db_user

@app.delete("/api/users/{id}")
def delete_user(id: int, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    db_user = session.get(User, id)
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
        
    alert_settings = session.exec(select(UserAlertSettings).where(UserAlertSettings.user_id == id)).first()
    if alert_settings:
        session.delete(alert_settings)
        
    session.delete(db_user)
    session.commit()
    return {"ok": True}

class AlertSettingsUpdate(BaseModel):
    mail_enabled: bool
    mail_recipients: Optional[str] = None
    telegram_enabled: bool
    telegram_chat_ids: Optional[str] = None

@app.get("/api/me/alerts")
def get_my_alerts(session: Session = Depends(get_session), user: dict = Depends(require_control)):
    u_id = user["user_id"]
    if u_id is None:
        raise HTTPException(status_code=400, detail="مدیر سیستم از تنظیمات عمومی استفاده می‌کند")
        
    alert_settings = session.exec(select(UserAlertSettings).where(UserAlertSettings.user_id == u_id)).first()
    if not alert_settings:
        alert_settings = UserAlertSettings(user_id=u_id)
        session.add(alert_settings)
        session.commit()
        session.refresh(alert_settings)
    return alert_settings

@app.put("/api/me/alerts")
def update_my_alerts(payload: AlertSettingsUpdate, session: Session = Depends(get_session), user: dict = Depends(require_control)):
    u_id = user["user_id"]
    if u_id is None:
        raise HTTPException(status_code=400, detail="مدیر سیستم از تنظیمات عمومی استفاده می‌کند")
        
    alert_settings = session.exec(select(UserAlertSettings).where(UserAlertSettings.user_id == u_id)).first()
    if not alert_settings:
        alert_settings = UserAlertSettings(user_id=u_id)
    
    alert_settings.mail_enabled = payload.mail_enabled
    alert_settings.mail_recipients = payload.mail_recipients
    alert_settings.telegram_enabled = payload.telegram_enabled
    alert_settings.telegram_chat_ids = payload.telegram_chat_ids
    
    session.add(alert_settings)
    session.commit()
    return alert_settings

class ChangePasswordRequest(BaseModel):
    new_password: str

@app.post("/api/me/change-password")
def change_my_password_endpoint(payload: ChangePasswordRequest, session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    u_id = user["user_id"]
    if u_id is None:
        raise HTTPException(status_code=400, detail="رمز عبور مدیر سیستم باید از طریق تنظیمات سرور تغییر کند. <a href='/static/admin-password-help.html' target='_blank' style='color:#3b82f6;text-decoration:underline;font-weight:bold;margin-right:5px;'>[مشاهده راهنما]</a>")
        
    db_user = session.get(User, u_id)
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
        
    db_user.password_hash = hash_password(payload.new_password)
    session.add(db_user)
    session.commit()
    return {"status": "ok"}