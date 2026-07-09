from __future__ import annotations
from sqlmodel import SQLModel, Field, create_engine, Session
from datetime import datetime
from typing import Optional

class NVR(SQLModel, table=True):
    ip: str = Field(primary_key=True)
    user: str
    password: Optional[str] = None
    enabled: bool = True

class Camera(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    ip: str
    nvr_ip: str = Field(index=True)
    channel_id: str
    is_muted: bool = False
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

class DowntimeEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    camera_id: int = Field(foreign_key="camera.id")
    start_time: datetime = Field(default_factory=datetime.now)
    end_time: Optional[datetime] = None

class Log(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=datetime.now)
    log_type: str
    state: str
    details: str

class Settings(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
    description: Optional[str] = None

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


def init_db():
    import os
    import sqlite3
    os.makedirs("data", exist_ok=True)
    SQLModel.metadata.create_all(engine)
    
    try:
        conn = sqlite3.connect(sqlite_file_name)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(camera)")
        existing_columns = [row[1] for row in cursor.fetchall()]
        
        new_cols = {
            "latitude": "REAL",
            "longitude": "REAL",
            "x_pos": "REAL",
            "y_pos": "REAL",
            "fov_angle": "REAL",
            "fov_radius": "REAL",
            "fov_spread": "REAL"
        }
        
        for col_name, col_type in new_cols.items():
            if col_name not in existing_columns:
                cursor.execute(f"ALTER TABLE camera ADD COLUMN {col_name} {col_type}")
                print(f"Added column {col_name} to camera table.")
        
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Database migration error: {e}")

def get_session():
    with Session(engine) as session:
        yield session