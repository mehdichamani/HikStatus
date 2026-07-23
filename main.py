import asyncio
import json
import os
import jdatetime
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
import secrets
from dotenv import load_dotenv
from loguru import logger
load_dotenv()


from fastapi import FastAPI, Depends, HTTPException, status, Request, Response, WebSocket, WebSocketDisconnect, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, PlainTextResponse, RedirectResponse, HTMLResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from typing import Optional
from sqlmodel import Session, select, col
from database import init_db, get_session, Camera, Log, NVR, NVRGroup, Settings, DowntimeEvent, OutageExplanation, OutageCause, User, UserAlertSettings, UserSession, MapPlan, ScheduledTask, hash_password, verify_password, engine, sqlite_file_name, encrypt_password, decrypt_password
from monitor import start_monitor_loop, set_broadcast_callback, sync_camera_names_from_nvr
from scheduler import scheduler
from alerts import send_email_raw, send_telegram_raw, get_config_dict, invalidate_config_cache, get_persian_datetime, format_shamsi_datetime
from rate_limiter import rate_limit, max_connections, limiter

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

def seed_database(session: Session):
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
        "OUTAGE_MIN_HOURS_TO_EXPLAIN": ("2", "حداقل زمان قطعی به ساعت برای نیاز به رفع ابهام"),
        "OUTAGE_EXPLANATION_DEADLINE_HOURS": ("24", "مهلت رفع ابهام قطعی به ساعت"),
        "OUTAGE_ANALYSIS_DAYS": ("5,6,0,1,2,3", "روزهای بررسی قطعی در هفته (شنبه=5 تا جمعه=4)"),
        "OUTAGE_ANALYSIS_TIME": ("07:30", "ساعت بررسی قطعی‌ها"),
        "OUTAGE_LAST_ANALYSIS_TIME": ("", "آخرین زمان بررسی قطعی‌ها"),
    }

    # Delete all records from all tables
    session.query(OutageExplanation).delete()
    session.query(DowntimeEvent).delete()
    session.query(Camera).delete()
    session.query(MapPlan).delete()
    session.query(UserSession).delete()
    session.query(UserAlertSettings).delete()
    session.query(User).delete()
    session.query(NVR).delete()
    session.query(NVRGroup).delete()
    session.query(Settings).delete()
    session.query(Log).delete()
    session.commit()

    # Seed Settings
    for key, (default_val, desc) in defaults.items():
        session.add(Settings(key=key, value=str(default_val), description=desc))
    session.commit()

def seed_defaults():
    with Session(engine) as session:
        # Check if settings table is already seeded
        existing_settings_count = len(session.exec(select(Settings)).all())
        if existing_settings_count > 0:
            # Check for new settings and seed them if missing
            defaults = {
                "OUTAGE_MIN_HOURS_TO_EXPLAIN": ("2", "حداقل زمان قطعی به ساعت برای نیاز به رفع ابهام"),
                "OUTAGE_EXPLANATION_DEADLINE_HOURS": ("24", "مهلت رفع ابهام قطعی به ساعت"),
                "OUTAGE_ANALYSIS_DAYS": ("5,6,0,1,2,3", "روزهای بررسی قطعی در هفته (شنبه=5 تا جمعه=4)"),
                "OUTAGE_ANALYSIS_TIME": ("07:30", "ساعت بررسی قطعی‌ها"),
                "OUTAGE_LAST_ANALYSIS_TIME": ("", "آخرین زمان بررسی قطعی‌ها"),
            }
            for key, (default_val, desc) in defaults.items():
                if not session.get(Settings, key):
                    session.add(Settings(key=key, value=str(default_val), description=desc))
            session.commit()
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
            "OUTAGE_MIN_HOURS_TO_EXPLAIN": ("2", "حداقل زمان قطعی به ساعت برای نیاز به رفع ابهام"),
            "OUTAGE_EXPLANATION_DEADLINE_HOURS": ("24", "مهلت رفع ابهام قطعی به ساعت"),
            "OUTAGE_ANALYSIS_DAYS": ("5,6,0,1,2,3", "روزهای بررسی قطعی در هفته (شنبه=5 تا جمعه=4)"),
            "OUTAGE_ANALYSIS_TIME": ("07:30", "ساعت بررسی قطعی‌ها"),
            "OUTAGE_LAST_ANALYSIS_TIME": ("", "آخرین زمان بررسی قطعی‌ها"),
        }

        for key, (default_val, desc) in defaults.items():
            if not session.get(Settings, key):
                session.add(Settings(key=key, value=str(default_val), description=desc))
        session.commit()

def seed_scheduled_tasks():
    with Session(engine) as session:
        default_tasks = [
            ScheduledTask(
                id="ping_cameras",
                name="پایش وضعیت اتصال دوربین‌ها",
                description="بررسی دوره‌ای فعال بودن دوربین‌ها و ثبت قطعی‌ها در پایگاه داده",
                interval=60
            ),
            ScheduledTask(
                id="sync_nvr_configs",
                name="همگام‌سازی ساختار ضبط NVRها",
                description="دریافت و ذخیره ساختار ضبط و پایش وضعیت هر دوربین در NVR",
                interval=3600
            ),
            ScheduledTask(
                id="sync_nvr_stats",
                name="همگام‌سازی آمار ضبط NVRها",
                description="دریافت و ذخیره حجم و ساعت ضبط دوربین‌ها از NVR",
                interval=7200
            ),
            ScheduledTask(
                id="sync_camera_names",
                name="همگام‌سازی نام دوربین‌ها",
                description="دریافت نام جدید دوربین‌ها از روی دستگاه‌های NVR و به‌روزرسانی در دیتابیس",
                interval=86400
            ),
            ScheduledTask(
                id="capture_camera_snapshots",
                name="گرفتن پیش‌نمایش دوربین‌ها (Snapshot)",
                description="دریافت تصویر لحظه‌ای از روی جریان sub-stream دوربین‌ها و ذخیره برای پیش‌نمایش در پنل وب",
                interval=28800
            ),
            ScheduledTask(
                id="cleanup_database",
                name="پاک‌سازی خودکار لاگ‌های قدیمی",
                description="حذف لاگ‌های مانیتورینگ قدیمی‌تر از ۹۰ روز برای بهینه‌سازی دیتابیس",
                interval=86400
            ),
            ScheduledTask(
                id="analyze_outages",
                name="تحلیل و لیست کردن قطعی‌های مشخص‌نشده",
                description="بررسی خودکار قطعی‌ها و ثبت دوربین‌های دارای قطعی بیش از N ساعت در هر کارخانه",
                interval=86400
            )
        ]
        for task in default_tasks:
            existing = session.get(ScheduledTask, task.id)
            if not existing:
                session.add(task)
            else:
                existing.name = task.name
                existing.description = task.description
                session.add(existing)
        session.commit()

