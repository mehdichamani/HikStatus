from __future__ import annotations
from sqlmodel import SQLModel, Field, create_engine, Session
from datetime import datetime, timezone
from typing import Optional
import hashlib, secrets
from loguru import logger

class NVRGroup(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    description: Optional[str] = None
    map_center_lat: Optional[float] = None
    map_center_lng: Optional[float] = None
    map_zoom: Optional[int] = None

class MapPlan(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="nvrgroup.id", index=True)
    name: str
    image_url: str
    sort_order: int = 0

class NVR(SQLModel, table=True):
    ip: str = Field(primary_key=True)
    name: Optional[str] = None
    user: str
    password: Optional[str] = None
    enabled: bool = True
    status: str = "Unknown"
    last_online: Optional[datetime] = None
    mail_alert_count: int = 0
    mail_last_alert: Optional[datetime] = None
    telegram_alert_count: int = 0
    telegram_last_alert: Optional[datetime] = None
    group_id: Optional[int] = Field(default=None, foreign_key="nvrgroup.id")
    rtsp_port: int = Field(default=554)

class Camera(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    ip: str
    nvr_ip: str = Field(index=True)
    channel_id: str
    importance: int = Field(default=2)
    last_online: Optional[datetime] = None
    status: str = "Unknown"
    
    mail_alert_count: int = 0
    mail_last_alert: Optional[datetime] = None
    telegram_alert_count: int = 0
    telegram_last_alert: Optional[datetime] = None

    latitude: Optional[float] = None
    longitude: Optional[float] = None
    x_pos: Optional[float] = None
    y_pos: Optional[float] = None
    fov_angle: Optional[float] = None
    fov_radius: Optional[float] = None
    fov_spread: Optional[float] = None
    plan_id: Optional[int] = Field(default=None, foreign_key="mapplan.id")

    model: Optional[str] = None
    recording_scheduled: Optional[bool] = None
    recording_schedule_type: Optional[str] = None
    oldest_record: Optional[datetime] = None
    total_record_size_gb: Optional[float] = None
    total_record_duration_hours: Optional[float] = None
    recording_hours_24h: Optional[float] = None
    stats_last_updated: Optional[datetime] = None

class CameraChangeEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    nvr_ip: str = Field(index=True)
    camera_name: Optional[str] = None
    camera_channel_id: Optional[str] = None
    change_type: str  # "camera_added" | "camera_removed" | "recording_changed"
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    detected_at: datetime = Field(default_factory=datetime.now)
    group_id: Optional[int] = Field(default=None, foreign_key="nvrgroup.id")

class DowntimeEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    camera_id: int = Field(foreign_key="camera.id")
    start_time: datetime = Field(default_factory=datetime.now)
    end_time: Optional[datetime] = None

class OutageExplanation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    camera_id: int = Field(foreign_key="camera.id")
    downtime_event_id: Optional[int] = Field(default=None, foreign_key="downtimeevent.id")
    group_id: Optional[int] = Field(default=None, foreign_key="nvrgroup.id")
    start_time: datetime
    end_time: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.now)
    assigned_deadline: datetime
    explanation_type: Optional[str] = None
    explanation_detail: Optional[str] = None
    explained_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    explained_at: Optional[datetime] = None

class OutageCause(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    is_active: bool = Field(default=True)

class Log(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=datetime.now, index=True)
    category: str = Field(default="System", index=True)
    level: str = Field(default="INFO", index=True)
    action: Optional[str] = Field(default=None, index=True)
    actor_username: Optional[str] = Field(default="system", index=True)
    actor_ip: Optional[str] = None
    group_id: Optional[int] = Field(default=None, foreign_key="nvrgroup.id", index=True)
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    details: str
    log_type: Optional[str] = Field(default=None)
    state: Optional[str] = Field(default=None)


class Settings(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
    description: Optional[str] = None

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str           # sha256 hex (simple, no extra deps)
    role: str = "group_view"     # "admin" | "group_control" | "group_view"
    group_id: Optional[int] = Field(default=None, foreign_key="nvrgroup.id")
    accessible_group_ids: Optional[str] = Field(default=None)
    is_active: bool = True
    two_factor_secret: Optional[str] = None
    two_factor_enabled: bool = False

class UserAlertSettings(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", unique=True)
    mail_enabled: bool = False
    mail_recipients: Optional[str] = None   # comma-separated
    telegram_enabled: bool = False
    telegram_chat_ids: Optional[str] = None  # comma-separated

class UserSession(SQLModel, table=True):
    token: str = Field(primary_key=True)
    username: str
    role: str
    group_id: Optional[int] = Field(default=None, foreign_key="nvrgroup.id")
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=datetime.now)
    expires_at: datetime
    last_activity: datetime = Field(default_factory=datetime.now)

class ScheduledTask(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    description: str
    interval: int
    is_enabled: bool = True
    status: str = "Idle"
    last_run: Optional[datetime] = None
    last_duration: Optional[float] = None
    last_status: Optional[str] = None
    last_error: Optional[str] = None
    next_run: Optional[datetime] = None

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    hash_bytes = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100_000)
    return f"{salt.hex()}:{hash_bytes.hex()}"

def verify_password(password: str, hashed: str) -> bool:
    try:
        if ":" not in hashed:
            # Legacy SHA-256 fallback for compatibility
            legacy_hash = hashlib.sha256(password.encode()).hexdigest()
            return secrets.compare_digest(legacy_hash, hashed)
            
        salt_hex, hash_hex = hashed.split(":")
        salt = bytes.fromhex(salt_hex)
        expected_hash = bytes.fromhex(hash_hex)
        actual_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100_000)
        return secrets.compare_digest(actual_hash, expected_hash)
    except Exception:
        return False

def get_encryption_key() -> bytes:
    import os
    key_str = os.environ.get("ENCRYPTION_KEY")
    if key_str:
        return key_str.encode()
        
    key_file = "data/encryption.key"
    if os.path.exists(key_file):
        try:
            with open(key_file, "r") as f:
                content = f.read().strip()
                if content:
                    return content.encode()
        except Exception:
            pass
            
    try:
        from cryptography.fernet import Fernet
        new_key = Fernet.generate_key().decode()
        os.makedirs("data", exist_ok=True)
        with open(key_file, "w") as f:
            f.write(new_key)
        logger.info("Generated a new secure persistent ENCRYPTION_KEY in data/encryption.key")
        return new_key.encode()
    except Exception as e:
        logger.error(f"Failed to generate persistent ENCRYPTION_KEY: {e}")
        raise RuntimeError("Failed to generate encryption key") from e

def encrypt_password(password: str) -> str:
    if not password:
        return password
    from cryptography.fernet import Fernet
    try:
        f = Fernet(get_encryption_key())
        return f.encrypt(password.encode()).decode()
    except Exception as e:
        logger.error(f"Encryption error: {e}")
        return password

def decrypt_password(encrypted_password: str) -> str:
    if not encrypted_password:
        return encrypted_password
    from cryptography.fernet import Fernet, InvalidToken
    try:
        f = Fernet(get_encryption_key())
        return f.decrypt(encrypted_password.encode()).decode()
    except (InvalidToken, Exception):
        return encrypted_password


sqlite_file_name = "data/monitor.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

engine = create_engine(
    sqlite_url, 
    connect_args={"check_same_thread": False}
)

# Add this to execute PRAGMA journal_mode=WAL on connection
from sqlalchemy import event
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()

# Index creation on connection for performance
@event.listens_for(engine, "connect")
def create_performance_indexes(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    indexes = [
        ("ix_downtimeevent_camera_id", "downtimeevent", "camera_id"),
        ("ix_downtimeevent_end_time", "downtimeevent", "end_time"),
        ("ix_log_timestamp", "log", "timestamp"),
        ("ix_nvr_group_id", "nvr", "group_id"),
        ("ix_nvr_enabled", "nvr", "enabled"),
    ]
    for idx_name, table, column in indexes:
        try:
            cursor.execute(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({column})")
        except Exception:
            # Table might not exist yet during initial SQLModel metadata creation
            pass
    cursor.close()


def init_db():
    import os
    import sqlite3
    os.makedirs("data", exist_ok=True)
    SQLModel.metadata.create_all(engine)
    
    try:
        conn = sqlite3.connect(sqlite_file_name)
        run_migrations(conn)
        conn.close()
    except Exception as e:
        logger.error(f"Database init error: {e}")


# ---------------------------------------------------------------------------
# Migration System
# ---------------------------------------------------------------------------

CURRENT_MIGRATION_VERSION = 12


def _ensure_schema_version_table(conn: sqlite3.Connection):
    """Create schema_version table if it does not exist."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    )
    return cursor.fetchone() is not None


def _get_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    cursor = conn.execute(f"PRAGMA table_info({table_name})")
    return {row[1] for row in cursor.fetchall()}


def _column_exists(conn: sqlite3.Connection, table_name: str, col_name: str) -> bool:
    return col_name in _get_columns(conn, table_name)


# ---------------------------------------------------------------------------
# Migration 001 – Camera geo & FOV fields
# ---------------------------------------------------------------------------

def migration_001_add_camera_geo_fields(conn: sqlite3.Connection):
    """Add latitude, longitude, x_pos, y_pos, fov_angle, fov_radius, fov_spread to camera."""
    cols = _get_columns(conn, "camera")
    additions = {
        "latitude": "REAL",
        "longitude": "REAL",
        "x_pos": "REAL",
        "y_pos": "REAL",
        "fov_angle": "REAL",
        "fov_radius": "REAL",
        "fov_spread": "REAL",
    }
    for name, dtype in additions.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE camera ADD COLUMN {name} {dtype}")
            logger.info(f"[migration 001] Added column {name} to camera")


def rollback_001_add_camera_geo_fields(conn: sqlite3.Connection):
    """Rollback is no-op – SQLite does not support DROP COLUMN."""
    logger.info("[rollback 001] Skipped (SQLite does not support DROP COLUMN)")


# ---------------------------------------------------------------------------
# Migration 002 – Camera model & recording fields
# ---------------------------------------------------------------------------

def migration_002_add_camera_recording_fields(conn: sqlite3.Connection):
    """Add model, recording_scheduled, recording_schedule_type, oldest_record, etc. to camera."""
    cols = _get_columns(conn, "camera")
    additions = {
        "model": "TEXT",
        "recording_scheduled": "BOOLEAN",
        "recording_schedule_type": "TEXT",
        "oldest_record": "TIMESTAMP",
        "total_record_size_gb": "REAL",
        "total_record_duration_hours": "REAL",
        "recording_hours_24h": "REAL",
        "stats_last_updated": "TIMESTAMP",
    }
    for name, dtype in additions.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE camera ADD COLUMN {name} {dtype}")
            logger.info(f"[migration 002] Added column {name} to camera")


def rollback_002_add_camera_recording_fields(conn: sqlite3.Connection):
    logger.info("[rollback 002] Skipped (SQLite does not support DROP COLUMN)")


# ---------------------------------------------------------------------------
# Migration 003 – NVR name field
# ---------------------------------------------------------------------------

def migration_003_add_nvr_name(conn: sqlite3.Connection):
    """Add 'name' column to nvr."""
    if not _column_exists(conn, "nvr", "name"):
        conn.execute("ALTER TABLE nvr ADD COLUMN name TEXT")
        logger.info("[migration 003] Added column name to nvr")


def rollback_003_add_nvr_name(conn: sqlite3.Connection):
    logger.info("[rollback 003] Skipped (SQLite does not support DROP COLUMN)")


# ---------------------------------------------------------------------------
# Migration 004 – NVR status & alert fields
# ---------------------------------------------------------------------------

def migration_004_add_nvr_status_fields(conn: sqlite3.Connection):
    """Add status, last_online, mail/telegram alert columns, group_id to nvr."""
    cols = _get_columns(conn, "nvr")
    additions = {
        "status": "TEXT DEFAULT 'Unknown'",
        "last_online": "TIMESTAMP",
        "mail_alert_count": "INTEGER DEFAULT 0",
        "mail_last_alert": "TIMESTAMP",
        "telegram_alert_count": "INTEGER DEFAULT 0",
        "telegram_last_alert": "TIMESTAMP",
        "group_id": "INTEGER",
    }
    for name, dtype in additions.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE nvr ADD COLUMN {name} {dtype}")
            logger.info(f"[migration 004] Added column {name} to nvr")


def rollback_004_add_nvr_status_fields(conn: sqlite3.Connection):
    logger.info("[rollback 004] Skipped (SQLite does not support DROP COLUMN)")


# ---------------------------------------------------------------------------
# Migration 005 – User is_active & group_id
# ---------------------------------------------------------------------------

def migration_005_add_user_group_and_active(conn: sqlite3.Connection):
    """Add is_active and group_id to user."""
    cols = _get_columns(conn, "user")
    additions = {
        "is_active": "BOOLEAN DEFAULT 1",
        "group_id": "INTEGER",
    }
    for name, dtype in additions.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE user ADD COLUMN {name} {dtype}")
            logger.info(f"[migration 005] Added column {name} to user")


def rollback_005_add_user_group_and_active(conn: sqlite3.Connection):
    logger.info("[rollback 005] Skipped (SQLite does not support DROP COLUMN)")


# ---------------------------------------------------------------------------
# Migration 006 – NVRGroup map fields
# ---------------------------------------------------------------------------

def migration_006_add_nvrgroup_map_fields(conn: sqlite3.Connection):
    """Add map_center_lat, map_center_lng, map_zoom to nvrgroup."""
    cols = _get_columns(conn, "nvrgroup")
    additions = {
        "map_center_lat": "REAL",
        "map_center_lng": "REAL",
        "map_zoom": "INTEGER",
    }
    for name, dtype in additions.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE nvrgroup ADD COLUMN {name} {dtype}")
            logger.info(f"[migration 006] Added column {name} to nvrgroup")


def rollback_006_add_nvrgroup_map_fields(conn: sqlite3.Connection):
    logger.info("[rollback 006] Skipped (SQLite does not support DROP COLUMN)")


# ---------------------------------------------------------------------------
# Migration 007 – NVR rtsp_port
# ---------------------------------------------------------------------------

def migration_007_add_nvr_rtsp_port(conn: sqlite3.Connection):
    """Add rtsp_port to nvr."""
    if not _column_exists(conn, "nvr", "rtsp_port"):
        conn.execute("ALTER TABLE nvr ADD COLUMN rtsp_port INTEGER DEFAULT 554")
        logger.info("[migration 007] Added column rtsp_port to nvr")


def rollback_007_add_nvr_rtsp_port(conn: sqlite3.Connection):
    logger.info("[rollback 007] Skipped (SQLite does not support DROP COLUMN)")


# ---------------------------------------------------------------------------
# Migration 008 – MapPlan table
# ---------------------------------------------------------------------------

def migration_008_create_mapplan(conn: sqlite3.Connection):
    """Create the mapplan table."""
    if not _table_exists(conn, "mapplan"):
        conn.execute("""
            CREATE TABLE mapplan (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                image_url TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY(group_id) REFERENCES nvrgroup(id)
            )
        """)
        logger.info("[migration 008] Created mapplan table")


def rollback_008_create_mapplan(conn: sqlite3.Connection):
    if _table_exists(conn, "mapplan"):
        conn.execute("DROP TABLE mapplan")
        logger.info("[rollback 008] Dropped mapplan table")


# ---------------------------------------------------------------------------
# Migration 009 – Camera plan_id
# ---------------------------------------------------------------------------

def migration_009_add_camera_plan_id(conn: sqlite3.Connection):
    """Add plan_id to camera."""
    if not _column_exists(conn, "camera", "plan_id"):
        conn.execute("ALTER TABLE camera ADD COLUMN plan_id INTEGER")
        logger.info("[migration 009] Added column plan_id to camera")


def rollback_009_add_camera_plan_id(conn: sqlite3.Connection):
    logger.info("[rollback 009] Skipped (SQLite does not support DROP COLUMN)")


# ---------------------------------------------------------------------------
# Migration 010 – ScheduledTask last_error
# ---------------------------------------------------------------------------

def migration_010_add_scheduledtask_last_error(conn: sqlite3.Connection):
    """Add last_error to scheduledtask."""
    if not _column_exists(conn, "scheduledtask", "last_error"):
        conn.execute("ALTER TABLE scheduledtask ADD COLUMN last_error TEXT")
        logger.info("[migration 010] Added column last_error to scheduledtask")


def rollback_010_add_scheduledtask_last_error(conn: sqlite3.Connection):
    logger.info("[rollback 010] Skipped (SQLite does not support DROP COLUMN)")


# ---------------------------------------------------------------------------
# Migration 011 – Performance indexes
# ---------------------------------------------------------------------------

def migration_011_add_performance_indexes(conn: sqlite3.Connection):
    """Add performance indexes for common query patterns."""
    indexes = [
        ("ix_downtimeevent_camera_id", "downtimeevent", "camera_id"),
        ("ix_downtimeevent_end_time", "downtimeevent", "end_time"),
        ("ix_log_timestamp", "log", "timestamp"),
        ("ix_nvr_group_id", "nvr", "group_id"),
        ("ix_nvr_enabled", "nvr", "enabled"),
    ]
    for idx_name, table, column in indexes:
        conn.execute(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({column})")
        logger.info(f"[migration 011] Created index {idx_name} on {table}({column})")


def rollback_011_add_performance_indexes(conn: sqlite3.Connection):
    """Drop performance indexes added by migration 011."""
    indexes = [
        "ix_downtimeevent_camera_id",
        "ix_downtimeevent_end_time",
        "ix_log_timestamp",
        "ix_nvr_group_id",
        "ix_nvr_enabled",
    ]
    for idx_name in indexes:
        conn.execute(f"DROP INDEX IF EXISTS {idx_name}")
        logger.info(f"[rollback 011] Dropped index {idx_name}")


# ---------------------------------------------------------------------------
# Migration 012 – User 2FA fields
# ---------------------------------------------------------------------------

def migration_012_add_user_2fa_fields(conn: sqlite3.Connection):
    """Add two_factor_secret and two_factor_enabled to user."""
    cols = _get_columns(conn, "user")
    additions = {
        "two_factor_secret": "TEXT",
        "two_factor_enabled": "BOOLEAN DEFAULT 0",
    }
    for name, dtype in additions.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE user ADD COLUMN {name} {dtype}")
            logger.info(f"[migration 012] Added column {name} to user")


def rollback_012_add_user_2fa_fields(conn: sqlite3.Connection):
    logger.info("[rollback 012] Skipped (SQLite does not support DROP COLUMN)")


# ---------------------------------------------------------------------------
# Migration 013 – OutageExplanation table & User accessible_group_ids
# ---------------------------------------------------------------------------

def migration_013_add_outage_explanation(conn: sqlite3.Connection):
    """Create outageexplanation table and add accessible_group_ids to user."""
    # 1. Create table outageexplanation
    if not _table_exists(conn, "outageexplanation"):
        conn.execute("""
            CREATE TABLE outageexplanation (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                camera_id INTEGER NOT NULL,
                downtime_event_id INTEGER,
                group_id INTEGER,
                start_time TIMESTAMP NOT NULL,
                end_time TIMESTAMP,
                created_at TIMESTAMP NOT NULL,
                assigned_deadline TIMESTAMP NOT NULL,
                explanation_type TEXT,
                explanation_detail TEXT,
                explained_by_user_id INTEGER,
                explained_at TIMESTAMP,
                FOREIGN KEY(camera_id) REFERENCES camera(id),
                FOREIGN KEY(downtime_event_id) REFERENCES downtimeevent(id),
                FOREIGN KEY(group_id) REFERENCES nvrgroup(id),
                FOREIGN KEY(explained_by_user_id) REFERENCES user(id)
            )
        """)
        logger.info("[migration 013] Created outageexplanation table")
        
    # 2. Add accessible_group_ids to user
    if not _column_exists(conn, "user", "accessible_group_ids"):
        conn.execute("ALTER TABLE user ADD COLUMN accessible_group_ids TEXT")
        logger.info("[migration 013] Added column accessible_group_ids to user")


def rollback_013_add_outage_explanation(conn: sqlite3.Connection):
    if _table_exists(conn, "outageexplanation"):
        conn.execute("DROP TABLE outageexplanation")
        logger.info("[rollback 013] Dropped outageexplanation table")
    logger.info("[rollback 013] rollback skipped (SQLite)")


# ---------------------------------------------------------------------------
# Migration 014 – OutageCause table
# ---------------------------------------------------------------------------

def migration_014_add_outage_cause(conn: sqlite3.Connection):
    """Recreate outageexplanation to make downtime_event_id nullable, and create outagecause table."""
    conn.execute("DROP TABLE IF EXISTS outageexplanation")
    conn.execute("""
        CREATE TABLE outageexplanation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            downtime_event_id INTEGER,
            group_id INTEGER,
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP,
            created_at TIMESTAMP NOT NULL,
            assigned_deadline TIMESTAMP NOT NULL,
            explanation_type TEXT,
            explanation_detail TEXT,
            explained_by_user_id INTEGER,
            explained_at TIMESTAMP,
            FOREIGN KEY(camera_id) REFERENCES camera(id),
            FOREIGN KEY(downtime_event_id) REFERENCES downtimeevent(id),
            FOREIGN KEY(group_id) REFERENCES nvrgroup(id),
            FOREIGN KEY(explained_by_user_id) REFERENCES user(id)
        )
    """)
    logger.info("[migration 014] Recreated outageexplanation table to support nullable downtime_event_id")

    if not _table_exists(conn, "outagecause"):
        conn.execute("""
            CREATE TABLE outagecause (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                is_active BOOLEAN DEFAULT 1
            )
        """)
        logger.info("[migration 014] Created outagecause table")
        
    # Seed default values
    defaults = ["قطعی برق", "تعمیرات", "حوادث عمرانی", "مشکلات دیگر"]
    for d in defaults:
        conn.execute("INSERT OR IGNORE INTO outagecause (name, is_active) VALUES (?, 1)", (d,))
    conn.commit()


def rollback_014_add_outage_cause(conn: sqlite3.Connection):
    if _table_exists(conn, "outagecause"):
        conn.execute("DROP TABLE outagecause")
        logger.info("[rollback 014] Dropped outagecause table")


# ---------------------------------------------------------------------------
# Migration 015 – Log table upgrade for audit system
# ---------------------------------------------------------------------------

def migration_015_upgrade_log_table(conn: sqlite3.Connection):
    """Upgrade log table with structured audit fields."""
    cols = _get_columns(conn, "log")
    additions = {
        "category": "TEXT DEFAULT 'System'",
        "level": "TEXT DEFAULT 'INFO'",
        "action": "TEXT",
        "actor_username": "TEXT DEFAULT 'system'",
        "actor_ip": "TEXT",
        "group_id": "INTEGER",
        "target_type": "TEXT",
        "target_id": "TEXT",
        "log_type": "TEXT",
        "state": "TEXT",
    }
    for name, dtype in additions.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE log ADD COLUMN {name} {dtype}")
            logger.info(f"[migration 015] Added column {name} to log")

    conn.execute("CREATE INDEX IF NOT EXISTS ix_log_timestamp ON log (timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_log_category ON log (category)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_log_level ON log (level)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_log_action ON log (action)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_log_group_id ON log (group_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_log_actor_username ON log (actor_username)")
    conn.commit()


def rollback_015_upgrade_log_table(conn: sqlite3.Connection):
    logger.info("[rollback 015] Skipped (SQLite does not support DROP COLUMN)")


# ---------------------------------------------------------------------------
# Migration registry
# ---------------------------------------------------------------------------

CURRENT_MIGRATION_VERSION = 15


MIGRATIONS = {
    1: ("add_camera_geo_fields", migration_001_add_camera_geo_fields),
    2: ("add_camera_recording_fields", migration_002_add_camera_recording_fields),
    3: ("add_nvr_name", migration_003_add_nvr_name),
    4: ("add_nvr_status_fields", migration_004_add_nvr_status_fields),
    5: ("add_user_group_and_active", migration_005_add_user_group_and_active),
    6: ("add_nvrgroup_map_fields", migration_006_add_nvrgroup_map_fields),
    7: ("add_nvr_rtsp_port", migration_007_add_nvr_rtsp_port),
    8: ("create_mapplan", migration_008_create_mapplan),
    9: ("add_camera_plan_id", migration_009_add_camera_plan_id),
    10: ("add_scheduledtask_last_error", migration_010_add_scheduledtask_last_error),
    11: ("add_performance_indexes", migration_011_add_performance_indexes),
    12: ("add_user_2fa_fields", migration_012_add_user_2fa_fields),
    13: ("add_outage_explanation", migration_013_add_outage_explanation),
    14: ("add_outage_cause", migration_014_add_outage_cause),
    15: ("upgrade_log_table", migration_015_upgrade_log_table),
}

ROLLBACKS = {
    1: rollback_001_add_camera_geo_fields,
    2: rollback_002_add_camera_recording_fields,
    3: rollback_003_add_nvr_name,
    4: rollback_004_add_nvr_status_fields,
    5: rollback_005_add_user_group_and_active,
    6: rollback_006_add_nvrgroup_map_fields,
    7: rollback_007_add_nvr_rtsp_port,
    8: rollback_008_create_mapplan,
    9: rollback_009_add_camera_plan_id,
    10: rollback_010_add_scheduledtask_last_error,
    11: rollback_011_add_performance_indexes,
    12: rollback_012_add_user_2fa_fields,
    13: rollback_013_add_outage_explanation,
    14: rollback_014_add_outage_cause,
    15: rollback_015_upgrade_log_table,
}


def get_current_version(conn: sqlite3.Connection) -> int:
    """Return the current schema version. 0 if no migrations have been applied."""
    _ensure_schema_version_table(conn)
    cursor = conn.execute("SELECT MAX(version) FROM schema_version")
    row = cursor.fetchone()
    return row[0] if row and row[0] is not None else 0


def run_migrations(conn: sqlite3.Connection):
    """Run all pending migrations in order."""
    _ensure_schema_version_table(conn)
    current = get_current_version(conn)

    for ver in sorted(MIGRATIONS.keys()):
        if ver <= current:
            continue
        name, func = MIGRATIONS[ver]
        logger.info(f"[migration] Running v{ver:03d}: {name}")
        func(conn)
        conn.execute(
            "INSERT INTO schema_version (version, name) VALUES (?, ?)",
            (ver, name),
        )
        conn.commit()
        logger.info(f"[migration] v{ver:03d} applied successfully")

    logger.info(f"[migration] Database is at version {CURRENT_MIGRATION_VERSION}")


def rollback_migration(conn: sqlite3.Connection, target_version: int):
    """Rollback migrations down to (but not including) target_version."""
    _ensure_schema_version_table(conn)
    current = get_current_version(conn)

    if target_version >= current:
        logger.info(f"[rollback] Already at or below version {target_version}, nothing to do")
        return

    for ver in range(current, target_version, -1):
        if ver not in ROLLBACKS:
            logger.warning(f"[rollback] No rollback function for version {ver}, skipping")
            continue
        name = MIGRATIONS[ver][0]
        logger.info(f"[rollback] Rolling back v{ver:03d}: {name}")
        ROLLBACKS[ver](conn)
        conn.execute("DELETE FROM schema_version WHERE version = ?", (ver,))
        conn.commit()
        logger.info(f"[rollback] v{ver:03d} rolled back successfully")

    logger.info(f"[rollback] Database rolled back to version {target_version}")

def get_session():
    with Session(engine) as session:
        yield session