"""
Minimal CCTV Monitor
- Polls NVRs
- Maintains state in 'monitor_state.json'
- Logs events to 'monitor.log'
- Sends emails via mailer.py
"""

import json
import csv
import os
import time
import logging
import requests
import pytz
# Added 'timezone' to imports
from datetime import datetime, timedelta, timezone
from requests.auth import HTTPDigestAuth
import xml.etree.ElementTree as ET

# Import local helpers
from colors import Colors, LogStyle, colored_text
from mailer import send_email

# Constants
CONFIG_FILE = 'config.json'
STATE_FILE = 'monitor_state.json'
LOG_FILE = 'monitor.log'

# Setup File Logging
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# --- Time Utils Inlined ---
def get_tehran_time():
    """Returns the current time in Tehran timezone."""
    # FIXED: Use timezone-aware UTC object to avoid DeprecationWarning
    utc_now = datetime.now(timezone.utc)
    tehran_tz = pytz.timezone('Asia/Tehran')
    return utc_now.astimezone(tehran_tz)

def format_datetime(dt_obj):
    """Formats a datetime object to 'yyyy/mm/dd HH:MM'."""
    if dt_obj is None:
        return ""
    return dt_obj.strftime('%Y/%m/%d %H:%M')
# ---------------------------

def log_event(level, message):
    if level == 'error':
        logging.error(message)
    elif level == 'warning':
        logging.warning(message)
    else:
        logging.info(message)

def format_downtime(minutes):
    if minutes < 0: minutes = 0
    days = minutes // 1440
    hours = (minutes % 1440) // 60
    mins = minutes % 60
    if days > 0:
        return f"{days}d {hours:02d}:{mins:02d}"
    return f"{hours:02d}:{mins:02d}"

