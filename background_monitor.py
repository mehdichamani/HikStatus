"""
Background monitoring service for CCTV NVR status.
Runs polling checks and maintains state independently from web UI.
Communicates with web app via shared database.
"""

import csv
import json
import os
import sys
import threading
import time
from datetime import timedelta
from math import ceil
from pathlib import Path

import requests
from requests.auth import HTTPDigestAuth
import xml.etree.ElementTree as ET

from colors import Colors, LogStyle, colored_text
from models import db, AlertLog, CameraState, CheckRecord
from mailer import send_email
from time_utils import get_tehran_time, format_datetime, format_persian_datetime


def safe_print(*args, **kwargs):
    """Safe print function that handles encoding errors gracefully."""
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        output = ' '.join(str(arg) for arg in args)
        try:
            output_safe = output.encode(sys.stdout.encoding or 'utf-8', errors='replace').decode(sys.stdout.encoding or 'utf-8', errors='replace')
            print(output_safe, **kwargs)
        except:
            print(repr(output), **kwargs)


def format_downtime(minutes):
    """Helper function to format downtime minutes into Dd HH:MM string."""
    if minutes < 0:
        minutes = 0
    
    days = minutes // 1440
    hours = (minutes % 1440) // 60
    mins = minutes % 60
    
    if days > 0:
        return f"{days}d {hours:02d}:{mins:02d}"
    else:
        return f"{hours:02d}:{mins:02d}"


