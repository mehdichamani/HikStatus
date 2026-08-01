import asyncio
import json
import os
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
import secrets
from dotenv import load_dotenv
from loguru import logger
load_dotenv()


from fastapi import FastAPI, Depends, HTTPException, Request, Response, WebSocket, WebSocketDisconnect, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from typing import Optional
from sqlmodel import Session, select, col
from app.database import init_db, get_session, Camera, Log, NVR, NVRGroup, Settings, DowntimeEvent, OutageExplanation, OutageCause, User, UserAlertSettings, UserSession, MapPlan, ScheduledTask, hash_password, verify_password, engine, sqlite_file_name, encrypt_password, decrypt_password
from app.logging_config import logger, log_event
from app.services.monitor import start_monitor_loop, set_broadcast_callback
from app.services.scheduler import scheduler
from app.services.alerts import send_email_raw, send_telegram_raw, get_config_dict, invalidate_config_cache, get_persian_datetime, format_shamsi_datetime, notification_default_settings
from app.rate_limiter import rate_limit, limiter

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
    defaults.update(notification_default_settings())

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
            defaults.update(notification_default_settings())
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
            "LIMIT_WS_MAX_CONCURRENT": ("20", "حداکثر تعداد اتصال‌های همزمان وب‌سوکت"),
            "LIMIT_LOGIN_MAX_ATTEMPTS": ("5", "حداکثر تلاش‌های ورود ناموفق مجاز در دقیقه از یک IP"),
            "LIMIT_PING_TIMEOUT_SECONDS": ("2", "تایم‌اوت پینگ اتصال دوربین‌ها (ثانیه)"),
            "LIMIT_SNAPSHOT_TIMEOUT_SECONDS": ("5", "تایم‌اوت دریافت تصویر پیش‌نمایش به ثانیه"),
            "LIMIT_API_RATE_LIMIT_PER_MIN": ("60", "سقف درخواست‌های مجاز عمومی API در دقیقه"),
            "LIMIT_LOG_RETENTION_DAYS": ("90", "مدت زمان نگه‌داری لاگ‌های قطعی و مانیتورینگ (روز)"),
        }
        defaults.update(notification_default_settings())

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
                description="بررسی دوره‌ای وضعیت دوربین‌ها از NVRها، ثبت قطعی‌ها، ارسال هشدار تلگرام/ایمیل و گزارش ساعتی",
                interval=60
            ),
            ScheduledTask(
                id="sync_nvr_configs",
                name="همگام‌سازی دوربین‌ها و ساختار ضبط NVRها",
                description="دریافت نام، IP و مدل دوربین‌ها از NVR (تشخیص جدید/حذف/تغییر) + تنظیمات ضبط (روشن/خاموش و نوع: مداوم، حرکتی، آلارم) و ثبت تغییرات در تاریخچه",
                interval=3600
            ),
            ScheduledTask(
                id="sync_nvr_stats",
                name="همگام‌سازی آمار ضبط NVRها",
                description="جستجوی فایل‌های ویدئویی روی هارد NVR و محاسبه حجم کل داده‌ها (GB)، قدیمی‌ترین تاریخ ضبط، مجموع ساعات ضبط و پوشش ۲۴ ساعته",
                interval=7200
            ),
            ScheduledTask(
                id="sync_nvr_health",
                name="پایش سلامت تجهیزات NVR",
                description="دریافت وضعیت منابع سخت‌افزاری (CPU و حافظه)، وضعیت هاردها و زمان داخلی دستگاه‌های NVR",
                interval=7200
            ),
            ScheduledTask(
                id="capture_camera_snapshots",
                name="گرفتن پیش‌نمایش دوربین‌ها (Snapshot)",
                description="دریافت تصویر لحظه‌ای از sub-stream دوربین‌های آنلاین و ذخیره برای نمایش در پنل وب",
                interval=28800
            ),
            ScheduledTask(
                id="cleanup_database",
                name="پاک‌سازی خودکار لاگ‌های قدیمی",
                description="حذف لاگ‌ها، رویدادهای قطعی بسته‌شده و نشست‌های منقضی‌شده قدیمی‌تر از N روز برای بهینه‌سازی دیتابیس",
                interval=86400
            ),
            ScheduledTask(
                id="analyze_outages",
                name="تحلیل و لیست کردن قطعی‌های مشخص‌نشده",
                description="بررسی خودکار قطعی‌های ۲۴ ساعت اخیر و ثبت دوربین‌های دارای قطعی بیش از آستانه به عنوان قطعی نیازمند توضیح",
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
        # بازنویسی مسیرهای /api/v1/ به /api/ در صورتی که در روتر v1 تعریف نشده باشند
        if request.url.path.startswith("/api/v1/"):
            subpath = request.url.path[8:]
            if not (subpath.startswith("cameras") or subpath.startswith("nvrs") or subpath.startswith("settings") or subpath.startswith("health")):
                request.scope['path'] = "/api/" + subpath

        response = await call_next(request)
        if response.status_code == 401 and not request.url.path.startswith("/api/"):
            return RedirectResponse(url="/login")
        return response

app.add_middleware(AuthMiddleware)

import threading

_login_attempts = {}
_rate_limit_lock = threading.Lock()

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
    return secrets.compare_digest(input_password, env_password_val), True


def create_session_token():
    return secrets.token_hex(32)

def get_setting_int(key: str, default: int) -> int:
    try:
        with Session(engine) as session:
            s = session.get(Settings, key)
            if s and s.value and s.value.isdigit():
                return int(s.value)
    except Exception:
        pass
    return default

def check_rate_limit(ip):
    now = datetime.now()
    max_login_attempts = get_setting_int("LIMIT_LOGIN_MAX_ATTEMPTS", 5)
    with _rate_limit_lock:
        if ip not in _login_attempts:
            _login_attempts[ip] = []
        _login_attempts[ip] = [t for t in _login_attempts[ip] if (now - t).seconds < 60]
        if len(_login_attempts[ip]) >= max_login_attempts:
            return False
        _login_attempts[ip].append(now)
    return True

# اندپوئینت قدیمی کنترل سلامتی به app/api/v1/endpoints/status.py منتقل شد.

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    ws_limit = get_setting_int("LIMIT_WS_MAX_CONCURRENT", 20)
    if not limiter.acquire("global:ws", ws_limit):
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

def is_request_secure(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    if request.headers.get("x-forwarded-proto") == "https":
        return True
    return False

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
        response.set_cookie(key="session_token", value=token, httponly=True, secure=is_request_secure(request), samesite="lax", max_age=30 * 86400)

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
    """admin or it_manager."""
    if user["role"] not in ("admin", "it_manager"):
        raise HTTPException(status_code=403, detail="دسترسی کنترل الزامی است")
    return user

def get_user_accessible_groups(user: dict, db: Session) -> list[int] | None:
    """Returns a list of accessible group IDs for the user, or None if the user has access to all."""
    if user["role"] == "admin":
        return None
    elif user["role"] in ("inspector", "it_manager"):
        db_user = db.get(User, user["user_id"])
        if not db_user:
            return []
        if db_user.accessible_group_ids:
            if db_user.accessible_group_ids == "*":
                return None
            try:
                ids = [int(x.strip()) for x in db_user.accessible_group_ids.split(",") if x.strip().isdigit()]
                if ids:
                    return ids
            except Exception:
                pass
        if db_user.group_id is not None:
            return [db_user.group_id]
        return None
    else:
        if user.get("group_id") is not None:
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

        log_event(db, category="Security", action="LOGIN_SUCCESS", details=f"ورود موفق کاربر مدیر ({payload.username})", level="INFO", actor_username=payload.username, actor_ip=client_ip)
        response.set_cookie(key="session_token", value=token, httponly=True, secure=is_request_secure(request), samesite="lax", max_age=30 * 86400)
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

        log_event(db, category="Security", action="LOGIN_SUCCESS", details=f"ورود موفق کاربر ({db_user.username})", level="INFO", actor_username=db_user.username, actor_ip=client_ip, group_id=db_user.group_id)
        response.set_cookie(key="session_token", value=token, httponly=True, secure=is_request_secure(request), samesite="lax", max_age=30 * 86400)
        return {"status": "ok", "role": db_user.role, "group_id": db_user.group_id}

    log_event(db, category="Security", action="LOGIN_FAILED", details=f"تلاش ناموفق برای ورود با نام کاربری ({payload.username})", level="WARNING", actor_username=payload.username, actor_ip=client_ip)
    raise HTTPException(status_code=401, detail="نام کاربری یا رمز عبور اشتباه است")

@app.post("/api/auth/login/2fa")
@rate_limit(5, 60)
def login_2fa(payload: Login2FARequest, request: Request, response: Response, db: Session = Depends(get_session)):
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

    response.set_cookie(key="session_token", value=token, httponly=True, secure=is_request_secure(request), samesite="lax", max_age=30 * 86400)

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
@rate_limit(5, 60)
def verify_2fa_setup(payload: Verify2FASetupRequest, request: Request, user: dict = Depends(require_auth), db: Session = Depends(get_session)):
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
@rate_limit(5, 60)
def disable_2fa(payload: Disable2FARequest, request: Request, user: dict = Depends(require_auth), db: Session = Depends(get_session)):
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
            log_event(db, category="Security", action="LOGOUT", details=f"خروج کاربر ({session_record.username})", level="INFO", actor_username=session_record.username, actor_ip=request.client.host if request.client else None)
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

@app.post("/api/data/purge", dependencies=[Depends(require_admin)])
async def purge_database(session: Session = Depends(get_session)):
    seed_database(session)
    log_event(session, category="System", action="DATABASE_PURGE", details="دیتابیس سیستم به تنظیمات اولیه ریست گردید", level="CRITICAL", actor_username="admin")
    invalidate_config_cache()
    await restart_monitor()
    return {"status": "ok"}


@app.get("/api/data/backup", dependencies=[Depends(require_admin)])
def backup_database(session: Session = Depends(get_session)):
    if not os.path.exists(sqlite_file_name):
        raise HTTPException(status_code=404, detail="Database file not found")
    log_event(session, category="System", action="DATABASE_BACKUP", details="فایل پشتیبان کامل دیتابیس دانلود شد", level="INFO", actor_username="admin")
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
    with Session(engine) as session:
        log_event(session, category="System", action="DATABASE_RESTORE", details="فایل پشتیبان دیتابیس بازیابی (Restore) گردید", level="CRITICAL", actor_username="admin")
    return {"status": "ok"}


@app.get("/api/config/export", dependencies=[Depends(require_admin)])
def export_config_json(session: Session = Depends(get_session)):
    log_event(session, category="Config", action="CONFIG_EXPORT", details="پیکربندی سیستم به صورت فایل JSON دانلود گردید", level="INFO", actor_username="admin")
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
        nvrs_list.append({
            "ip": n.ip,
            "name": n.name,
            "user": n.user,
            "password": "",
            "enabled": n.enabled,
            "group_id": n.group_id,
            "rtsp_port": n.rtsp_port
        })

    # 4. Users
    users = session.exec(select(User)).all()
    user_ids = [u.id for u in users]
    all_alert_settings = session.exec(select(UserAlertSettings).where(UserAlertSettings.user_id.in_(user_ids))).all() if user_ids else []
    alerts_by_user_id = {a.user_id: a for a in all_alert_settings}

    users_list = []
    for u in users:
        alert_settings = alerts_by_user_id.get(u.id)
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

    # 5. Scheduled Tasks
    tasks = session.exec(select(ScheduledTask)).all()
    tasks_list = []
    for t in tasks:
        tasks_list.append({
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "interval": t.interval,
            "is_enabled": t.is_enabled
        })

    config_data = {
        "settings": settings_dict,
        "groups": groups_list,
        "plans": plans_list,
        "nvrs": nvrs_list,
        "users": users_list,
        "tasks": tasks_list
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
    cl = request.headers.get("content-length")
    if cl and int(cl) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="حجم فایل بیش از حد مجاز (۱۰ مگابایت) است")
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
    session.query(ScheduledTask).delete()
    session.commit()

    # 1. Import Settings
    json_settings = body.get("settings", {})
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
        "LIMIT_WS_MAX_CONCURRENT": ("20", "حداکثر تعداد اتصال‌های همزمان وب‌سوکت"),
        "LIMIT_LOGIN_MAX_ATTEMPTS": ("5", "حداکثر تلاش‌های ورود ناموفق مجاز در دقیقه از یک IP"),
        "LIMIT_PING_TIMEOUT_SECONDS": ("2", "تایم‌اوت پینگ اتصال دوربین‌ها (ثانیه)"),
        "LIMIT_SNAPSHOT_TIMEOUT_SECONDS": ("5", "تایم‌اوت دریافت تصویر پیش‌نمایش به ثانیه"),
        "LIMIT_API_RATE_LIMIT_PER_MIN": ("60", "سقف درخواست‌های مجاز عمومی API در دقیقه"),
        "LIMIT_LOG_RETENTION_DAYS": ("90", "مدت زمان نگه‌داری لاگ‌های قطعی و مانیتورینگ (روز)"),
    }

    # Save all settings present in JSON
    for key, val in json_settings.items():
        desc = defaults.get(key, (None, None))[1]
        session.add(Settings(key=key, value=str(val), description=desc))

    # Seed missing defaults
    for key, (def_val, desc) in defaults.items():
        if not session.get(Settings, key):
            session.add(Settings(key=key, value=str(def_val), description=desc))
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
            role=u_data.get("role", "it_manager"),
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

    # 5. Import Scheduled Tasks
    json_tasks = body.get("tasks", [])
    for t_data in json_tasks:
        session.add(ScheduledTask(
            id=t_data["id"],
            name=t_data["name"],
            description=t_data["description"],
            interval=t_data["interval"],
            is_enabled=t_data.get("is_enabled", t_data.get("enabled", True))
        ))
    session.commit()
    seed_scheduled_tasks()

    invalidate_config_cache()
    await restart_monitor()
    log_event(session, category="Config", action="CONFIG_IMPORT", details="پیکربندی جدید از فایل JSON وارد (Import) گردید", level="CRITICAL", actor_username="admin")
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

# اندپوئینت‌های NVRها به app/api/v1/endpoints/nvrs.py منتقل شدند.

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
    log_event(session, category="Config", action="GROUP_CREATE", details=f"گروه/کارخانه جدید ({group.name}) ایجاد شد", level="INFO", actor_username=user.get("username","admin"), group_id=group.id, target_type="Group", target_id=group.id)
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
    log_event(session, category="Config", action="GROUP_UPDATE", details=f"اطلاعات گروه/کارخانه ({g.name}) ویرایش شد", level="INFO", actor_username=user.get("username","admin"), group_id=g.id, target_type="Group", target_id=g.id)
    return g

@app.delete("/api/groups/{id}")
def delete_group(id: int, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    g = session.get(NVRGroup, id)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    g_name = g.name
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
    log_event(session, category="Config", action="GROUP_DELETE", details=f"گروه/کارخانه ({g_name}) حذف شد", level="WARNING", actor_username=user.get("username","admin"), target_type="Group", target_id=id)
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
    if file.size and file.size > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="حجم فایل بیش از حد مجاز (۵ مگابایت) است")

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

# اندپوئینت‌های دوربین‌ها به app/api/v1/endpoints/cameras.py منتقل شدند.

# اندپوئینت اسنپ‌شات دوربین به app/api/v1/endpoints/cameras.py منتقل شد.

# اندپوئینت پخش زنده و استریم دوربین‌ها به app/api/v1/endpoints/cameras.py منتقل شدند.


@app.post("/api/map/upload")
async def upload_map(file: UploadFile = File(...), user: dict = Depends(require_admin)):
    if file.size and file.size > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="حجم فایل بیش از حد مجاز (۵ مگابایت) است")

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

