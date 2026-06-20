import subprocess
import sys
import os
import threading
from pathlib import Path

try:
    import pystray
    from PIL import Image, ImageDraw
except ImportError:
    print("Error: pystray and Pillow are required.")
    print("Please install them with: pip install pystray pillow")
    sys.exit(1)

# Get the directory where this script is located
SCRIPT_DIR = Path(__file__).parent.resolve()

# Server process
process = None


def create_icon():
    """Create a simple tray icon"""
    size = (64, 64)
    image = Image.new("RGBA", size, (99, 102, 241, 255))
    draw = ImageDraw.Draw(image)
    draw.ellipse((8, 8, 56, 56), fill=(99, 102, 241, 255))
    draw.ellipse((18, 18, 46, 46), fill=(255, 255, 255, 255))
    draw.ellipse((24, 24, 40, 40), fill=(99, 102, 241, 255))
    return image


def start_server():
    """Start the Uvicorn server"""
    global process
    os.chdir(SCRIPT_DIR)
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "28888"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    
    # Read output to prevent buffer deadlock
    if process.stdout:
        for line in process.stdout:
            print(line.strip())


def stop_server():
    """Stop the Uvicorn server"""
    global process
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    return True


def on_open(icon, item):
    """Open the web UI in browser"""
    import webbrowser
    webbrowser.open("http://localhost:28888")


def on_stop(icon, item):
    """Stop the server and exit"""
    stop_server()
    icon.stop()


def on_exit(icon, item):
    """Exit the tray icon"""
    icon.stop()


def on_status(icon, item):
    """Show server status"""
    if process and process.poll() is None:
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0,
            "HikStatus is running on port 28888",
            "HikStatus Status",
            0x40
        )
    else:
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0,
            "HikStatus is not running",
            "HikStatus Status",
            0x30
        )


def main():
    # Start server in background thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # Give server time to start
    import time
    time.sleep(2)
    
    # Create tray icon
    icon = pystray.Icon(
        "HikStatus",
        create_icon(),
        "HikStatus - Right click for options",
        pystray.Menu(
            pystray.MenuItem("Open Web UI", on_open),
            pystray.MenuItem("Status", on_status),
            pystray.MenuItem("Stop Server", on_stop),
            pystray.MenuItem("Exit", on_exit)
        )
    )
    
    icon.run()
    
    # Clean up when tray exits
    stop_server()


if __name__ == "__main__":
    main()