class Monitor:
    def __init__(self):
        self.config = self.load_config()
        self.camera_names = self.load_camera_names()
        self.state = self.load_state()
        self.check_count = 0
        
        # Config values
        self.polling_interval = 60
        self.first_alert_delay = timedelta(minutes=self.config.get("FIRST_ALERT_DELAY_MINUTES", 15))
        self.alert_frequency = timedelta(minutes=self.config.get("ALERT_FREQUENCY_MINUTES", 60))
        self.mute_threshold = int(self.config.get("MUTE_AFTER_N_ALERTS", 3))
        self.recipients = self.config.get("MAIL_RECIPIENTS", [])

    def load_config(self):
        if not os.path.exists(CONFIG_FILE):
            print(f"{LogStyle.FATAL_ERROR} Config file {CONFIG_FILE} not found.")
            exit(1)
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)

    def load_camera_names(self):
        mapping = {}
        fname = self.config.get("CAMERA_NAME_FILE", "camera_names.csv")
        if os.path.exists(fname):
            with open(fname, 'r', newline='') as f:
                reader = csv.reader(f)
                next(reader, None)
                for row in reader:
                    if len(row) >= 2 and row[0].strip():
                        mapping[row[0].strip()] = row[1].strip()
        return mapping

    def load_state(self):
        if os.path.exists(STATE_FILE):
            try:
                with open(STATE_FILE, 'r') as f:
                    data = json.load(f)
                    for key, cam in data.items():
                        if cam.get('last_online'):
                            cam['last_online'] = datetime.fromisoformat(cam['last_online'])
                        if cam.get('last_alert_time'):
                            cam['last_alert_time'] = datetime.fromisoformat(cam['last_alert_time'])
                    return data
            except Exception as e:
                print(f"{LogStyle.ERROR} Failed to load state: {e}")
        return {}

    def save_state(self):
        serializable_data = {}
        for key, cam in self.state.items():
            entry = cam.copy()
            if isinstance(entry.get('last_online'), datetime):
                entry['last_online'] = entry['last_online'].isoformat()
            if isinstance(entry.get('last_alert_time'), datetime):
                entry['last_alert_time'] = entry['last_alert_time'].isoformat()
            serializable_data[key] = entry
            
        with open(STATE_FILE, 'w') as f:
            json.dump(serializable_data, f, indent=2)

    def get_camera_name(self, ip, channel_id):
        return self.camera_names.get(ip, f"Channel {channel_id}")

    def poll_nvr(self, nvr_config):
        ip = nvr_config['ip']
        user = nvr_config['user']
        password = self.config.get('NVR_SHARED_PASSWORD')
        
        url = f"http://{ip}/ISAPI/ContentMgmt/InputProxy/channels/status"
        now = get_tehran_time()
        
        summary = {'ip': ip, 'total': 0, 'online': 0, 'status': '❓'}
        
        try:
            resp = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=10)
            if resp.status_code != 200:
                print(f"   {LogStyle.FAIL} NVR {ip} HTTP {resp.status_code}")
                summary['status'] = '🚫'
                log_event('error', f"NVR {ip} returned HTTP {resp.status_code}")
                return summary

            root = ET.fromstring(resp.content)
            namespace = {'ns': 'http://www.hikvision.com/ver20/XMLSchema'}
            
            for channel in root.findall('ns:InputProxyChannelStatus', namespace):
                summary['total'] += 1
                chan_id = channel.find('ns:id', namespace).text
                online = channel.find('ns:online', namespace).text == 'true'
                
                port_node = channel.find('ns:sourceInputPortDescriptor', namespace)
                cam_ip = port_node.find('ns:ipAddress', namespace).text if port_node is not None else "N/A"
                
                key = f"{ip}-{chan_id}"
                cam_name = self.get_camera_name(cam_ip, chan_id)

                if key not in self.state:
                    self.state[key] = {
                        'nvr_ip': ip, 'channel_id': chan_id, 'ip': cam_ip, 'name': cam_name,
                        'status': 'Unknown', 'last_online': now, 'alert_count': 0, 
                        'is_muted': False, 'last_alert_time': None
                    }

                cam_state = self.state[key]
                cam_state['ip'] = cam_ip
                cam_state['name'] = cam_name

                if online:
                    summary['online'] += 1
                    if cam_state['status'] != 'Online':
                        downtime = now - cam_state['last_online']
                        mins = int(downtime.total_seconds() / 60)
                        msg = f"[{cam_name}] Back online. Downtime: {format_downtime(mins)}"
                        print(f"{LogStyle.SUCCESS} {msg}")
                        log_event('info', msg)
                        
                        cam_state['status'] = 'Online'
                        cam_state['last_online'] = now
                        cam_state['alert_count'] = 0
                        cam_state['is_muted'] = False
                        cam_state['last_alert_time'] = None
                    else:
                        cam_state['last_online'] = now
                else:
                    if cam_state['status'] == 'Online':
                        print(f"   {LogStyle.CAMERA_OFFLINE} [{cam_name}] {cam_ip} - OFFLINE")
                        log_event('warning', f"[{cam_name}] Went OFFLINE")
                        cam_state['status'] = 'Offline'
                    
            summary['status'] = '✅' if summary['online'] == summary['total'] else '⚠️'

        except Exception as e:
            print(f"   {LogStyle.FAIL} NVR {ip} Error: {e}")
            log_event('error', f"NVR {ip} Exception: {e}")
            summary['status'] = '🚫'
        
        return summary

    def process_alerts(self):
        now = get_tehran_time()
        alerts_to_send = []

        for key, cam in self.state.items():
            if cam['status'] != 'Online' and not cam['is_muted']:
                downtime = now - cam['last_online']
                if cam['alert_count'] == 0:
                    if downtime >= self.first_alert_delay:
                        alerts_to_send.append(cam)
                elif cam['last_alert_time']:
                    time_since_last = now - cam['last_alert_time']
                    if time_since_last >= self.alert_frequency:
                        alerts_to_send.append(cam)

        if alerts_to_send:
            self.send_alert_email(alerts_to_send, now)

    def build_email_body(self, cameras):
        html = "<h3>⚠️ CCTV Offline Alert</h3><table border='1' cellpadding='5' style='border-collapse:collapse;'>"
        html += "<tr><th>Name</th><th>IP</th><th>Downtime</th><th>Alert #</th></tr>"
        for cam in cameras:
            downtime = get_tehran_time() - cam['last_online']
            mins = int(downtime.total_seconds() / 60)
            html += f"<tr><td>{cam['name']}</td><td>{cam['ip']}</td><td>{format_downtime(mins)}</td><td>{cam['alert_count'] + 1}</td></tr>"
        html += "</table>"
        return html

    def send_alert_email(self, cameras, now):
        subject = f"🚨 {len(cameras)} Camera(s) Offline - Check #{self.check_count}"
        body = self.build_email_body(cameras)
        
        print(f"{LogStyle.WARNING_ICON} Sending alert for {len(cameras)} cameras...")
        
        if send_email(self.config, self.recipients, subject, body):
            log_event('info', f"Sent email for {len(cameras)} cameras.")
            for cam_data in cameras:
                cam_data['alert_count'] += 1
                cam_data['last_alert_time'] = now
                if cam_data['alert_count'] >= self.mute_threshold:
                    cam_data['is_muted'] = True
                    log_event('info', f"Muting alerts for {cam_data['name']}")
        else:
            log_event('error', "Failed to send alert email.")

    def run(self):
        print(f"{Colors.CYAN}" + "="*40)
        print(f"   Minimal CCTV Monitor Started")
        print(f"   Logging to: {LOG_FILE}")
        print(f"   Press Ctrl+C to Stop Safely")
        print(f"{Colors.CYAN}" + "="*40 + f"{Colors.RESET}")
        
        while True:
            try:
                self.check_count += 1
                print(f"{LogStyle.CLOCK_ICON} {format_datetime(get_tehran_time())} - Check #{self.check_count}{Colors.RESET}")
                
                nvrs = self.config.get("NVR_LIST_CONFIG", [])
                for nvr in nvrs:
                    summary = self.poll_nvr(nvr)
                    status_color = Colors.GREEN if summary['status'] == '✅' else Colors.RED
                    print(f"   {summary['status']} NVR {summary['ip']} - {colored_text(f'{summary['online']}/{summary['total']}', status_color)}")

                self.process_alerts()
                self.save_state()
                
                print("=" * 40)
                
                time.sleep(self.polling_interval)

            except KeyboardInterrupt:
                # Capture Ctrl+C
                print(f"\n{Colors.YELLOW}⚠️  Do you want to stop monitoring? (y/n): {Colors.RESET}", end="", flush=True)
                try:
                    choice = input().strip().lower()
                    if choice == 'y':
                        print(f"{LogStyle.INFO} Goodbye!")
                        break
                    else:
                        print(f"{LogStyle.INFO} Resuming...")
                except KeyboardInterrupt:
                    print("\nForcing Exit...")
                    break

if __name__ == "__main__":
    Monitor().run()