# اندپوئینت‌های تنظیمات عمومی به app/api/v1/endpoints/status.py منتقل شدند.


@app.get("/api/logs")
def search_logs(
    q: Optional[str] = None,
    category: Optional[str] = None,
    level: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    session: Session = Depends(get_session),
    user: dict = Depends(require_auth)
):
    query = select(Log)

    # Permission filtering
    if user["role"] != "admin":
        accessible_groups = get_user_accessible_groups(user, session)
        if accessible_groups is not None:
            query = query.where((col(Log.group_id).in_(accessible_groups)) | (col(Log.actor_username) == user["username"]))
        elif user.get("group_id") is not None:
            query = query.where((col(Log.group_id) == user["group_id"]) | (col(Log.actor_username) == user["username"]))
        else:
            query = query.where(col(Log.actor_username) == user["username"])

    # Filter by Category
    if category and category != 'all':
        query = query.where(col(Log.category) == category)
    elif q and q in ['Security', 'Camera', 'NVR', 'User', 'Config', 'Task', 'Alert', 'System']:
        query = query.where(col(Log.category) == q)

    # Filter by Level
    if level and level != 'all':
        query = query.where(col(Log.level) == level.upper())

    # Filter by Action
    if action and action != 'all':
        query = query.where(col(Log.action) == action)

    # Free-text search (q)
    if q and q not in ['Security', 'Camera', 'NVR', 'User', 'Config', 'Task', 'Alert', 'System']:
        pattern = f"%{q}%"
        query = query.where(
            col(Log.details).like(pattern) |
            col(Log.action).like(pattern) |
            col(Log.actor_username).like(pattern) |
            col(Log.actor_ip).like(pattern) |
            col(Log.category).like(pattern)
        )

    query = query.order_by(Log.timestamp.desc()).offset(offset).limit(limit)
    logs = session.exec(query).all()

    output = []
    for l in logs:
        shamsi = format_shamsi_datetime(l.timestamp)
        item = l.model_dump()
        item['shamsi_date'] = shamsi
        item['log_type'] = l.category or l.log_type or "System"
        item['state'] = l.action or l.level or l.state or "INFO"
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

