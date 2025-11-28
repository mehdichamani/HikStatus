"""
Manages the background monitor thread for the CCTV Mailer application.
Handles starting, stopping, and restarting the thread in a safe manner.
"""
import threading
from background_monitor import BackgroundMonitor

monitor_thread = None
monitor_lock = threading.Lock()

def start_monitor_thread(app):
    """Stops any existing monitor and starts a new one."""
    global monitor_thread
    with monitor_lock:
        if monitor_thread and monitor_thread.is_alive():
            print("Stopping existing monitor thread...")
            monitor_thread.stop()
            monitor_thread.join(timeout=10) # Wait for thread to finish
            if monitor_thread.is_alive():
                print("Warning: Monitor thread did not stop in time.")

        with app.app_context():
            print("Starting new monitor thread...")
            monitor_thread = BackgroundMonitor(app)
            monitor_thread.start()
            print("Background monitor thread started/restarted.")