class BackgroundMonitor(threading.Thread):
    """
    Background monitoring thread.
    Runs polling cycle continuously and maintains state.
    """

    def __init__(self, app):
        """Initialize the background monitor."""
        super().__init__(daemon=True)
        self.app = app
        self.running = True
        self.camera_ip_map = {}
        self.check_count = 0
        self.lock = threading.Lock()
        
        # Alert timing logic
        self.polling_interval = 60 # HARDCODED as requested
        self.first_alert_delay = timedelta(minutes=15)
        self.alert_frequency = timedelta(minutes=60)
        self.mute_after_n_alerts = 3 # Default, will be overridden by config
        self.nvr_shared_password = ""

    def load_config_from_app(self):
        """Load configuration from the running Flask app."""
        if not self.app:
            return False
        
        with self.app.app_context():
            # NVR list
            self.nvr_configs = self.app.config.get("NVR_LIST_CONFIG", [])
            if not self.nvr_configs:
                print(f"\n{LogStyle.FATAL_ERROR} NVR list not found in configuration.")
                return False
            
            # Other settings
            # POLLING_INTERVAL_SECONDS is removed and hardcoded to 60
            self.camera_name_file = self.app.config.get("CAMERA_NAME_FILE", "camera_names.csv")
            self.mail_recipients = self.app.config.get("MAIL_RECIPIENTS", [])
            
            # Load alert timings
            self.first_alert_delay = timedelta(minutes=self.app.config.get("FIRST_ALERT_DELAY_MINUTES", 15))
            self.alert_frequency = timedelta(minutes=self.app.config.get("ALERT_FREQUENCY_MINUTES", 60))
            
            # Load mute setting (from config.json, which is updated by the UI)
            self.mute_after_n_alerts = int(self.app.config.get("MUTE_AFTER_N_ALERTS", 3))
            
            # Shared NVR Password
            self.nvr_shared_password = self.app.config.get("NVR_SHARED_PASSWORD")
            if not self.nvr_shared_password:
                print(f"\n{LogStyle.FATAL_ERROR} NVR_SHARED_PASSWORD not found in secure config file.")
                return False
        
        return True

    def load_camera_names(self):
        """Load camera IP/name mapping from CSV file."""
        self.camera_ip_map = {}
        
        if not os.path.exists(self.camera_name_file):
            print(f"\n{LogStyle.ERROR} Camera names file not found: {self.camera_name_file}")
            return False

        try:
            with open(self.camera_name_file, 'r', newline='') as f:
                reader = csv.reader(f)
                next(reader, None)  # Skip header

                for row in reader:
                    if len(row) >= 2:
                        ip_address = row[0].strip()
                        camera_name = row[1].strip()
                        if ip_address:
                            self.camera_ip_map[ip_address] = camera_name

            print(f"{LogStyle.SUCCESS} Loaded {len(self.camera_ip_map)} camera names.")
            return True

        except Exception as e:
            print(f"{LogStyle.ERROR} Failed to load camera names: {e}")
            return False

    def save_state_to_db(self, nvr_ip_list, poll_results):
        """Save current camera state and check record to the database."""
        with self.app.app_context():
            try:
                offline_count = 0
                online_count = 0
                now = get_tehran_time()
                
                # We only want to process NVRs that are in the config
                nvr_set = set(nvr_ip_list)
                
                # Get all states from DB for NVRs in config
                all_cam_states = db.session.query(CameraState).filter(CameraState.nvr_ip.in_(nvr_set)).all()
                cam_state_map = {f"{cam.nvr_ip}-{cam.channel_id}": cam for cam in all_cam_states}

                active_keys_in_poll = set()
                
                for nvr_ip in nvr_set:
                    # Find all cameras for this NVR from the poll
                    nvr_cam_keys = {k: v for k, v in poll_results.items() if k.startswith(f"{nvr_ip}-")}
                    active_keys_in_poll.update(nvr_cam_keys.keys())

                    for key, state in nvr_cam_keys.items():
                        parts = key.split('-', 1)
                        nvr_ip_state = parts[0]
                        channel_id = parts[1]

                        try:
                            # The incoming state['last_online'] is now a datetime object
                            last_online_dt = state.get('last_online')
                        except:
                            last_online_dt = now # Fallback

                        cam_state = cam_state_map.get(key)
                        if not cam_state:
                            cam_state = CameraState(
                                nvr_ip=nvr_ip_state,
                                channel_id=channel_id,
                                last_online=now # Set initial last_online for new cameras
                            )
                            db.session.add(cam_state)

                        # --- NEW LOGIC: Check for Recovery (Offline -> Online) ---
                        # Only log 'camera_up' if it *was* marked as offline in the DB
                        was_offline = cam_state.status and cam_state.status != 'Online'
                        is_online = state.get('status') == 'Online'

                        if was_offline and is_online:
                            # Camera is back online!
                            downtime_duration = now - cam_state.last_online
                            downtime_minutes = int(downtime_duration.total_seconds() / 60)
                            downtime_seconds = int(downtime_duration.total_seconds())
                            
                            downtime_str = format_downtime(downtime_minutes)
                            log_details = f"Camera is back online. Downtime: {downtime_str}"
                            
                            self.log_event(
                                event_type="camera_up",
                                timestamp=now,
                                nvr_ip=cam_state.nvr_ip,
                                camera_ip=state.get('ip', 'N/A'),
                                camera_name=state.get('name', 'Unknown'),
                                status="Online",
                                details=log_details,
                                severity='info',
                                down_check_count=cam_state.down_check_count, # Log final check count
                                duration_seconds=downtime_seconds # Store duration
                            )
                            print(f"{LogStyle.SUCCESS} [{cam_state.camera_name}] Camera is back online. Downtime: {downtime_str}")

                            # Reset alert state
                            cam_state.alert_email_count = 0
                            cam_state.is_muted = False
                            cam_state.last_alert_time = None

                        # --- NEW LOGIC: Check for First Offline ---
                        # This only applies if the camera was previously Online
                        was_online = cam_state.status == 'Online'
                        is_offline = state.get('status') != 'Online'
                        
                        if was_online and is_offline:
                             # This is the moment it went offline. Set last_online to NOW.
                             cam_state.last_online = now
                             last_online_dt = now


                        # Update all fields
                        cam_state.camera_ip = state.get('ip', 'N/A')
                        cam_state.camera_name = state.get('name', 'Unknown')
                        cam_state.status = state.get('status', 'Unknown')
                        cam_state.last_online = last_online_dt # Use the calculated last_online
                        cam_state.last_check = now
                        cam_state.down_check_count = state.get('down_check_count', 0)
                        
                        # down_alert_sent is no longer used by new logic
                        cam_state.down_alert_sent = False 

                        if cam_state.status == 'Online':
                            online_count += 1
                        else:
                            offline_count += 1
                
                # Pruning logic
                all_db_keys = set(cam_state_map.keys())
                stale_keys = all_db_keys - active_keys_in_poll

                if stale_keys:
                    print(f"{LogStyle.INFO} Pruning {len(stale_keys)} stale camera(s) from database.")
                    for key in stale_keys:
                        nvr_ip, channel_id = key.split('-', 1)
                        # Log the deletion? Maybe too noisy.
                        db.session.query(CameraState).filter_by(
                            nvr_ip=nvr_ip, 
                            channel_id=channel_id
                        ).delete(synchronize_session=False)
                
                # Record this check
                check_status = '✅' if offline_count == 0 else '⚠️'
                check_record = CheckRecord(
                    nvr_ip='ALL',
                    timestamp=now,
                    total_cameras=online_count + offline_count,
                    online_cameras=online_count,
                    status=check_status,
                    check_number=self.check_count
                )
                db.session.add(check_record)
                
                db.session.commit()
            except Exception as e:
                print(f"{LogStyle.ERROR} Failed to save state to database: {e}")
                db.session.rollback()


    def log_event(self, event_type, timestamp, nvr_ip=None, camera_ip=None, camera_name=None,
                  status=None, details=None, severity='info', mail_recipients=None, down_check_count=None,
                  duration_seconds=None):
        """
        Log an event to the database.
        """
        if not self.app:
            return

        try:
            with self.app.app_context():
                log_entry = AlertLog(
                    timestamp=timestamp,
                    alert_type=event_type,
                    nvr_ip=nvr_ip,
                    camera_ip=camera_ip,
                    camera_name=camera_name or "N/A",
                    status=status,
                    details=details,
                    severity=severity,
                    mail_recipients=mail_recipients,
                    down_check_count=down_check_count,
                    duration_seconds=duration_seconds # Added duration
                )
                db.session.add(log_entry)
                db.session.commit()
        except Exception as e:
            print(f"{LogStyle.ERROR} Failed to log event to database: {repr(e)}")
            db.session.rollback()


    def get_xml_text(self, element, tag, namespace, default='N/A'):
        """Safely find text in XML element."""
        try:
            found = element.find(tag, namespace)
            return found.text if found is not None else default
        except Exception:
            return default

    def poll_nvr_status(self, nvr_ip, nvr_user, poll_results, current_db_state):
        """ Polls a single NVR and updates the poll_results dictionary. """
        now = get_tehran_time()
        API_ENDPOINT = f"http://{nvr_ip}/ISAPI/ContentMgmt/InputProxy/channels/status"
        summary = {"ip": nvr_ip, "total": 0, "online": 0, "status": "❓"}
        nvr_ip_short = nvr_ip.split('.')[-1]

        nvr_pass = self.nvr_shared_password

        try:
            response = requests.get(
                API_ENDPOINT,
                auth=HTTPDigestAuth(nvr_user, nvr_pass),
                timeout=10
            )

            if response.status_code != 200:
                error_code = response.status_code
                error_msg = f"HTTP {error_code} (Wrong Password?)"
                
                print(f"  {LogStyle.FAIL} NVR {nvr_ip_short} returned HTTP {error_code}.")
                # Log NVR error
                self.log_event("nvr_error", now, nvr_ip=nvr_ip, details=error_msg, severity='error')
                summary["status"] = "🚫"
                self.update_nvr_state_on_error(nvr_ip, "System Error", now, error_msg, poll_results, current_db_state)
                return summary

            # --- Success Path ---
            xml_root = ET.fromstring(response.content)
            namespace = {'ns': 'http://www.hikvision.com/ver20/XMLSchema'}
            
            for channel in xml_root.findall('ns:InputProxyChannelStatus', namespace):
                summary["total"] += 1

                channel_id = self.get_xml_text(channel, 'ns:id', namespace)
                online_status_text = self.get_xml_text(channel, 'ns:online', namespace)
                port_descriptor = channel.find('ns:sourceInputPortDescriptor', namespace)
                ip_address = self.get_xml_text(port_descriptor, 'ns:ipAddress', namespace) if port_descriptor is not None else "N/A"

                online = 'Online' if online_status_text == 'true' else 'Offline'
                key = f"{nvr_ip}-{channel_id}"
                camera_name = self.camera_ip_map.get(ip_address, f"Channel {channel_id}")

                if online == 'Online':
                    summary["online"] += 1
                    poll_results[key] = {
                        "status": "Online",
                        "last_online": now, # This is 'last_check' time, 'last_online' will be set in save_state_to_db
                        "down_check_count": 0,
                        "ip": ip_address,
                        "name": camera_name
                    }
                else:
                    prev_state = current_db_state.get(key, {})
                    prev_down_count = prev_state.get("down_check_count", 0)
                    new_down_count = prev_down_count + 1
                    
                    # Preserve the original 'last_online' time from the DB
                    original_last_online = prev_state.get("last_online", now)

                    poll_results[key] = {
                        "status": "Offline",
                        "last_online": original_last_online, # IMPORTANT: Preserve the time it went offline
                        "down_check_count": new_down_count,
                        "ip": ip_address,
                        "name": camera_name
                    }

                    if new_down_count == 1: # Only log the first time it goes down
                        self.log_event(
                            event_type="camera_down",
                            timestamp=now,
                            nvr_ip=nvr_ip,
                            camera_ip=ip_address,
                            camera_name=camera_name,
                            status="Offline",
                            details="Camera detected as Offline (1st check)", # UPDATED
                            severity='warning',
                            down_check_count=new_down_count
                        )
                        try:
                            print(f"  {LogStyle.CAMERA_OFFLINE} [{camera_name}] {ip_address} - {colored_text('OFFLINE', Colors.BRIGHT_RED)}")
                        except UnicodeEncodeError:
                            print(f"  {LogStyle.CAMERA_OFFLINE} {ip_address} - {colored_text('OFFLINE', Colors.BRIGHT_RED)}")
            
            summary["status"] = "✅" if summary["online"] == summary["total"] else "⚠️"
            
            if summary["total"] == 0:
                 self.update_nvr_state_on_error(nvr_ip, "System Error", now, "NVR OK but 0 channels reported", poll_results, current_db_state)


        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            error_msg = "Connection Failed" if isinstance(e, requests.exceptions.ConnectionError) else "Request Timed Out"
            self.log_event("nvr_error", now, nvr_ip=nvr_ip, details=error_msg, severity='error')
            print(f"  {LogStyle.FAIL} NVR {nvr_ip_short} {error_msg}.")
            summary["status"] = "⚠️"
            self.update_nvr_state_on_error(nvr_ip, "System Error", now, error_msg, poll_results, current_db_state)

        except Exception as e:
            error_str = repr(e)
            print(f"  {LogStyle.FAIL} NVR {nvr_ip_short} Error: {error_str}")
            summary["status"] = "⚠️"
            self.log_event("nvr_error", now, nvr_ip=nvr_ip, details=error_str, severity='error')
            self.update_nvr_state_on_error(nvr_ip, "System Error", now, error_str, poll_results, current_db_state)

        return summary

    def update_nvr_state_on_error(self, nvr_ip, new_status, timestamp, detail, poll_results, current_db_state):
        """
        Updates all cameras for a given NVR to an error status.
        If no cameras are known, adds a single NVR-level error state.
        """
        nvr_ips_in_config = {nvr['ip'] for nvr in self.nvr_configs}
        if nvr_ip not in nvr_ips_in_config:
            return

        # Find all keys for this NVR from the *database state*
        keys_to_update = [k for k in current_db_state if k.startswith(f"{nvr_ip}-")]
        
        if not keys_to_update:
            # No cameras known for this NVR, log a single NVR-level error
            key = f"{nvr_ip}-0" # Placeholder channel ID
            
            # Check if it was previously OK
            prev_state = current_db_state.get(key, {})
            prev_down_count = prev_state.get("down_check_count", 0)
            original_last_online = prev_state.get("last_online", timestamp)
            
            if prev_state.get("status") == "Online" or not prev_state:
                original_last_online = timestamp # It just failed
                
            poll_results[key] = {
                "status": new_status,
                "last_online": original_last_online,
                "down_check_count": prev_down_count + 1,
                "ip": "N/A",
                "name": f"NVR Error ({detail})"
            }
        else:
            # Cameras are known, update all of them
            for key in keys_to_update:
                prev_state = current_db_state.get(key, {})
                prev_down_count = prev_state.get("down_check_count", 0)
                new_down_count = prev_down_count + 1
                
                original_last_online = prev_state.get("last_online", timestamp)
                if prev_state.get("status") == "Online" or not prev_state:
                    original_last_online = timestamp # It just failed
                
                poll_results[key] = {
                    "status": new_status,
                    "last_online": original_last_online, # Preserve last_online
                    "down_check_count": new_down_count,
                    "ip": prev_state.get("ip", "N/A"),
                    "name": prev_state.get("name", "Unknown")
                }

    def display_status_summary(self, nvr_summaries):
        """Print status summary to console."""
        now = format_datetime(get_tehran_time())
        print(f"\n{LogStyle.CLOCK_ICON} {now} - Check #{self.check_count}")

        all_ok = True
        for summary in nvr_summaries:
            status_icon = summary["status"]
            nvr_ip_short = summary["ip"].split('.')[-1]
            online = summary["online"]
            total = summary["total"]

            if status_icon == "🚫":
                print(f"{LogStyle.SYSTEM_ERROR} NVR {nvr_ip_short} | {colored_text('System Error', Colors.BRIGHT_RED)}")
                all_ok = False
            elif status_icon == "⚠️":
                if total == 0:
                     # This now correctly means "NVR OK but 0 channels" or "Connection Failed"
                    print(f"{LogStyle.WARNING_ICON} NVR {nvr_ip_short} {colored_text('(Check Error)', Colors.YELLOW)}")
                else:
                    print(f"{LogStyle.WARNING_ICON} NVR {nvr_ip_short} {colored_text(f'({online}/{total})', Colors.YELLOW)}")
                all_ok = False
            else:
                print(f"{LogStyle.CAMERA_ONLINE} NVR {nvr_ip_short} {colored_text(f'({online}/{total})', Colors.GREEN)}")

        print(f"{Colors.CYAN}" + "-" * 20 + f"{Colors.RESET}")
        if all_ok:
            print(f"{LogStyle.CAMERA_ONLINE} ALL SYSTEMS OK")
        else:
            print(f"{LogStyle.WARNING_ICON} ALERTS DETECTED")
        print(f"{Colors.CYAN}" + "-" * 20 + f"{Colors.RESET}")

    def build_html_email(self, down_cameras, check_count):
        """
        Builds a clean HTML table email from the list of CameraState objects.
        """
        total_alerts = len(down_cameras)

        # Removed dir="rtl" to keep formatting consistent LTR
        html = f"""
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body {{
                    font-family: Arial, sans-serif;
                    font-size: 16px;
                    line-height: 1.6;
                }}
                table {{
                    border-collapse: collapse;
                    width: 100%;
                    margin-bottom: 20px;
                }}
                th, td {{
                    border: 1px solid #ddd;
                    padding: 12px;
                    text-align: left;
                }}
                th {{
                    background-color: #f2f2f2;
                    font-weight: bold;
                }}
                tr:nth-child(even) {{
                    background-color: #f9f9f9;
                }}
                .header {{
                    font-size: 24px;
                    font-weight: bold;
                    color: #dc3545;
                }}
                .status-offline {{
                    font-weight: bold;
                    color: #dc3545;
                }}
                .status-error {{
                    font-weight: bold;
                    color: #b30000;
                    background-color: #fdd;
                }}
                .status-muted {{
                    font-weight: bold;
                    color: #666;
                    background-color: #eee;
                }}
            </style>
        </head>
        <body>
            <div class="header">🚨 Camera Alert (Check #{check_count})</div>
            <p>Total {total_alerts} Camera/NVR are currently offline.</p>
        """

        html += "<h3>Offline List</h3>"
        html += "<table><tr><th>Camera Name / Error</th><th>NVR</th><th>IP</th><th>Status</th><th>Alerts Sent</th></tr>"
        
        for cam in down_cameras:
            status_text = ""
            status_class = "status-offline"
            alert_count_text = str(cam.alert_email_count)

            # Since 1 check = 1 min, down_check_count is the number of minutes
            downtime_minutes = cam.down_check_count
            time_formatted = format_downtime(downtime_minutes)

            if cam.status == 'Offline':
                if cam.is_muted:
                    status_text = f"Muted - Offline for {time_formatted}"
                    status_class = "status-muted"
                    alert_count_text = f"Muted (Sent: {cam.alert_email_count})"
                else:
                    status_text = f"Offline for {time_formatted}"
                    status_class = "status-offline"
            
            elif cam.status == 'System Error':
                status_text = f"System Error: {cam.camera_name}" # camera_name holds details
                status_class = "status-error"
                alert_count_text = f"Muted (Sent: {cam.alert_email_count})" if cam.is_muted else str(cam.alert_email_count)
            
            else: # Other unknown statuses
                status_text = f"{cam.status} - Offline for {time_formatted}"
                status_class = "status-error"
                alert_count_text = f"Muted (Sent: {cam.alert_email_count})" if cam.is_muted else str(cam.alert_email_count)


            html += f"""
            <tr>
                <td>{cam.camera_name if cam.status == 'Offline' else '<b>NVR ERROR</b>'}</td>
                <td>{cam.nvr_ip}</td>
                <td>{cam.camera_ip}</td>
                <td class="{status_class}">{status_text}</td>
                <td>{alert_count_text}</td>
            </tr>
            """
        html += "</table>"
        html += "</body></html>"
        return html

    def check_and_send_alerts(self):
        """
        New alert logic based on per-camera state and mute strategy.
        Sends a digest email containing all current active (non-muted) alerts.
        """
        with self.app.app_context():
            now = get_tehran_time()
            
            # 1. Get all cameras that are not 'Online'
            all_down_cameras = CameraState.query.filter(CameraState.status != 'Online').all()

            if not all_down_cameras:
                # Nothing is down, no email to send.
                return

            cameras_to_update_in_db = []
            send_email_now = False # Flag to send one digest email

            # 2. Iterate through all down cameras and apply alert/mute logic
            for cam in all_down_cameras:
                
                # Skip if already muted
                if cam.is_muted:
                    continue
                
                downtime_duration = now - cam.last_online
                
                # Condition 1: Initial Alert (alert_email_count = 0)
                # Check if it has been down long enough for the *first* alert
                is_initial_alert = cam.alert_email_count == 0 and downtime_duration >= self.first_alert_delay
                
                # Condition 2: Recurring Alert (alert_email_count > 0)
                # Check if it has been long enough since the *last* alert
                is_recurring_alert = False
                if cam.alert_email_count > 0 and cam.last_alert_time:
                    is_recurring_alert = (now - cam.last_alert_time) >= self.alert_frequency

                
                # If neither condition is met, do nothing for this camera
                if not is_initial_alert and not is_recurring_alert:
                    continue

                # --- This camera needs an alert. Decide if it's an alert or a mute ---
                
                # We set this flag to True, so *one* digest email will be sent
                send_email_now = True

                # Check if Mute Threshold is met (e.g., N=3, and count is already 3)
                if cam.alert_email_count >= self.mute_after_n_alerts:
                    cam.is_muted = True
                    cameras_to_update_in_db.append(cam)
                    
                    print(f"{LogStyle.INFO} [{cam.camera_name}] Mute threshold ({self.mute_after_n_alerts}) reached. Muting alerts.")
                    self.log_event(
                        event_type="camera_muted",
                        timestamp=now,
                        nvr_ip=cam.nvr_ip,
                        camera_ip=cam.camera_ip,
                        camera_name=cam.camera_name,
                        status=cam.status,
                        details=f"Alerts muted after {cam.alert_email_count} email(s) sent.",
                        severity='info'
                    )
                else:
                    # Not muting yet, just send a normal alert
                    cam.last_alert_time = now
                    cam.alert_email_count += 1
                    cameras_to_update_in_db.append(cam)

                    print(f"{LogStyle.WARNING_ICON} [{cam.camera_name}] Alert triggered (Count: {cam.alert_email_count}).")
                    self.log_event(
                        event_type="mail_alert_triggered",
                        timestamp=now,
                        nvr_ip=cam.nvr_ip,
                        camera_ip=cam.camera_ip,
                        camera_name=cam.camera_name,
                        status=cam.status,
                        details=f"Triggering Alert #{cam.alert_email_count} (Initial: {is_initial_alert})",
                        severity='warning',
                        down_check_count=cam.down_check_count
                    )
            
            # 3. Send Digest Email if needed
            if send_email_now:
                # We send the *full list* of down cameras (all_down_cameras) so the user
                # sees the complete picture, including newly muted and already-muted ones.
                total_alerts = len(all_down_cameras)
                subject = f"🚨 {total_alerts} Camera/NVR Alert(s) (Check #{self.check_count})"
                body = self.build_html_email(all_down_cameras, self.check_count)
                
                # Try to send the email
                sent_successfully = send_email(self.app, self.mail_recipients, subject, body)
                
                if sent_successfully:
                    # IMPORTANT: Only commit the state changes if the email was sent
                    db.session.commit()
                    
                    self.log_event(
                        event_type="mail_sent",
                        timestamp=now,
                        details=f"Digest email sent with {total_alerts} alert(s)",
                        severity='info',
                        mail_recipients=",".join(self.mail_recipients) if self.mail_recipients else None
                    )
                    print(f"{LogStyle.SUCCESS} Alert digest sent successfully.")
                    
                else:
                    # Log the failure, and DON'T commit.
                    # This will cause the logic to retry on the *next poll*
                    db.session.rollback() 
                    print(f"{LogStyle.ERROR} Failed to send email. State changes rolled back. Will retry.")
                    self.log_event(
                        event_type="mail_failed",
                        timestamp=now,
                        details="Failed to send alert digest email.",
                        severity='error',
                        mail_recipients=",".join(self.mail_recipients) if self.mail_recipients else None
                    )
            else:
                # No new alerts triggered this cycle, but commit any changes from save_state_to_db (like recoveries)
                db.session.commit()


    def stop(self):
        """Stops the monitoring loop."""
        print(f"{LogStyle.INFO} Stopping background monitor thread...")
        # Log the stop event
        try:
            self.log_event("service_stopped", get_tehran_time(), details="Background monitor thread stopped.", severity='info')
        except Exception as e:
            print(f"{LogStyle.ERROR} Failed to log stop event: {e}")
        self.running = False

    def run(self):
        """Main monitoring loop."""
        time.sleep(5) 
        
        print(f"{Colors.CYAN}" + "-" * 20 + f"{Colors.RESET}")
        if not self.load_config_from_app():
            return
        
        print(f"{Colors.CYAN}" + "-" * 20 + f"{Colors.RESET}")
        if not self.load_camera_names():
            return

        print(f"{Colors.CYAN}" + "-" * 20 + f"{Colors.RESET}")
        
        # Log the service start event
        try:
            self.log_event("service_started", get_tehran_time(), details="Background monitor thread started.", severity='info')
        except Exception as e:
             print(f"{LogStyle.ERROR} Failed to log start event: {e}")
             
        # Load the state from DB once at the start to get prev_state
        with self.app.app_context():
            db_states = CameraState.query.all()
            current_db_state = {
                f"{cam.nvr_ip}-{cam.channel_id}": {
                    "status": cam.status,
                    "last_online": cam.last_online,
                    "down_check_count": cam.down_check_count,
                    "ip": cam.camera_ip,
                    "name": cam.camera_name
                } for cam in db_states
            }

        print(f"\n{LogStyle.ROCKET_ICON} Background Monitor Started")
        print(f"   {colored_text('Check Interval:', Colors.CYAN)} {self.polling_interval}s (Hardcoded)")
        print(f"   {colored_text('First Alert Delay:', Colors.CYAN)} {self.first_alert_delay.total_seconds() / 60} min")
        print(f"   {colored_text('Alert Frequency:', Colors.CYAN)} {self.alert_frequency.total_seconds() / 60} min")
        print(f"   {colored_text('Mute After:', Colors.CYAN)} {self.mute_after_n_alerts} alerts")

        while self.running:
            self.check_count += 1
            nvr_summaries = []
            
            # This dict will be filled by the poll
            poll_results = {}

            # 1. Execute polling cycle
            configured_nvr_ips = []
            for nvr_config in self.nvr_configs:
                configured_nvr_ips.append(nvr_config["ip"])
                summary = self.poll_nvr_status(
                    nvr_config["ip"],
                    nvr_config["user"],
                    poll_results, # Pass dict to be filled
                    current_db_state # Pass read-only state
                )
                nvr_summaries.append(summary)

            # 2. Save poll results to database
            # This function now handles camera recovery (camera_up) logic
            with self.lock:
                self.current_state = poll_results # This line seems unused, but keeping for now
            
            self.save_state_to_db(configured_nvr_ips, poll_results)
            
            # Update current_db_state for the next iteration's poll_nvr_status
            current_db_state = {}
            with self.app.app_context():
                db_states = CameraState.query.all()
                current_db_state = {
                    f"{cam.nvr_ip}-{cam.channel_id}": {
                        "status": cam.status,
                        "last_online": cam.last_online,
                        "down_check_count": cam.down_check_count,
                        "ip": cam.camera_ip,
                        "name": cam.camera_name
                    } for cam in db_states
                }


            # 3. Check DB state and send alerts if needed
            # This function now handles all alert/mute/email logic
            self.check_and_send_alerts()

            # 4. Display summary in console
            if nvr_summaries:
                self.display_status_summary(nvr_summaries)

            print(f"{Colors.CYAN}Sleeping {self.polling_interval}s...{Colors.RESET}")
            print(f"{Colors.YELLOW}" + "-" * 35 + f"{Colors.RESET}")
            
            for _ in range(self.polling_interval):
                if not self.running:
                    break
                time.sleep(1)