# اندپوئینت‌های دوربین‌های آفلاین و تغییرات به app/api/v1/endpoints/cameras.py منتقل شدند.

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

@app.get("/api/reports/charts")
def get_reports_charts(start: float, end: float, session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    start_dt = datetime.fromtimestamp(start)
    end_dt = datetime.fromtimestamp(end)

    # 1. Filter cameras by user accessible groups
    accessible_groups = get_user_accessible_groups(user, session)

    cameras_query = select(Camera)
    nvrs_query = select(NVR)
    groups_query = select(NVRGroup)

    if accessible_groups is not None:
        nvrs_objs = session.exec(select(NVR).where(NVR.group_id.in_(accessible_groups))).all()
        nvr_ips = [n.ip for n in nvrs_objs]
        if not nvr_ips:
            return {
                "status_chart": {"labels": [], "data": []},
                "group_chart": {"labels": [], "data": []},
                "causes_chart": {"labels": [], "data": []},
                "top_cameras_chart": {"labels": [], "data": []},
                "trend_chart": {"labels": [], "data": []}
            }
        cameras_query = cameras_query.where(Camera.nvr_ip.in_(nvr_ips))
        nvrs_query = nvrs_query.where(NVR.group_id.in_(accessible_groups))
        groups_query = groups_query.where(NVRGroup.id.in_(accessible_groups))

    cameras = session.exec(cameras_query).all()
    nvrs = session.exec(nvrs_query).all()
    groups = session.exec(groups_query).all()

    nvr_ips_to_group = {n.ip: n.group_id for n in nvrs}
    group_id_to_name = {g.id: g.name for g in groups}

    # Chart 1: Camera Status (Online vs Offline)
    online_count = sum(1 for c in cameras if c.status == "Online")
    offline_count = len(cameras) - online_count
    status_chart = {
        "labels": ["آنلاین", "آفلاین"],
        "data": [online_count, offline_count]
    }

    # Query all DowntimeEvents once in the range!
    cam_ids = [c.id for c in cameras]
    if not cam_ids:
        events = []
    else:
        events = session.exec(
            select(DowntimeEvent).where(
                DowntimeEvent.camera_id.in_(cam_ids),
                DowntimeEvent.start_time < end_dt,
                (DowntimeEvent.end_time == None) | (DowntimeEvent.end_time > start_dt)
            )
        ).all()

    now = datetime.now()

    # Group events by camera to avoid O(N^2) complexity
    events_by_camera = {}
    for e in events:
        events_by_camera.setdefault(e.camera_id, []).append(e)

    def calculate_downtime_in_memory(cam_id, start_ts, end_ts):
        total_minutes = 0
        for e in events_by_camera.get(cam_id, []):
            e_end = e.end_time or now
            overlap_start = max(e.start_time, start_ts)
            overlap_end = min(e_end, end_ts)
            if overlap_end > overlap_start:
                total_minutes += (overlap_end - overlap_start).total_seconds() / 60
        return int(total_minutes)

    # Chart 2: Downtime by Group (Factory)
    group_downtime = {}
    for c in cameras:
        g_id = nvr_ips_to_group.get(c.nvr_ip)
        g_name = group_id_to_name.get(g_id) if g_id else "بدون گروه"

        mins = calculate_downtime_in_memory(c.id, start_dt, end_dt)
        if mins > 0:
            group_downtime[g_name] = group_downtime.get(g_name, 0) + mins

    group_chart = {
        "labels": list(group_downtime.keys()),
        "data": [round(m / 60, 1) for m in group_downtime.values()]
    }

    # Chart 3: Outage Causes (from OutageExplanation)
    explanations_query = select(OutageExplanation).where(
        OutageExplanation.start_time >= start_dt,
        OutageExplanation.start_time <= end_dt
    )
    if accessible_groups is not None:
        explanations_query = explanations_query.where(OutageExplanation.group_id.in_(accessible_groups))

    explanations = session.exec(explanations_query).all()

    causes_count = {}
    for o in explanations:
        if o.explanation_type:
            causes_count[o.explanation_type] = causes_count.get(o.explanation_type, 0) + 1

    causes_chart = {
        "labels": list(causes_count.keys()),
        "data": list(causes_count.values())
    }

    # Chart 4: Top 10 unstable cameras
    camera_downtimes = []
    for c in cameras:
        mins = calculate_downtime_in_memory(c.id, start_dt, end_dt)
        if mins > 0:
            camera_downtimes.append({"name": c.name, "hours": round(mins / 60, 1)})

    camera_downtimes.sort(key=lambda x: x["hours"], reverse=True)
    top_10 = camera_downtimes[:10]
    top_cameras_chart = {
        "labels": [x["name"] for x in top_10],
        "data": [x["hours"] for x in top_10]
    }

    # Chart 5: Daily Downtime Trend
    trend_labels = []
    trend_data = []

    num_days = (end_dt - start_dt).days + 1
    day_step = 1
    if num_days > 45:
        day_step = (num_days // 30) or 1

    temp_day = start_dt
    while temp_day <= end_dt:
        parts = format_shamsi_datetime(temp_day).split(" ")
        label = f"{parts[1]} {parts[2]}" if len(parts) >= 3 else parts[0]

        day_start = temp_day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=day_step)

        day_mins = 0
        for c in cameras:
            day_mins += calculate_downtime_in_memory(c.id, day_start, day_end)

        trend_labels.append(label)
        trend_data.append(round(day_mins / 60, 1))

        temp_day += timedelta(days=day_step)

    trend_chart = {
        "labels": trend_labels,
        "data": trend_data
    }

    return {
        "status_chart": status_chart,
        "group_chart": group_chart,
        "causes_chart": causes_chart,
        "top_cameras_chart": top_cameras_chart,
        "trend_chart": trend_chart
    }

@app.get("/api/reports/causes")
def get_reports_causes(period: str = "30d", session: Session = Depends(get_session), user: dict = Depends(require_auth)):
    days = 30
    if period == "24h": days = 1
    elif period == "7d": days = 7
    elif period == "30d": days = 30

    start_dt = datetime.now() - timedelta(days=days)
    end_dt = datetime.now()

    accessible_groups = get_user_accessible_groups(user, session)
    explanations_query = select(OutageExplanation).where(
        OutageExplanation.start_time >= start_dt,
        OutageExplanation.start_time <= end_dt
    )
    if accessible_groups is not None:
        explanations_query = explanations_query.where(OutageExplanation.group_id.in_(accessible_groups))

    explanations = session.exec(explanations_query).all()
    causes_count = {}
    for o in explanations:
        if o.explanation_type:
            causes_count[o.explanation_type] = causes_count.get(o.explanation_type, 0) + 1

    if not causes_count:
        causes_count = {"قطعی برق": 0, "تعمیرات": 0, "حوادث عمرانی": 0, "مشکلات شبکه": 0}

    return [{"cause": k, "count": v} for k, v in causes_count.items()]

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

def validate_accessible_groups(accessible_group_ids: Optional[str], session: Session):
    if not accessible_group_ids:
        return
    val = accessible_group_ids.strip()
    if val == "*":
        return
    parts = [x.strip() for x in val.split(",") if x.strip()]
    if not parts:
        raise HTTPException(status_code=400, detail="قالب دسترسی چندگانه معتبر نیست")
    for p in parts:
        if not p.isdigit():
            raise HTTPException(status_code=400, detail=f"شناسه گروه '{p}' باید عدد باشد")
        g_id = int(p)
        if not session.get(NVRGroup, g_id):
            raise HTTPException(status_code=400, detail=f"گروه با شناسه {g_id} وجود ندارد")

@app.get("/api/users", response_model=list[User])
def get_users(session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    return session.exec(select(User)).all()

@app.post("/api/users")
def create_user(payload: UserCreate, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    existing = session.exec(select(User).where(User.username == payload.username)).first()
    if existing:
        raise HTTPException(status_code=400, detail="نام کاربری تکراری است")

    if payload.group_id is not None:
        if not session.get(NVRGroup, payload.group_id):
            raise HTTPException(status_code=400, detail=f"گروه با شناسه {payload.group_id} وجود ندارد")

    validate_accessible_groups(payload.accessible_group_ids, session)

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

    log_event(session, category="User", action="USER_CREATE", details=f"کاربر جدید ({payload.username}) با نقش '{payload.role}' ایجاد شد", level="INFO", actor_username=user.get("username","admin"), group_id=payload.group_id, target_type="User", target_id=db_user.id)
    return db_user

@app.put("/api/users/{id}")
def update_user(id: int, payload: UserUpdate, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    db_user = session.get(User, id)
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    if db_user.id == user["user_id"] or db_user.username == user["username"]:
        if payload.role is not None and payload.role != db_user.role:
            raise HTTPException(status_code=400, detail="شما نمی‌توانید نقش کاربری خود را تغییر دهید")
        if payload.is_active is False:
            raise HTTPException(status_code=400, detail="شما نمی‌توانید حساب کاربری خود را غیرفعال کنید")

    if payload.group_id is not None:
        if not session.get(NVRGroup, payload.group_id):
            raise HTTPException(status_code=400, detail=f"گروه با شناسه {payload.group_id} وجود ندارد")

    if payload.accessible_group_ids is not None or "accessible_group_ids" in payload.model_fields_set:
        validate_accessible_groups(payload.accessible_group_ids, session)

    changes = []
    if payload.role is not None and payload.role != db_user.role:
        changes.append(f"نقش از '{db_user.role}' به '{payload.role}'")
    if payload.is_active is not None and payload.is_active != db_user.is_active:
        status_old = "فعال" if db_user.is_active else "غیرفعال"
        status_new = "فعال" if payload.is_active else "غیرفعال"
        changes.append(f"وضعیت فعال بودن از '{status_old}' به '{status_new}'")
    if payload.group_id is not None and payload.group_id != db_user.group_id:
        changes.append(f"گروه اصلی از '{db_user.group_id}' به '{payload.group_id}'")
    if (payload.accessible_group_ids is not None or "accessible_group_ids" in payload.model_fields_set) and payload.accessible_group_ids != db_user.accessible_group_ids:
        changes.append(f"دسترسی‌های چندگانه از '{db_user.accessible_group_ids}' به '{payload.accessible_group_ids}'")
    if payload.password:
        changes.append("رمز عبور تغییر یافت")

    details_str = f"حساب کاربر ({db_user.username}) ویرایش شد"
    if changes:
        details_str += f". تغییرات: {', '.join(changes)}"

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
    log_event(session, category="User", action="USER_UPDATE", details=details_str, level="INFO", actor_username=user.get("username","admin"), group_id=db_user.group_id, target_type="User", target_id=db_user.id)
    return db_user

@app.delete("/api/users/{id}")
def delete_user(id: int, session: Session = Depends(get_session), user: dict = Depends(require_admin)):
    db_user = session.get(User, id)
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    u_name = db_user.username
    g_id = db_user.group_id
    alert_settings = session.exec(select(UserAlertSettings).where(UserAlertSettings.user_id == id)).first()
    if alert_settings:
        session.delete(alert_settings)

    session.delete(db_user)
    session.commit()
    log_event(session, category="User", action="USER_DELETE", details=f"کاربر ({u_name}) حذف گردید", level="WARNING", actor_username=user.get("username","admin"), group_id=g_id, target_type="User", target_id=id)
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

    if payload.mail_recipients and "," in payload.mail_recipients:
        raise HTTPException(status_code=400, detail="فقط وارد کردن یک ایمیل مجاز است")
    if payload.telegram_chat_ids and "," in payload.telegram_chat_ids:
        raise HTTPException(status_code=400, detail="فقط وارد کردن یک شناسه تلگرام مجاز است")

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

    # گروه‌بندی دوربین‌ها بر اساس NVR IP برای منطق طبقه‌بندی خودکار
    cameras_by_nvr = {}
    for c in cameras.values():
        if c.nvr_ip:
            cameras_by_nvr.setdefault(c.nvr_ip, []).append(c)

    output = []
    now = datetime.now()

    # واکشی فله‌ای تمام رویدادهای خاموشی هم‌پوشان با بازه‌های قطعی جهت رفع گلوگاه N+1
    outage_camera_ids = {o.camera_id for o in outages}
    if not outages:
        events = []
    else:
        min_start = min(o.start_time for o in outages)
        max_end = now
        for o in outages:
            if o.end_time and o.end_time > max_end:
                max_end = o.end_time

        events = session.exec(
            select(DowntimeEvent).where(
                DowntimeEvent.camera_id.in_(list(outage_camera_ids)),
                DowntimeEvent.start_time < max_end,
                (DowntimeEvent.end_time == None) | (DowntimeEvent.end_time > min_start)
            )
        ).all()

    # دسته‌بندی کارآمد رویدادها در حافظه
    events_by_camera = {}
    for e in events:
        events_by_camera.setdefault(e.camera_id, []).append(e)

    # متد کمکی جهت محاسبه مدت قطعی در حافظه بدون کوئری دیتابیس
    def calculate_downtime_in_memory(cam_id, start_ts, end_ts):
        total_minutes = 0
        limit_end = end_ts or now
        for e in events_by_camera.get(cam_id, []):
            e_end = e.end_time or now
            overlap_start = max(e.start_time, start_ts)
            overlap_end = min(e_end, limit_end)
            if overlap_end > overlap_start:
                total_minutes += (overlap_end - overlap_start).total_seconds() / 60
        return int(total_minutes)

    # واکشی علت‌های قطعی فعال دیتابیس برای پیشنهاد علت مناسب
    active_causes = [c.name for c in session.exec(select(OutageCause).where(OutageCause.is_active == True)).all()]

    for o in outages:
        cam = cameras.get(o.camera_id)
        group = groups.get(o.group_id)
        user_obj = users.get(o.explained_by_user_id) if o.explained_by_user_id else None

        # محاسبه مدت زمان قطعی در حافظه
        total_mins = calculate_downtime_in_memory(o.camera_id, o.start_time, o.end_time)
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

        # منطق پیشنهاد هوشمند علت قطعی (Auto-Classification)
        suggested_cause = None
        suggested_detail = None
        if cam and cam.nvr_ip:
            siblings = cameras_by_nvr.get(cam.nvr_ip, [])
            n_total = len(siblings)
            n_down = 0
            limit_end = o.end_time or now
            for sib in siblings:
                for e in events_by_camera.get(sib.id, []):
                    e_end = e.end_time or now
                    overlap_start = max(e.start_time, o.start_time)
                    overlap_end = min(e_end, limit_end)
                    if overlap_end > overlap_start:
                        n_down += 1
                        break
            # اگر بیش از ۸۰٪ دوربین‌های این NVR قطع بوده‌اند
            if n_total > 1 and (n_down / n_total) >= 0.8:
                # تلاش برای یافتن نزدیک‌ترین علت معتبر در دیتابیس
                matched_cause = "قطع ارتباط با سوئیچ مرکزی / خاموشی NVR"
                # اگر در دیتابیس وجود ندارد، نزدیک‌ترین مورد مانند "مشکلات دیگر" یا اولین علت را قرار می‌دهیم
                if matched_cause not in active_causes:
                    # تلاش برای پیدا کردن کلمه کلیدی شبکه یا سوئیچ
                    for ac in active_causes:
                        if "شبکه" in ac or "سوئیچ" in ac:
                            matched_cause = ac
                            break
                    else:
                        matched_cause = "مشکلات دیگر"
                suggested_cause = matched_cause
                suggested_detail = f"بیش از ۸۰٪ دوربین‌های این NVR ({cam.nvr_ip}) همزمان قطع شده‌اند ({n_down} از {n_total} دوربین)"

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
            "status": status_val,
            "suggested_cause": suggested_cause,
            "suggested_detail": suggested_detail
        })
    return output

class BulkOutageExplanationSubmit(BaseModel):
    ids: list[int]
    explanation_type: str
    explanation_detail: Optional[str] = None

@app.put("/api/outage-explanations/{id}")
def submit_outage_explanation(id: int, payload: OutageExplanationSubmit, session: Session = Depends(get_session), user: dict = Depends(require_control)):
    outage = session.get(OutageExplanation, id)
    if not outage:
        raise HTTPException(status_code=404, detail="Outage record not found")

    if user["role"] != "admin" and outage.group_id != user["group_id"]:
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز برای ویرایش قطعی این کارخانه")

    now = datetime.now()
    is_admin = (user["role"] == "admin")

    # ادمین همواره مجاز به ویرایش توضیحات یا رفع ابهام مجدد است
    if outage.explained_at and not is_admin:
        raise HTTPException(status_code=400, detail="ابهام این قطعی قبلاً رفع شده و برای کاربران غیر ادمین غیرقابل تغییر است")

    if now > outage.assigned_deadline and not is_admin:
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

@app.post("/api/outage-explanations/bulk")
def submit_bulk_outage_explanations(payload: BulkOutageExplanationSubmit, session: Session = Depends(get_session), user: dict = Depends(require_control)):
    # بررسی ولید بودن علت قطعی
    cause = session.exec(select(OutageCause).where(OutageCause.name == payload.explanation_type, OutageCause.is_active == True)).first()
    if not cause:
        raise HTTPException(status_code=400, detail="علت قطعی نامعتبر است")

    now = datetime.now()
    is_admin = (user["role"] == "admin")
    updated_count = 0

    for oid in payload.ids:
        outage = session.get(OutageExplanation, oid)
        if not outage:
            continue

        # بررسی نقش و کارخانه
        if not is_admin and outage.group_id != user["group_id"]:
            raise HTTPException(status_code=403, detail=f"دسترسی غیرمجاز برای ویرایش قطعی کارخانه با شناسه {oid}")

        # ادمین همواره مجاز به ویرایش توضیحات است
        if outage.explained_at and not is_admin:
            raise HTTPException(status_code=400, detail=f"ابهام قطعی با شناسه {oid} قبلاً رفع شده و برای کاربران غیر ادمین غیرقابل تغییر است")

        if now > outage.assigned_deadline and not is_admin:
            raise HTTPException(status_code=400, detail=f"مهلت رفع ابهام قطعی با شناسه {oid} به پایان رسیده است")

        outage.explanation_type = payload.explanation_type
        outage.explanation_detail = payload.explanation_detail
        outage.explained_by_user_id = user["user_id"]
        outage.explained_at = now
        session.add(outage)
        updated_count += 1

    session.commit()
    return {"status": "ok", "message": f"رفع ابهام دسته‌جمعی برای {updated_count} قطعی با موفقیت انجام شد", "updated_count": updated_count}

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

    # ابطال تمام نشست‌های فعال کاربر بعد از تغییر رمز عبور جهت امنیت بیشتر
    active_sessions = session.exec(select(UserSession).where(UserSession.username == db_user.username)).all()
    for s in active_sessions:
        session.delete(s)

    session.commit()
    return {"status": "ok"}


# ثبت روترها در ساختار ماژولار پروژه
from app.api.v1.router import api_router
from app.api.v1.endpoints.status import router as status_router
from app.api.v1.endpoints.cameras import router as cameras_router
from app.api.v1.endpoints.nvrs import router as nvrs_router

# اتصال روتر v1 با پیشوند مناسب
app.include_router(api_router, prefix="/api/v1")

# اتصال روترها با پیشوند /api جهت حفظ سازگاری کامل با کلاینت‌ها و تست‌های قدیمی
app.include_router(status_router, prefix="/api")
app.include_router(cameras_router, prefix="/api/cameras")
app.include_router(nvrs_router, prefix="/api/nvrs")
