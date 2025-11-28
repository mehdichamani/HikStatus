"""
API endpoints for CCTV Mailer Web Service.
Provides data to the web UI.
"""
from time_utils import get_tehran_time, format_datetime, format_persian_datetime
from datetime import timedelta
import json
import os

from flask import Blueprint, jsonify, request, current_app, session
from flask_babel import get_locale
from sqlalchemy import func

from models import db, AlertLog, CameraState, CheckRecord
from monitor_manager import start_monitor_thread

api_bp = Blueprint('api', __name__)

@api_bp.before_request
def require_login():
    if not session.get('logged_in'):
        return jsonify({'error': 'Unauthorized'}), 401

@api_bp.route('/status')
def get_status():
    """Get current camera status."""
    try:
        states = CameraState.query.order_by(CameraState.nvr_ip, CameraState.camera_name).all()
        locale = session.get('language', 'en')
        formatted_states = []
        now = get_tehran_time()
        for state in states:
            state_dict = state.to_dict()
            if locale == 'fa':
                state_dict['last_online'] = format_persian_datetime(state.last_online)
                state_dict['last_check'] = format_persian_datetime(state.last_check)
                if state.last_alert_time:
                    state_dict['last_alert_time'] = format_persian_datetime(state.last_alert_time)
            else:
                state_dict['last_online'] = format_datetime(state.last_online)
                state_dict['last_check'] = format_datetime(state.last_check)
                if state.last_alert_time:
                    state_dict['last_alert_time'] = format_datetime(state.last_alert_time)
            
            if state.status != 'Online':
                downtime = now - state.last_online
                state_dict['downtime_seconds'] = downtime.total_seconds()
            else:
                state_dict['downtime_seconds'] = 0

            formatted_states.append(state_dict)
        return jsonify(formatted_states)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route('/checks')
def get_checks():
    """Get recent check records."""
    try:
        # Get unique NVR IPs from config
        nvr_ips = {nvr['ip'] for nvr in current_app.config.get("NVR_LIST_CONFIG", [])}
        
        # Subquery to find the latest check_number for each NVR
        subquery = db.session.query(
            CheckRecord.nvr_ip,
            func.max(CheckRecord.check_number).label('max_check')
        ).filter(CheckRecord.nvr_ip.in_(nvr_ips)).group_by(CheckRecord.nvr_ip).subquery()

        # Query to get the full record for that latest check
        checks = db.session.query(CheckRecord).join(
            subquery,
            (CheckRecord.nvr_ip == subquery.c.nvr_ip) &
            (CheckRecord.check_number == subquery.c.max_check)
        ).order_by(CheckRecord.nvr_ip).all()
        
        locale = session.get('language', 'en')
        formatted_checks = []
        for check in checks:
            check_dict = check.to_dict()
            if locale == 'fa':
                check_dict['timestamp'] = format_persian_datetime(check.timestamp)
            else:
                check_dict['timestamp'] = format_datetime(check.timestamp)
            formatted_checks.append(check_dict)

        return jsonify(formatted_checks)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route('/logs')
def get_logs():
    """Get recent alert/event logs."""
    try:
        limit = request.args.get('limit', 200, type=int)
        
        logs = AlertLog.query.order_by(AlertLog.timestamp.desc()).limit(limit).all()
        
        locale = session.get('language', 'en')
        formatted_logs = []
        for log in logs:
            log_dict = log.to_dict()
            dt_obj = log.timestamp
            
            if locale == 'fa':
                log_dict['timestamp'] = format_persian_datetime(dt_obj)
            else:
                log_dict['timestamp'] = format_datetime(dt_obj)
            formatted_logs.append(log_dict)

        return jsonify(formatted_logs)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api_bp.route('/reports/uptime_24h')