@asynccontextmanager
async def lifespan(app: FastAPI):
    global monitor_task
    init_db()
    seed_defaults()
    seed_scheduled_tasks()
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
    if not limiter.acquire("global:ws", 5):
        await websocket.close(code=429)
        return

    token = websocket.cookies.get("session_token")
    if not token:
        limiter.release("global:ws")
        await websocket.close(code=4001)
        return
    with Session(engine) as db:
        session_record = db.exec(select(UserSession).where(UserSession.token == token)).first()
        if not session_record or session_record.expires_at < datetime.now():
            limiter.release("global:ws")
            await websocket.close(code=4001)
            return
    try:
        await ws_manager.connect(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            ws_manager.disconnect(websocket)
    finally:
        limiter.release("global:ws")

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
    """admin or group_control or it_manager."""
    if user["role"] not in ("admin", "group_control", "it_manager"):
        raise HTTPException(status_code=403, detail="دسترسی کنترل الزامی است")
    return user

def get_user_accessible_groups(user: dict, db: Session) -> list[int] | None:
    """Returns a list of accessible group IDs for the user, or None if the user has access to all."""
    if user["role"] == "admin":
        return None
    elif user["role"] == "inspector":
        db_user = db.get(User, user["user_id"])
        if not db_user or not db_user.accessible_group_ids or db_user.accessible_group_ids == "*":
            return None
        try:
            return [int(x.strip()) for x in db_user.accessible_group_ids.split(",") if x.strip().isdigit()]
        except Exception:
            return []
    else:
        if user["group_id"] is not None:
            return [user["group_id"]]
        return []

@app.get("/api/auth/me")
def get_me(user: dict = Depends(require_auth), db: Session = Depends(get_session)):
    username = user["username"]
    db_user = db.exec(select(User).where(User.username == username)).first()
    two_factor_enabled = db_user.two_factor_enabled if db_user else False
    
    return {
        "username": user["username"],
        "role": user["role"],
        "group_id": user["group_id"],
        "user_id": user["user_id"],
        "two_factor_enabled": two_factor_enabled
    }

class Login2FARequest(BaseModel):
    temp_token: str
    code: str

class Verify2FASetupRequest(BaseModel):
    code: str

class Disable2FARequest(BaseModel):
    password: str

@app.post("/api/auth/login")
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_session)):
    client_ip = request.client.host
    if not check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="تعداد تلاش‌ها بیش از حد مجاز است. لطفاً یک دقیقه صبر کنید")
    
    admin_user, admin_pass = get_admin_credentials()
    password_ok, password_is_plain = verify_admin_password(payload.password, admin_pass)
    
    if payload.username == admin_user and password_ok:
        # Check if admin has 2FA enabled in the database
        db_admin = db.exec(select(User).where(User.username == admin_user)).first()
        if db_admin and db_admin.two_factor_enabled:
            # Generate temp token
            temp_data = {
                "username": admin_user,
                "role": "admin",
                "group_id": None,
                "user_id": None,
                "expires_at": (datetime.now() + timedelta(minutes=5)).isoformat(),
                "password_is_plain": password_is_plain
            }
            temp_token = encrypt_password(json.dumps(temp_data))
            return {"status": "2fa_required", "temp_token": temp_token}

        if password_is_plain:
            logger.warning("SECURITY WARNING: Admin password in .env is stored in plain text (not hashed). Please hash it and replace. Guide: static/admin-password-help.html")
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
            
        if db_user.two_factor_enabled:
            # Generate temp token
            temp_data = {
                "username": db_user.username,
                "role": db_user.role,
                "group_id": db_user.group_id,
                "user_id": db_user.id,
                "expires_at": (datetime.now() + timedelta(minutes=5)).isoformat()
            }
            temp_token = encrypt_password(json.dumps(temp_data))
            return {"status": "2fa_required", "temp_token": temp_token}

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

@app.post("/api/auth/login/2fa")
def login_2fa(payload: Login2FARequest, response: Response, db: Session = Depends(get_session)):
    try:
        decrypted = decrypt_password(payload.temp_token)
        data = json.loads(decrypted)
    except Exception:
        raise HTTPException(status_code=400, detail="توکن موقت نامعتبر یا منقضی شده است")
        
    expires_at_str = data.get("expires_at")
    if not expires_at_str or datetime.fromisoformat(expires_at_str) < datetime.now():
        raise HTTPException(status_code=400, detail="زمان ورود کد به پایان رسیده است. لطفاً مجدداً تلاش کنید")
        
    username = data.get("username")
    role = data.get("role")
    group_id = data.get("group_id")
    user_id = data.get("user_id")
    password_is_plain = data.get("password_is_plain", False)
    
    # Fetch user details
    if role == "admin":
        db_user = db.exec(select(User).where(User.username == username)).first()
    else:
        db_user = db.exec(select(User).where(User.id == user_id)).first()
        
    if not db_user or not db_user.two_factor_enabled or not db_user.two_factor_secret:
        raise HTTPException(status_code=400, detail="تنظیمات تایید دو مرحله‌ای یافت نشد")
        
    import pyotp
    totp = pyotp.TOTP(db_user.two_factor_secret)
    if not totp.verify(payload.code):
        raise HTTPException(status_code=400, detail="کد وارد شده صحیح نیست یا منقضی شده است")
        
    token = create_session_token()
    session_expires_at = datetime.now() + timedelta(days=30)
    session_record = UserSession(
        token=token,
        username=username,
        role=role,
        group_id=group_id,
        user_id=user_id,
        expires_at=session_expires_at
    )
    db.add(session_record)
    db.commit()
    
    response.set_cookie(key="session_token", value=token, httponly=True, samesite="lax", max_age=30 * 86400)
    
    ret = {"status": "ok", "role": role, "group_id": group_id}
    if role == "admin":
        ret["password_is_plain"] = password_is_plain
    return ret

