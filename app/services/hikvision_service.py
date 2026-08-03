import asyncio
import os
import subprocess

import requests
from requests.auth import HTTPDigestAuth

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
        resp = req_sess.get(
            url, auth=HTTPDigestAuth(nvr.user, decrypted_pass), timeout=5, proxies={}
        )
        if resp.status_code == 200:
            return resp.content, resp.headers.get("Content-Type", "image/jpeg")
        return None, resp.status_code

    return await asyncio.to_thread(fetch_pic)


async def gen_frames_ffmpeg(rtsp_url, scale_width=640, fps=5):
    """
    تولید فریم‌های جریان زنده و ترنسکد با ffmpeg به صورت ناهمگام
    """
    # اگر عرض تصویر صفر یا خالی باشد، scale اعمال نمی‌شود تا تصویر اصلی فرستاده شود
    vf_chain = f"scale={scale_width}:-1" if scale_width else "null"
    cmd = [
        "ffmpeg",
        "-rtsp_transport",
        "tcp",
        "-i",
        rtsp_url,
        "-f",
        "mpjpeg",
        "-q",
        "4",
        "-an",
        "-vf",
        vf_chain,
        "-r",
        str(fps),
        "pipe:1",
    ]

    creationflags = 0
    if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP") and os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        creationflags=creationflags,
    )

    try:
        while True:
            # خواندن فریم‌ها به صورت ناهمگام
            data = await process.stdout.read(4096)
            if not data:
                break
            yield data
    except (asyncio.CancelledError, GeneratorExit):
        pass
    finally:
        try:
            process.terminate()
            await process.wait()
        except Exception:
            pass
