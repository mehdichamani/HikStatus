"""
Run the Background Monitor
"""

import time
from app import create_app
from background_monitor import BackgroundMonitor

def run_monitor():
    """
    Create a Flask app and run the background monitor.
    """
    app = create_app()
    with app.app_context():
        monitor = BackgroundMonitor(app)
        monitor.start()
        
        try:
            while monitor.is_alive():
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nShutting down monitor...")
            monitor.stop()
            monitor.join()
            print("Monitor stopped.")

if __name__ == '__main__':
    run_monitor()