@app.post("/api/auth/2fa/setup")
def setup_2fa(user: dict = Depends(require_auth), db: Session = Depends(get_session)):
    import pyotp
    username = user["username"]
    user_id = user["user_id"]
    role = user["role"]
    
    if role == "admin":
        db_user = db.exec(select(User).where(User.username == username)).first()
        if not db_user:
            # Create special shell user for admin in database to hold 2FA secret
            db_user = User(
                username=username,
                password_hash="2fa_disabled_pass",
                role="admin",
                is_active=True
            )
            db.add(db_user)
            db.commit()
            db.refresh(db_user)
    else:
        db_user = db.exec(select(User).where(User.id == user_id)).first()
        
    if not db_user:
        raise HTTPException(status_code=404, detail="کاربر یافت نشد")
        
    if db_user.two_factor_enabled:
        raise HTTPException(status_code=400, detail="ورود دو مرحله‌ای قبلاً فعال شده است")
        
    secret = pyotp.random_base32()
    db_user.two_factor_secret = secret
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    totp = pyotp.TOTP(secret)
    otpauth_url = totp.provisioning_uri(name=username, issuer_name="HikStatus")
    
    return {
        "secret": secret,
        "otpauth_url": otpauth_url
    }

@app.post("/api/auth/2fa/verify-setup")
def verify_2fa_setup(payload: Verify2FASetupRequest, user: dict = Depends(require_auth), db: Session = Depends(get_session)):
    import pyotp
    username = user["username"]
    user_id = user["user_id"]
    role = user["role"]
    
    if role == "admin":
        db_user = db.exec(select(User).where(User.username == username)).first()
    else:
        db_user = db.exec(select(User).where(User.id == user_id)).first()
        
    if not db_user or not db_user.two_factor_secret:
        raise HTTPException(status_code=400, detail="ابتدا باید درخواست فعال‌سازی دهید")
        
    if db_user.two_factor_enabled:
        raise HTTPException(status_code=400, detail="ورود دو مرحله‌ای قبلاً فعال شده است")
        
    totp = pyotp.TOTP(db_user.two_factor_secret)
    if not totp.verify(payload.code):
        raise HTTPException(status_code=400, detail="کد وارد شده صحیح نیست یا منقضی شده است")
        
    db_user.two_factor_enabled = True
    db.add(db_user)
    db.commit()
    
    db.add(Log(
        log_type="Security",
        state="2FA Enabled",
        details=f"User {username} enabled two-factor authentication."
    ))
    db.commit()
    
    return {"status": "ok", "message": "ورود دو مرحله‌ای با موفقیت فعال شد"}

@app.post("/api/auth/2fa/disable")
def disable_2fa(payload: Disable2FARequest, user: dict = Depends(require_auth), db: Session = Depends(get_session)):
    username = user["username"]
    user_id = user["user_id"]
    role = user["role"]
    
    if role == "admin":
        admin_user, admin_pass = get_admin_credentials()
        password_ok, _ = verify_admin_password(payload.password, admin_pass)
        if username != admin_user or not password_ok:
            raise HTTPException(status_code=401, detail="رمز عبور اشتباه است")
        db_user = db.exec(select(User).where(User.username == username)).first()
    else:
        db_user = db.exec(select(User).where(User.id == user_id)).first()
        if not db_user or not verify_password(payload.password, db_user.password_hash):
            raise HTTPException(status_code=401, detail="رمز عبور اشتباه است")
            
    if not db_user or not db_user.two_factor_enabled:
        raise HTTPException(status_code=400, detail="ورود دو مرحله‌ای فعال نیست")
        
    db_user.two_factor_enabled = False
    db_user.two_factor_secret = None
    db.add(db_user)
    db.commit()
    
    db.add(Log(
        log_type="Security",
        state="2FA Disabled",
        details=f"User {username} disabled two-factor authentication."
    ))
    db.commit()
    
    return {"status": "ok", "message": "ورود دو مرحله‌ای با موفقیت غیرفعال شد"}

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
os.makedirs("data/plans", exist_ok=True)
os.makedirs("data/snapshots", exist_ok=True)
app.mount("/static/plans", StaticFiles(directory="data/plans"), name="plans")
app.mount("/static/snapshots", StaticFiles(directory="data/snapshots"), name="snapshots")
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/service-worker.js")
def service_worker_route():
    return FileResponse('static/service-worker.js', media_type='application/javascript')

@app.get("/manifest.json")
def manifest_json_route():
    return FileResponse('static/manifest.json', media_type='application/json')

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

# --- SCHEDULER ENDPOINTS ---

@app.get("/api/scheduler/tasks", dependencies=[Depends(require_auth)])
def get_scheduler_tasks(session: Session = Depends(get_session)):
    tasks = session.exec(select(ScheduledTask)).all()
    return sorted(tasks, key=lambda t: t.id)

class UpdateIntervalRequest(BaseModel):
    interval: int