def get_uptime_report():
    """Calculate and return uptime for all cameras in the last 24h."""
    try:
        end_time = get_tehran_time()
        start_time = end_time - timedelta(hours=24)
        total_window_seconds = (end_time - start_time).total_seconds()
        
        all_cameras = CameraState.query.all()
        report = []

        for cam in all_cameras:
            cam_downtime = 0
            
            # 1. Find completed downtimes (camera_up events)
            up_logs = AlertLog.query.filter(
                AlertLog.nvr_ip == cam.nvr_ip,
                AlertLog.camera_ip == cam.camera_ip, # Use IP + NVR as unique key
                AlertLog.alert_type == 'camera_up',
                AlertLog.timestamp > start_time,
                AlertLog.duration_seconds.isnot(None)
            ).all()

            for log in up_logs:
                downtime_start = log.timestamp - timedelta(seconds=log.duration_seconds)
                # Clip the start of the downtime to the 24h window
                clip_start = max(downtime_start, start_time)
                # Calculate how much of this downtime was *inside* the window
                downtime_in_window = (log.timestamp - clip_start).total_seconds()
                cam_downtime += downtime_in_window

            # 2. Check current state if camera is still down
            if cam.status != 'Online':
                # Find how much of the *current* downtime is in the window
                downtime_start = max(cam.last_online, start_time)
                downtime_in_window = (end_time - downtime_start).total_seconds()
                cam_downtime += downtime_in_window

            uptime_percent = max(0, 100 * (1 - (cam_downtime / total_window_seconds)))

            report.append({
                "id": cam.id,
                "name": cam.camera_name,
                "ip": cam.camera_ip,
                "nvr_ip": cam.nvr_ip,
                "downtime_seconds": cam_downtime,
                "uptime_percent": round(uptime_percent, 2)
            })
            
        return jsonify(report)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/config', methods=['GET', 'POST'])
def handle_config():
    """Get or update service configuration."""
    
    # We edit the main config.json, not the secure one
    config_path = current_app.config_file
    
    if request.method == 'POST':
        try:
            data = request.json
            
            # Read current config
            with open(config_path, 'r') as f:
                config = json.load(f)
            
            # Update values
            config['FIRST_ALERT_DELAY_MINUTES'] = int(data.get('FIRST_ALERT_DELAY_MINUTES', 15))
            config['ALERT_FREQUENCY_MINUTES'] = int(data.get('ALERT_FREQUENCY_MINUTES', 30))
            config['MUTE_AFTER_N_ALERTS'] = int(data.get('MUTE_AFTER_N_ALERTS', 3))
            
            # Write back to config.json
            with open(config_path, 'w') as f:
                json.dump(config, f, indent=2)
            
            # Update running app config
            current_app.config.update(config)
            
            # Log the config change
            log_details = f"Config updated via UI: First_Delay={config['FIRST_ALERT_DELAY_MINUTES']}, Freq={config['ALERT_FREQUENCY_MINUTES']}, Mute_N={config['MUTE_AFTER_N_ALERTS']}"
            try:
                alert = AlertLog(
                    timestamp=get_tehran_time(),
                    alert_type="service_config_changed",
                    details=log_details,
                    severity='info'
                )
                db.session.add(alert)
                db.session.commit()
            except Exception as e:
                current_app.logger.error(f"Failed to log config change: {e}")
                db.session.rollback() # Ignore if logging fails
            
            # Restart monitor thread to apply new settings
            start_monitor_thread(current_app._get_current_object())
            
            return jsonify({'success': True, 'message': 'Configuration saved and monitor restarted.'})
        
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    if request.method == 'GET':
        try:
            config = {
                'FIRST_ALERT_DELAY_MINUTES': current_app.config.get('FIRST_ALERT_DELAY_MINUTES', 15),
                'ALERT_FREQUENCY_MINUTES': current_app.config.get('ALERT_FREQUENCY_MINUTES', 30),
                'MUTE_AFTER_N_ALERTS': current_app.config.get('MUTE_AFTER_N_ALERTS', 3),
            }
            return jsonify(config)
        except Exception as e:
            return jsonify({'error': str(e)}), 500