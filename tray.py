import threading
import sys
import webbrowser
import pystray
from PIL import Image, ImageDraw

def create_icon():
    img = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([4, 4, 60, 60], fill='#6366f1')
    draw.text((20, 14), 'HS', fill='white')
    return img

def start_server():
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=28888, log_level="warning")

def on_open(icon, item):
    webbrowser.open("http://localhost:28888")

def on_exit(icon, item):
    icon.stop()
    import os
    os._exit(0)

def main():
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    icon = pystray.Icon(
        "HikStatus",
        create_icon(),
        "HikStatus - در حال اجرا",
        menu=pystray.Menu(
            pystray.MenuItem("باز کردن مرورگر", on_open, default=True),
            pystray.MenuItem("خروج", on_exit)
        )
    )
    icon.run()

if __name__ == "__main__":
    main()