@app.put("/api/scheduler/tasks/{task_id}/interval")
def update_task_interval(task_id: str, payload: UpdateIntervalRequest, session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز")
        
    db_task = session.get(ScheduledTask, task_id)
    if not db_task:
        raise HTTPException(status_code=404, detail="تسک یافت نشد")
        
    if payload.interval <= 0:
        raise HTTPException(status_code=400, detail="بازه زمانی باید بیشتر از صفر باشد")
        
    db_task.interval = payload.interval
    db_task.next_run = datetime.now() + timedelta(seconds=payload.interval)
    session.add(db_task)
    session.commit()
    session.refresh(db_task)
    return db_task

class ToggleTaskRequest(BaseModel):
    is_enabled: bool

@app.put("/api/scheduler/tasks/{task_id}/toggle")
def toggle_task_endpoint(task_id: str, payload: ToggleTaskRequest, session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز")
        
    db_task = session.get(ScheduledTask, task_id)
    if not db_task:
        raise HTTPException(status_code=404, detail="تسک یافت نشد")
        
    db_task.is_enabled = payload.is_enabled
    if payload.is_enabled:
        db_task.next_run = datetime.now() + timedelta(seconds=db_task.interval)
    session.add(db_task)
    session.commit()
    session.refresh(db_task)
    return db_task

@app.post("/api/scheduler/tasks/{task_id}/run")
async def run_task_immediately(task_id: str, user: dict = Depends(require_auth)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز")
        
    success = await scheduler.trigger_task_now(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="تسک در حال اجراست یا یافت نشد")
    return {"status": "triggered"}

@app.post("/api/scheduler/tasks/{task_id}/stop")
async def stop_task_immediately(task_id: str, user: dict = Depends(require_auth)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز")
        
    success = await scheduler.stop_task_now(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="تسک در حال اجرا نیست")
    return {"status": "stopped"}

@app.post("/api/data/purge", dependencies=[Depends(require_auth)])
async def purge_database(session: Session = Depends(get_session)):
    seed_database(session)
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
@rate_limit(1, 300)
async def restore_database(request: Request, file: UploadFile = File(...)):
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


@app.get("/api/config/export", dependencies=[Depends(require_admin)])
def export_config_json(session: Session = Depends(get_session)):
    # 1. Settings
    settings = session.exec(select(Settings)).all()
    settings_dict = {s.key: s.value for s in settings}

    # 2. Groups
    groups = session.exec(select(NVRGroup)).all()
    groups_list = []
    for g in groups:
        groups_list.append({
            "id": g.id,
            "name": g.name,
            "description": g.description,
            "map_center_lat": g.map_center_lat,
            "map_center_lng": g.map_center_lng,
            "map_zoom": g.map_zoom
        })

    # 2.1 Map Plans
    plans = session.exec(select(MapPlan)).all()
    plans_list = []
    for p in plans:
        plans_list.append({
            "id": p.id,
            "group_id": p.group_id,
            "name": p.name,
            "image_url": p.image_url,
            "sort_order": p.sort_order
        })

    # 3. NVRs
    nvrs = session.exec(select(NVR)).all()
    nvrs_list = []
    for n in nvrs:
        decrypted_pass = ""
        if n.password:
            try:
                decrypted_pass = decrypt_password(n.password)
            except Exception:
                decrypted_pass = n.password
        nvrs_list.append({
            "ip": n.ip,
            "name": n.name,
            "user": n.user,
            "password": decrypted_pass,
            "enabled": n.enabled,
            "group_id": n.group_id,
            "rtsp_port": n.rtsp_port
        })

    # 4. Users
    users = session.exec(select(User)).all()
    users_list = []
    for u in users:
        alert_settings = session.exec(select(UserAlertSettings).where(UserAlertSettings.user_id == u.id)).first()
        alert_dict = {}
        if alert_settings:
            alert_dict = {
                "mail_enabled": alert_settings.mail_enabled,
                "mail_recipients": alert_settings.mail_recipients,
                "telegram_enabled": alert_settings.telegram_enabled,
                "telegram_chat_ids": alert_settings.telegram_chat_ids
            }
        users_list.append({
            "username": u.username,
            "password_hash": u.password_hash,
            "role": u.role,
            "group_id": u.group_id,
            "is_active": u.is_active,
            "alert_settings": alert_dict
        })

    config_data = {
        "settings": settings_dict,
        "groups": groups_list,
        "plans": plans_list,
        "nvrs": nvrs_list,
        "users": users_list
    }
    config_json = json.dumps(config_data, indent=2, ensure_ascii=False)
    from fastapi.responses import Response
    return Response(
        content=config_json,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=hikstatus_config.json"}
    )


@app.post("/api/config/import", dependencies=[Depends(require_admin)])
async def import_config_json(request: Request, session: Session = Depends(get_session)):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="فایل ارسالی فرمت JSON معتبر ندارد")
        
    session.query(DowntimeEvent).delete()
    session.query(Camera).delete()
    session.query(MapPlan).delete()
    session.query(UserSession).delete()
    session.query(UserAlertSettings).delete()
    session.query(User).delete()
    session.query(NVR).delete()
    session.query(NVRGroup).delete()
    session.query(Settings).delete()
    session.commit()

    # 1. Import Settings
    json_settings = body.get("settings", {})
    defaults = {
        "MAIL_ENABLED": "false",
        "MAIL_SERVER": "smtp.gmail.com",
        "MAIL_PORT": "587",
        "MAIL_USER": "email@gmail.com",
        "MAIL_PASS": "password",
        "MAIL_RECIPIENTS": "admin@example.com",
        "MAIL_FIRST_ALERT_DELAY_MINUTES": "1",
        "MAIL_LOW_IMPORTANCE_DELAY_MINUTES": "30",
        "MAIL_ALERT_FREQUENCY_MINUTES": "60",
        "MAIL_MUTE_AFTER_N_ALERTS": "3",
        "TELEGRAM_ENABLED": "false",
        "TELEGRAM_BOT_TOKEN": "",
        "TELEGRAM_CHAT_IDS": "",
        "TELEGRAM_PROXY": "",
        "TELEGRAM_FIRST_ALERT_DELAY_MINUTES": "1",
        "TELEGRAM_LOW_IMPORTANCE_DELAY_MINUTES": "15",
        "TELEGRAM_ALERT_FREQUENCY_MINUTES": "30",
        "TELEGRAM_MUTE_AFTER_N_ALERTS": "3",
        "MAP_TYPE": "floor",
        "MAP_IMAGE": "",
        "MAP_START_LAT": "37.796067",
        "MAP_START_LNG": "45.062508",
    }
    for key, def_val in defaults.items():
        val = json_settings.get(key, def_val)
        session.add(Settings(key=key, value=str(val)))
    session.commit()

    # 2. Import Groups
    json_groups = body.get("groups", [])
    for g_data in json_groups:
        session.add(NVRGroup(
            id=g_data.get("id"),
            name=g_data["name"],
            description=g_data.get("description"),
            map_center_lat=g_data.get("map_center_lat"),
            map_center_lng=g_data.get("map_center_lng"),
            map_zoom=g_data.get("map_zoom")
        ))
    session.commit()

    # 2.1 Import Map Plans
    json_plans = body.get("plans", [])
    for p_data in json_plans:
        session.add(MapPlan(
            id=p_data.get("id"),
            group_id=p_data["group_id"],
            name=p_data["name"],
            image_url=p_data["image_url"],
            sort_order=p_data.get("sort_order", 0)
        ))
    session.commit()

    # 3. Import NVRs
    json_nvrs = body.get("nvrs", [])
    for n_data in json_nvrs:
        enc_pass = ""
        if n_data.get("password"):
            enc_pass = encrypt_password(n_data["password"])
        session.add(NVR(
            ip=n_data["ip"],
            name=n_data.get("name"),
            user=n_data["user"],
            password=enc_pass,
            enabled=n_data.get("enabled", True),
            group_id=n_data.get("group_id"),
            rtsp_port=n_data.get("rtsp_port", 554)
        ))
    session.commit()

    # 4. Import Users
    json_users = body.get("users", [])
    for u_data in json_users:
        pass_hash = u_data.get("password_hash")
        if not pass_hash and "password" in u_data:
            pass_hash = hash_password(u_data["password"])
        if not pass_hash:
            pass_hash = hash_password("123456")
            
        db_user = User(
            username=u_data["username"],
            password_hash=pass_hash,
            role=u_data.get("role", "group_view"),
            group_id=u_data.get("group_id"),
            is_active=u_data.get("is_active", True)
        )
        session.add(db_user)
        session.flush()

        a_settings = u_data.get("alert_settings", {})
        db_alert = UserAlertSettings(
            user_id=db_user.id,
            mail_enabled=a_settings.get("mail_enabled", True),
            mail_recipients=a_settings.get("mail_recipients", ""),
            telegram_enabled=a_settings.get("telegram_enabled", True),
            telegram_chat_ids=a_settings.get("telegram_chat_ids", "")
        )
        session.add(db_alert)
    session.commit()

    invalidate_config_cache()
    await restart_monitor()
    return {"status": "ok"}


# --- TEST ENDPOINTS ---
@app.post("/api/test/email", dependencies=[Depends(require_auth)])
@rate_limit(3, 60)
def test_mail(request: Request):
    conf = get_config_dict()
    recipients = [r.strip() for r in conf.get("MAIL_RECIPIENTS", "").split(",") if r.strip()]
    if not recipients:
        raise HTTPException(status_code=400, detail="گیرنده‌ای تعریف نشده است.")
    res = send_email_raw(conf, "تست سامانه مانیتورینگ", "<div style='text-align:center;padding:20px;'><h3 style='color:#28a745;'>ایمیل به درستی کار میکنه!</h3><p>تاریخ: " + get_persian_datetime() + "</p></div>", recipients)
    if res is True: return {"status": "ok"}
    raise HTTPException(status_code=400, detail=f"خطا در ارسال ایمیل: {res}")

@app.post("/api/test/telegram", dependencies=[Depends(require_auth)])
@rate_limit(3, 60)
def test_telegram(request: Request):
    conf = get_config_dict()
    chat_ids = [c.strip() for c in conf.get("TELEGRAM_CHAT_IDS", "").split(",") if c.strip()]
    if not chat_ids:
        raise HTTPException(status_code=400, detail="شناسه چت تلگرام تعریف نشده است.")
    res = send_telegram_raw(conf, "✅ <b>تست سامانه مانیتورینگ</b>\nاعلان‌های تلگرام درسته!\n📅 " + get_persian_datetime(), chat_ids)
    if res is True: return {"status": "ok"}
    raise HTTPException(status_code=400, detail=f"خطا در ارسال تلگرام: {res}")

# --- API ---
@app.get("/api/nvrs", response_model=list[NVR], response_model_exclude={"password"})
def get_nvrs(session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    accessible_groups = get_user_accessible_groups(user, session)
    if accessible_groups is None:
        return session.exec(select(NVR)).all()
    if not accessible_groups:
        return []
    return session.exec(select(NVR).where(NVR.group_id.in_(accessible_groups))).all()

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
    if user["role"] != "admin":
        accessible_groups = get_user_accessible_groups(user, session)
        if accessible_groups is None or n.group_id not in accessible_groups:
            raise HTTPException(status_code=403, detail="دسترسی غیرمجاز به این NVR")
    if "name" in p:
        n.name = p["name"]
    if "user" in p:
        n.user = p["user"]
        n.status = "Unknown"
    if "password" in p:
        if p["password"]:
            n.password = encrypt_password(p["password"])
            n.status = "Unknown"
    if "group_id" in p and user["role"] == "admin":
        n.group_id = p["group_id"] if p["group_id"] is not None else None
    if "rtsp_port" in p:
        n.rtsp_port = int(p["rtsp_port"])
        n.status = "Unknown"
    if "enabled" in p:
        n.enabled = bool(p["enabled"])
        n.status = "Unknown"
    session.add(n)
    session.commit()
    return n

@app.get("/api/groups", response_model=list[NVRGroup])
def get_groups(session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    accessible_groups = get_user_accessible_groups(user, session)
    if accessible_groups is None:
        return session.exec(select(NVRGroup)).all()
    if not accessible_groups:
        return []
    return session.exec(select(NVRGroup).where(NVRGroup.id.in_(accessible_groups))).all()

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
            old_path = plan.image_url.replace("/static/plans/", "data/plans/")
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
    
    os.makedirs("data/plans", exist_ok=True)
    ext = file.filename.split(".")[-1].lower()
    if ext not in ["png", "jpg", "jpeg", "svg"]:
        raise HTTPException(status_code=400, detail="فرمت فایل باید JPG، PNG یا SVG باشد")
    
    import time
    plan_name = name.strip() if name.strip() else file.filename.rsplit(".", 1)[0]
    filename = f"plan_{id}_{int(time.time())}.{ext}"
    filepath = os.path.join("data/plans", filename)
    
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
        old_path = plan.image_url.replace("/static/plans/", "data/plans/")
        if os.path.exists(old_path):
            os.remove(old_path)
    except Exception:
        pass
    session.delete(plan)
    session.commit()
    return {"ok": True}

@app.get("/api/cameras", response_model=list[Camera])
def get_cameras(session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    accessible_groups = get_user_accessible_groups(user, session)
    if accessible_groups is None:
        return session.exec(select(Camera).order_by(Camera.nvr_ip, Camera.channel_id)).all()
    if not accessible_groups:
        return []
    nvrs = session.exec(select(NVR).where(NVR.group_id.in_(accessible_groups))).all()
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
        accessible_groups = get_user_accessible_groups(user, session)
        nvr = session.get(NVR, c.nvr_ip)
        if not nvr or accessible_groups is None or nvr.group_id not in accessible_groups:
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

@app.get("/api/cameras/{id}/live", response_class=HTMLResponse)
def get_camera_live_page(id: int, session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    camera = session.get(Camera, id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
        
    nvr = session.exec(select(NVR).where(NVR.ip == camera.nvr_ip)).first()
    if not nvr:
        raise HTTPException(status_code=404, detail="NVR not found")
        
    if user["role"] != "admin" and nvr.group_id != user["group_id"]:
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز")
        
    html_content = f"""
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>پخش زنده - {camera.name}</title>
        <style>
            body {{
                margin: 0;
                padding: 0;
                background-color: #0f172a;
                color: #f1f5f9;
                font-family: system-ui, -apple-system, sans-serif;
                display: flex;
                flex-direction: column;
                height: 100vh;
                overflow: hidden;
            }}
            .header {{
                background-color: #1e293b;
                padding: 12px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #334155;
            }}
            .title {{
                margin: 0;
                font-size: 16px;
                font-weight: 600;
            }}
            .info {{
                font-size: 13px;
                color: #94a3b8;
            }}
            .video-container {{
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                background: #020617;
            }}
            .video-frame {{
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                display: block;
            }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1 class="title">پخش زنده: {camera.name}</h1>
            <span class="info">{camera.ip} (NVR: {camera.nvr_ip})</span>
        </div>
        <div class="video-container">
            <img class="video-frame" id="liveImg" src="/api/cameras/{id}/stream" alt="Live Stream">
            <div id="errorBox" style="display: none; padding: 25px; background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 8px; max-width: 500px; text-align: center; direction: rtl;">
                <h3 style="color: #ef4444; margin-top: 0;">عدم برقراری ارتباط با جریان ویدئویی (RTSP)</h3>
                <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 20px;">
                    امکان اتصال به دوربین از طریق پورت RTSP وجود ندارد. این مشکل معمولاً به دلیل بسته بودن پورت یا عدم فوروارد پورت RTSP رخ می‌دهد.
                </p>
                <button onclick="toggleDoc()" style="background: #3b82f6; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; font-size: 13px; cursor: pointer; font-weight: 600;">
                    راهنمای تنظیم پورت RTSP ({nvr.rtsp_port or 554})
                </button>
            </div>
        </div>
        <div id="docModal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1000; align-items: center; justify-content: center; padding: 20px;">
            <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; max-width: 600px; width: 100%; padding: 20px; box-sizing: border-box; max-height: 90vh; overflow-y: auto; direction: rtl;">
                <h3 style="margin-top: 0; color: #3b82f6; border-bottom: 1px solid #334155; padding-bottom: 10px;">راهنمای پیکربندی پورت RTSP ({nvr.rtsp_port or 554})</h3>
                
                <h4 style="color: #cbd5e1;">وضعیت ۱: دسترسی از شبکه داخلی (LAN)</h4>
                <p style="font-size: 13px; line-height: 1.6; color: #94a3b8;">
                    اگر سرور مانیتورینگ و NVR در یک شبکه محلی هستند، مطمئن شوید فایروال سیستم یا آنتی‌ویروس پورت {nvr.rtsp_port or 554} را مسدود نکرده باشد. همچنین در تنظیمات محلی NVR بررسی کنید پورت RTSP فعال باشد.
                </p>
                
                <h4 style="color: #cbd5e1;">وضعیت ۲: دسترسی از راه دور (آی‌پی استاتیک / اینترنت)</h4>
                <p style="font-size: 13px; line-height: 1.6; color: #94a3b8;">
                    اگر از طریق اینترنت و IP استاتیک به NVR متصل می‌شوید (مانند سناریوی شما با پورت‌های فوروارد شده ۸۰۰۲ و غیره)، باید پورت RTSP (پیش‌فرض ۵۵۴) نیز در مودم یا میکروتیک کارخانه مبدا به سمت IP داخلی NVR فوروارد (Dst-Nat) شود.
                </p>
                <div style="background: #0f172a; padding: 12px; border-radius: 6px; font-size: 12px; color: #22c55e; font-family: monospace; direction: ltr; margin: 10px 0;">
                    # Example Mikrotik Dst-Nat Rule:<br>
                    /ip firewall nat<br>
                    add action=dst-nat chain=dstnat dst-port={nvr.rtsp_port or 554} protocol=tcp to-addresses=[NVR_LOCAL_IP] to-ports=554
                </div>
                <p style="font-size: 13px; line-height: 1.6; color: #94a3b8;">
                    <strong>نکته مهم:</strong> اگر چندین NVR دارید، برای هر کدام یک پورت RTSP مجزا (مثلاً ۵۵۴۱، ۵۵۴۲ و...) تعریف کرده، آن را در میکروتیک به پورت ۵۵۴ داخلی همان NVR فوروارد کنید و شماره پورت جدید را در بخش ویرایش NVR همین سامانه ذخیره نمایید.
                </p>
                
                <div style="text-align: left; margin-top: 20px; border-top: 1px solid #334155; padding-top: 15px;">
                    <button onclick="toggleDoc()" style="background: #475569; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; font-size: 13px; cursor: pointer;">بستن</button>
                </div>
            </div>
        </div>
        <script>
            const img = document.getElementById('liveImg');
            const errorBox = document.getElementById('errorBox');
            const errorTitle = errorBox.querySelector('h3');
            const errorText = errorBox.querySelector('p');
            const docBtn = errorBox.querySelector('button');
            
            function showError(title, message, showDoc = false) {{
                errorTitle.textContent = title;
                errorText.textContent = message;
                docBtn.style.display = showDoc ? 'inline-block' : 'none';
                img.style.display = 'none';
                errorBox.style.display = 'block';
            }}
            
            img.onerror = () => {{
                fetch(img.src)
                    .then(response => {{
                        if (response.status === 429) {{
                            showError(
                                "تعداد پخش‌های همزمان بیش از حد مجاز است",
                                "در حال حاضر حداکثر ظرفیت تماشای همزمان دوربین‌ها (۳ دوربین) پر شده است. لطفاً پنجره‌های پخش زنده دیگر را ببندید و مجدداً تلاش کنید.",
                                false
                            );
                        }} else if (response.status === 403) {{
                            showError("خطای دسترسی غیرمجاز", "شما دسترسی لازم برای مشاهده این دوربین را ندارید.", false);
                        }} else {{
                            showError(
                                "عدم برقراری ارتباط با جریان ویدئویی (RTSP)",
                                "امکان اتصال به دوربین از طریق پورت RTSP وجود ندارد. این مشکل معمولاً به دلیل بسته بودن پورت یا عدم فوروارد پورت RTSP رخ می‌دهد.",
                                true
                            );
                        }}
                    }})
                    .catch(() => {{
                        showError(
                            "عدم برقراری ارتباط با جریان ویدئویی (RTSP)",
                            "امکان اتصال به دوربین از طریق پورت RTSP وجود ندارد. این مشکل معمولاً به دلیل بسته بودن پورت یا عدم فوروارد پورت RTSP رخ می‌دهد.",
                            true
                        );
                    }});
            }};
            
            function toggleDoc() {{
                const modal = document.getElementById('docModal');
                modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
            }}
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@app.get("/api/cameras/{id}/stream")
@max_connections(3, key="global:stream")
async def stream_camera(id: int, session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    camera = session.get(Camera, id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
        
    nvr = session.exec(select(NVR).where(NVR.ip == camera.nvr_ip)).first()
    if not nvr:
        raise HTTPException(status_code=404, detail="NVR not found")
        
    if user["role"] != "admin" and nvr.group_id != user["group_id"]:
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز")
        
    decrypted_pass = decrypt_password(nvr.password)
    try:
        chan_int = int(camera.channel_id)
        rtsp_chan = str(chan_int * 100 + 1) if chan_int < 100 else camera.channel_id
    except ValueError:
        rtsp_chan = camera.channel_id
    
    nvr_host = nvr.ip
    if ":" in nvr_host:
        nvr_ip_only = nvr_host.split(":")[0]
    else:
        nvr_ip_only = nvr_host
        
    rtsp_port = nvr.rtsp_port if nvr.rtsp_port else 554
    rtsp_host = f"{nvr_ip_only}:{rtsp_port}"
    
    from urllib.parse import quote
    encoded_pass = quote(decrypted_pass, safe='')
    rtsp_url = f"rtsp://{nvr.user}:{encoded_pass}@{rtsp_host}/Streaming/Channels/{rtsp_chan}"
    
    import subprocess
    from fastapi.responses import StreamingResponse
    
    def gen_frames():
        cmd = [
            "ffmpeg",
            "-rtsp_transport", "tcp",
            "-i", rtsp_url,
            "-f", "mjpeg",
            "-q:v", "5",
            "-r", "15",
            "-"
        ]
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        buffer = b""
        try:
            while True:
                chunk = process.stdout.read(8192)
                if not chunk:
                    break
                buffer += chunk
                while True:
                    a = buffer.find(b'\xff\xd8')
                    b = buffer.find(b'\xff\xd9')
                    if a != -1 and b != -1 and a < b:
                        frame = buffer[a:b+2]
                        buffer = buffer[b+2:]
                        yield (b'--frame\r\n'
                               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
                    else:
                        break
        except GeneratorExit:
            pass
        finally:
            process.terminate()
            try:
                process.wait(timeout=3)
            except Exception:
                process.kill()
            
    return StreamingResponse(gen_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

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
        nvr_logs = session.exec(select(Log).where(
            Log.log_type == "NVR",
            Log.timestamp >= start_dt,
            Log.timestamp <= end_dt
        ).order_by(Log.timestamp.desc())).all()
    else:
        nvrs = session.exec(select(NVR).where(NVR.group_id == user["group_id"])).all()
        nvr_ips = [n.ip for n in nvrs]
        if not nvr_ips:
            return {
                "cameras": [],
                "nvr_events": [],
                "nvr_auth_errors": [],
                "task_events": []
            }
        cameras = session.exec(select(Camera).where(Camera.nvr_ip.in_(nvr_ips))).all()
        
        all_nvr_logs = session.exec(select(Log).where(
            Log.log_type == "NVR",
            Log.timestamp >= start_dt,
            Log.timestamp <= end_dt
        ).order_by(Log.timestamp.desc())).all()
        nvr_logs = []
        for l in all_nvr_logs:
            for n in nvrs:
                if n.ip in l.details or (n.name and n.name in l.details):
                    nvr_logs.append(l)
                    break

    report_data = []
    for c in cameras:
        mins = calculate_downtime_range(session, c.id, start_dt, end_dt)
        if mins > 0:
            report_data.append({"name": c.name, "ip": c.ip, "mins": mins})
    report_data.sort(key=lambda x: x['mins'], reverse=True)

    nvr_events = []
    nvr_auth_errors = []
    for l in nvr_logs:
        shamsi = format_shamsi_datetime(l.timestamp)
        item = {
            "id": l.id,
            "timestamp": l.timestamp.isoformat(),
            "shamsi_date": shamsi,
            "state": l.state,
            "details": l.details
        }
        if l.state == "AuthError":
            nvr_auth_errors.append(item)
        else:
            nvr_events.append(item)

    task_logs = session.exec(select(Log).where(
        Log.log_type == "Task",
        Log.timestamp >= start_dt,
        Log.timestamp <= end_dt
    ).order_by(Log.timestamp.desc())).all()
    
    task_events = []
    for l in task_logs:
        shamsi = format_shamsi_datetime(l.timestamp)
        task_events.append({
            "id": l.id,
            "timestamp": l.timestamp.isoformat(),
            "shamsi_date": shamsi,
            "state": l.state,
            "details": l.details
        })

    return {
        "cameras": report_data,
        "nvr_events": nvr_events,
        "nvr_auth_errors": nvr_auth_errors,
        "task_events": task_events
    }

# --- User & Personal Alerts API ---
class UserCreate(BaseModel):
    username: str
    password: str
    role: str
    group_id: Optional[int] = None
    accessible_group_ids: Optional[str] = None

class UserUpdate(BaseModel):
    password: Optional[str] = None
    role: Optional[str] = None
    group_id: Optional[int] = None
    accessible_group_ids: Optional[str] = None
    is_active: Optional[bool] = None
    two_factor_enabled: Optional[bool] = None

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
        accessible_group_ids=payload.accessible_group_ids,
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
    if payload.accessible_group_ids is not None or "accessible_group_ids" in payload.model_fields_set:
        db_user.accessible_group_ids = payload.accessible_group_ids
    if payload.is_active is not None:
        db_user.is_active = payload.is_active
    if payload.two_factor_enabled is not None:
        db_user.two_factor_enabled = payload.two_factor_enabled
        if not payload.two_factor_enabled:
            db_user.two_factor_secret = None
        
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
def get_my_alerts(session: Session = Depends(get_session), user: dict = Depends(require_auth)):
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
def update_my_alerts(payload: AlertSettingsUpdate, session: Session = Depends(get_session), user: dict = Depends(require_auth)):
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

class OutageExplanationSubmit(BaseModel):
    explanation_type: str
    explanation_detail: Optional[str] = None

@app.get("/api/outage-explanations")
def get_outage_explanations(session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    accessible_groups = get_user_accessible_groups(user, session)
    
    query = select(OutageExplanation).order_by(OutageExplanation.created_at.desc())
    if accessible_groups is not None:
        query = query.where(OutageExplanation.group_id.in_(accessible_groups))
        
    outages = session.exec(query).all()
    
    cameras = {c.id: c for c in session.exec(select(Camera)).all()}
    groups = {g.id: g for g in session.exec(select(NVRGroup)).all()}
    users = {u.id: u for u in session.exec(select(User)).all()}
    
    output = []
    now = datetime.now()
    for o in outages:
        cam = cameras.get(o.camera_id)
        group = groups.get(o.group_id)
        user_obj = users.get(o.explained_by_user_id) if o.explained_by_user_id else None
        
        total_mins = calculate_downtime_range(session, o.camera_id, o.start_time, o.end_time)
        duration_hours = round(total_mins / 60, 1)
        
        shamsi_start = format_shamsi_datetime(o.start_time)
        shamsi_end = format_shamsi_datetime(o.end_time) if o.end_time else "همچنان قطع"
        shamsi_deadline = format_shamsi_datetime(o.assigned_deadline)
        shamsi_explained_at = format_shamsi_datetime(o.explained_at) if o.explained_at else None
        
        if o.explained_at:
            status_val = "explained"
        elif o.assigned_deadline and now > o.assigned_deadline:
            status_val = "expired"
        else:
            status_val = "pending"
            
        output.append({
            "id": o.id,
            "camera_name": cam.name if cam else "نامشخص",
            "camera_ip": cam.ip if cam else "نامشخص",
            "group_name": group.name if group else "بدون گروه",
            "start_time": o.start_time.isoformat(),
            "end_time": o.end_time.isoformat() if o.end_time else None,
            "duration_hours": duration_hours,
            "assigned_deadline": o.assigned_deadline.isoformat(),
            "explanation_type": o.explanation_type,
            "explanation_detail": o.explanation_detail,
            "explained_by_username": user_obj.username if user_obj else None,
            "explained_at": o.explained_at.isoformat() if o.explained_at else None,
            "shamsi_start": shamsi_start,
            "shamsi_end": shamsi_end,
            "shamsi_deadline": shamsi_deadline,
            "shamsi_explained_at": shamsi_explained_at,
            "status": status_val
        })
    return output

@app.put("/api/outage-explanations/{id}")
def submit_outage_explanation(id: int, payload: OutageExplanationSubmit, session: Session = Depends(get_session), user: dict = Depends(require_control)):
    outage = session.get(OutageExplanation, id)
    if not outage:
        raise HTTPException(status_code=404, detail="Outage record not found")
        
    if user["role"] != "admin" and outage.group_id != user["group_id"]:
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز برای ویرایش قطعی این کارخانه")
        
    if outage.explained_at:
        raise HTTPException(status_code=400, detail="ابهام این قطعی قبلاً رفع شده و غیرقابل تغییر است")
        
    now = datetime.now()
    if now > outage.assigned_deadline:
        raise HTTPException(status_code=400, detail="مهلت رفع ابهام این قطعی به پایان رسیده است")
        
    # Check if the explanation_type is a valid active cause in the database
    cause = session.exec(select(OutageCause).where(OutageCause.name == payload.explanation_type, OutageCause.is_active == True)).first()
    if not cause:
        raise HTTPException(status_code=400, detail="علت قطعی نامعتبر است")
        
    outage.explanation_type = payload.explanation_type
    outage.explanation_detail = payload.explanation_detail
    outage.explained_by_user_id = user["user_id"]
    outage.explained_at = now
    
    session.add(outage)
    session.commit()
    
    return {"status": "ok", "message": "رفع ابهام قطعی با موفقیت انجام شد"}

# --- Outage Causes Management API ---
class OutageCauseCreate(BaseModel):
    name: str

@app.get("/api/outage-causes")
def get_outage_causes(session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    return session.exec(select(OutageCause)).all()

@app.post("/api/outage-causes")
def create_outage_cause(payload: OutageCauseCreate, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="نام علت نمی‌تواند خالی باشد")
    
    # Check duplicate
    existing = session.exec(select(OutageCause).where(OutageCause.name == name)).first()
    if existing:
        if not existing.is_active:
            existing.is_active = True
            session.add(existing)
            session.commit()
            return existing
        else:
            raise HTTPException(status_code=400, detail="این علت قطعی قبلاً ثبت شده است")
            
    cause = OutageCause(name=name, is_active=True)
    session.add(cause)
    session.commit()
    session.refresh(cause)
    return cause

@app.delete("/api/outage-causes/{id}")
def delete_outage_cause(id: int, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    cause = session.get(OutageCause, id)
    if not cause:
        raise HTTPException(status_code=404, detail="علت قطعی یافت نشد")
        
    # Check if used in any OutageExplanation
    used = session.exec(select(OutageExplanation).where(OutageExplanation.explanation_type == cause.name)).first()
    if used:
        cause.is_active = False
        session.add(cause)
        session.commit()
        return {"status": "disabled", "message": "این علت قبلاً در ثبت قطعی‌ها استفاده شده است؛ بنابراین غیرفعال گردید تا در انتخاب‌های جدید نمایش داده نشود."}
    else:
        session.delete(cause)
        session.commit()
        return {"status": "deleted", "message": "علت قطعی با موفقیت حذف شد."}

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