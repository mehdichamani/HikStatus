# -*- coding: utf-8 -*-
import asyncio
import requests
from requests.auth import HTTPDigestAuth
import subprocess
import signal
import os
from app.database import decrypt_password

async def fetch_camera_snapshot(nvr, camera) -> tuple:
    """
    دریافت عکس فریم فعلی دوربین از طریق وب‌سرویس هایک‌ویژن
    """
    try:
        chan_int = int(camera.channel_id)
        track_id = str(chan_int * 100 + 1) if chan_int < 100 else camera.channel_id
    except ValueError:
        track_id = camera.channel_id

    url = f"http://{nvr.ip}/ISAPI/Streaming/channels/{track_id}/picture"

    def fetch_pic():
        req_sess = requests.Session()
        req_sess.trust_env = False
        decrypted_pass = decrypt_password(nvr.password)
        resp = req_sess.get(url, auth=HTTPDigestAuth(nvr.user, decrypted_pass), timeout=5, proxies={})
        if resp.status_code == 200:
            return resp.content, resp.headers.get("Content-Type", "image/jpeg")
        return None, resp.status_code

    return await asyncio.to_thread(fetch_pic)


def gen_frames_ffmpeg(rtsp_url):
    """
    تولید فریم‌های جریان زنده و ترنسکد با ffmpeg به تصاویر متحرک JPEG
    """
    cmd = [
        "ffmpeg",
        "-rtsp_transport", "tcp",
        "-i", rtsp_url,
        "-f", "mpjpeg",
        "-q", "4",
        "-an",
        "-vf", "scale=640:-1",
        "-r", "5",
        "pipe:1"
    ]

    popen_kwargs = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.DEVNULL
    }
    if hasattr(os, "setsid"):
        popen_kwargs["preexec_fn"] = os.setsid
    elif hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

    process = subprocess.Popen(cmd, **popen_kwargs)
    try:
        while True:
            # خواندن فریم‌ها به صورت بلاک‌بلاک از خروجی استاندارد ffmpeg
            data = process.stdout.read(4096)
            if not data:
                break
            yield data
    except Exception:
        pass
    finally:
        try:
            if hasattr(os, "killpg") and hasattr(os, "getpgid"):
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            else:
                process.terminate()
        except Exception:
            pass
