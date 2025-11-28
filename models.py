"""
Database models for CCTV Mailer Web Service.
Stores camera state, check history, and alert logs.
"""

from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func
from time_utils import get_tehran_time


db = SQLAlchemy()


class AlertLog(db.Model):
    """Alert/check log entries with detailed raw data."""
    __tablename__ = 'alert_logs'

    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=get_tehran_time, index=True)
    alert_type = db.Column(db.String(50), nullable=False, index=True)  # 'camera_down', 'camera_up', 'nvr_error', 'mail_sent', etc.
    nvr_ip = db.Column(db.String(50), nullable=True, index=True)
    camera_ip = db.Column(db.String(50), nullable=True, index=True)
    camera_name = db.Column(db.String(255), nullable=True)
    status = db.Column(db.String(50), nullable=True)  # 'Online', 'Offline'
    down_check_count = db.Column(db.Integer, default=0)  # How many checks the camera has been down
    severity = db.Column(db.String(20), default='info')  # 'info', 'warning', 'error'
    
    # --- NEW FIELDS FOR LOGGING ---
    duration_seconds = db.Column(db.Integer, nullable=True) # Stores downtime duration when logging 'camera_up'
    
    # Raw data fields
    mail_recipients = db.Column(db.Text, nullable=True)  # Comma-separated list of recipients
    details = db.Column(db.Text, nullable=True)  # Additional details (formerly "message")

    def to_dict(self):
        """Convert to dictionary."""
        return {
            'id': self.id,
            'timestamp': self.timestamp.isoformat(),
            'alert_type': self.alert_type,
            'nvr_ip': self.nvr_ip,
            'camera_ip': self.camera_ip,
            'camera_name': self.camera_name,
            'status': self.status,
            'down_check_count': self.down_check_count,
            'severity': self.severity,
            'duration_seconds': self.duration_seconds, # Added new field
            'mail_recipients': self.mail_recipients,
            'details': self.details
        }

    def __repr__(self):
        return f"<AlertLog {self.timestamp} - {self.alert_type}>"


class CameraState(db.Model):
    """Current state of cameras."""
    __tablename__ = 'camera_states'

    id = db.Column(db.Integer, primary_key=True)
    nvr_ip = db.Column(db.String(50), nullable=False, index=True)
    channel_id = db.Column(db.String(50), nullable=False)
    camera_ip = db.Column(db.String(50), nullable=False)
    camera_name = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(50), nullable=False, index=True)  # 'Online', 'Offline'
    last_online = db.Column(db.DateTime, default=get_tehran_time)
    last_check = db.Column(db.DateTime, default=get_tehran_time)
    down_check_count = db.Column(db.Integer, default=0)
    down_alert_sent = db.Column(db.Boolean, default=False) # Note: This field is no longer used by new logic
    
    # --- FIELDS FOR ALERT SUPPRESSION ---
    last_alert_time = db.Column(db.DateTime, nullable=True) # Tracks when the last alert email was sent for this specific camera
    alert_email_count = db.Column(db.Integer, default=0)    # Tracks how many alert emails have been sent for the current downtime
    is_muted = db.Column(db.Boolean, default=False, index=True) # Flag to suppress recurring alerts

    __table_args__ = (
        db.UniqueConstraint('nvr_ip', 'channel_id', name='unique_nvr_channel'),
    )

    def to_dict(self):
        """Convert to dictionary."""
        return {
            'id': self.id,
            'nvr_ip': self.nvr_ip,
            'channel_id': self.channel_id,
            'camera_ip': self.camera_ip,
            'camera_name': self.camera_name,
            'status': self.status,
            'last_online': self.last_online.isoformat(),
            'last_check': self.last_check.isoformat(),
            'down_check_count': self.down_check_count,
            'down_alert_sent': self.down_alert_sent,
            'last_alert_time': self.last_alert_time.isoformat() if self.last_alert_time else None,
            'alert_email_count': self.alert_email_count,
            'is_muted': self.is_muted
        }

    def __repr__(self):
        return f"<CameraState {self.camera_name} - {self.status}>"


class CheckRecord(db.Model):
    """Record of each polling check."""
    __tablename__ = 'check_records'

    id = db.Column(db.Integer, primary_key=True)
    check_number = db.Column(db.Integer, nullable=False, index=True)
    timestamp = db.Column(db.DateTime, default=get_tehran_time, index=True)
    nvr_ip = db.Column(db.String(50), nullable=False, index=True)
    total_cameras = db.Column(db.Integer, default=0)
    online_cameras = db.Column(db.Integer, default=0)
    status = db.Column(db.String(50), nullable=False)  # '✅', '⚠️', '🚫'

    def to_dict(self):
        """Convert to dictionary."""
        return {
            'id': self.id,
            'check_number': self.check_number,
            'timestamp': self.timestamp.isoformat(),
            'nvr_ip': self.nvr_ip,
            'total_cameras': self.total_cameras,
            'online_cameras': self.online_cameras,
            'status': self.status
        }

    def __repr__(self):
        return f"<CheckRecord {self.check_number} - {self.nvr_ip}>"


class ServiceConfig(db.Model):
    """Service configuration stored in database (for tracking changes)."""
    __tablename__ = 'service_config'

    id = db.Column(db.Integer, primary_key=True)
    config_key = db.Column(db.String(255), unique=True, nullable=False, index=True)
    config_value = db.Column(db.Text, nullable=False)
    updated_at = db.Column(db.DateTime, default=get_tehran_time, onupdate=get_tehran_time)

    def to_dict(self):
        """Convert to dictionary."""
        return {
            'config_key': self.config_key,
            'config_value': self.config_value,
            'updated_at': self.updated_at.isoformat()
        }

    def __repr__(self):
        return f"<ServiceConfig {self.config_key}>"