# -*- coding: utf-8 -*-
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, StreamingResponse
from sqlmodel import Session, select
from urllib.parse import quote

from app.database import Camera, NVR, get_session, decrypt_password
from app.rate_limiter import max_connections
from app.services.hikvision_service import fetch_camera_snapshot, gen_frames_ffmpeg

router = APIRouter()

@router.get("", response_model=list[Camera])
def get_cameras(
    request: Request,
    response: Response,
    session: Session = Depends(get_session)
):
    import main
    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    try:
        user = auth_fn(request, response, session)
    except TypeError:
        user = auth_fn()

    accessible_groups = main.get_user_accessible_groups(user, session)
    if accessible_groups is None:
        return session.exec(select(Camera).order_by(Camera.nvr_ip, Camera.channel_id)).all()
    if not accessible_groups:
        return []
    nvrs = session.exec(select(NVR).where(NVR.group_id.in_(accessible_groups))).all()
    nvr_ips = [n.ip for n in nvrs]
    if not nvr_ips:
        return []
    return session.exec(select(Camera).where(Camera.nvr_ip.in_(nvr_ips)).order_by(Camera.nvr_ip, Camera.channel_id)).all()

@router.put("/{id}")
def update_cam(
    id: int,
    p: dict,
    request: Request,
    response: Response,
    session: Session = Depends(get_session)
):
    import main
    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    control_fn = main.app.dependency_overrides.get(main.require_control, main.require_control)
    try:
        user = auth_fn(request, response, session)
    except TypeError:
        user = auth_fn()

    try:
        user = control_fn(user)
    except TypeError:
        user = control_fn()

    c = session.get(Camera, id)
    if not c:
        raise HTTPException(status_code=404, detail="Camera not found")
    if user["role"] != "admin":
        accessible_groups = main.get_user_accessible_groups(user, session)
        nvr = session.get(NVR, c.nvr_ip)
        if not nvr or accessible_groups is None or nvr.group_id not in accessible_groups:
            raise HTTPException(status_code=403, detail="دسترسی غیرمجاز به این دوربین")
    if "importance" in p:
        importance = int(p["importance"])
        if importance not in (1, 2, 3):
            raise HTTPException(status_code=400, detail="Importance must be 1, 2, or 3")
        c.importance = importance
    if "latitude" in p:
        c.latitude = float(p["latitude"]) if p["latitude"] is not None else None
    if "longitude" in p:
        c.longitude = float(p["longitude"]) if p["longitude"] is not None else None
    if "x_pos" in p:
        c.x_pos = float(p["x_pos"]) if p["x_pos"] is not None else None
    if "y_pos" in p:
        c.y_pos = float(p["y_pos"]) if p["y_pos"] is not None else None
    if "plan_id" in p:
        c.plan_id = int(p["plan_id"]) if p["plan_id"] is not None else None
    if "fov_angle" in p:
        c.fov_angle = float(p["fov_angle"]) if p["fov_angle"] is not None else None
    if "fov_radius" in p:
        c.fov_radius = float(p["fov_radius"]) if p["fov_radius"] is not None else None
    if "fov_spread" in p:
        c.fov_spread = float(p["fov_spread"]) if p["fov_spread"] is not None else None
    session.add(c)
    session.commit()
    return c

@router.get("/{id}/snapshot")
async def get_camera_snapshot_route(
    id: int,
    request: Request,
    response: Response,
    session: Session = Depends(get_session)
):
    import main
    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    try:
        user = auth_fn(request, response, session)
    except TypeError:
        user = auth_fn()

    camera = session.get(Camera, id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    nvr = session.exec(select(NVR).where(NVR.ip == camera.nvr_ip)).first()
    if not nvr:
        raise HTTPException(status_code=404, detail="NVR not found")

    accessible_groups = main.get_user_accessible_groups(user, session)
    if accessible_groups is not None and nvr.group_id not in accessible_groups:
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز به این دوربین")

    try:
        content, mime_or_status = await fetch_camera_snapshot(nvr, camera)
        if content:
            return Response(content=content, media_type=mime_or_status)
        else:
            raise HTTPException(status_code=400, detail=f"NVR returned HTTP {mime_or_status}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch snapshot: {str(e)}")

@router.get("/{id}/live", response_class=HTMLResponse)
def get_camera_live_page(
    id: int,
    request: Request,
    response: Response,
    session: Session = Depends(get_session)
):
    import main
    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    try:
        user = auth_fn(request, response, session)
    except TypeError:
        user = auth_fn()

    camera = session.get(Camera, id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    nvr = session.exec(select(NVR).where(NVR.ip == camera.nvr_ip)).first()
    if not nvr:
        raise HTTPException(status_code=404, detail="NVR not found")

    accessible_groups = main.get_user_accessible_groups(user, session)
    if accessible_groups is not None and nvr.group_id not in accessible_groups:
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز")

    html_content = f"""
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>پخش زنده - {camera.name}</title>
        <style>
            body {{
                margin: 0;
                padding: 0;
                background-color: #0f172a;
                color: #f1f5f9;
                font-family: system-ui, -apple-system, sans-serif;
                display: flex;
                flex-direction: column;
                height: 100vh;
                overflow: hidden;
            }}
            .header {{
                background-color: #1e293b;
                padding: 12px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #334155;
            }}
            .title {{
                margin: 0;
                font-size: 16px;
                font-weight: 600;
            }}
            .info {{
                font-size: 13px;
                color: #94a3b8;
            }}
            .video-container {{
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                background: #020617;
            }}
            .video-frame {{
                max-width: 100%;
                max-height: 100%;
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
                border: 2px solid #334155;
                border-radius: 4px;
            }}
            .controls {{
                background-color: #1e293b;
                padding: 10px 20px;
                display: flex;
                gap: 10px;
                border-top: 1px solid #334155;
            }}
            .btn {{
                background-color: #3b82f6;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                transition: background-color 0.2s;
            }}
            .btn:hover {{
                background-color: #2563eb;
            }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1 class="title">پخش زنده: {camera.name}</h1>
            <span class="info">آدرس: {camera.ip} | ان‌وی‌آر: {camera.nvr_ip}</span>
        </div>
        <div class="video-container">
            <img class="video-frame" id="liveImg" src="/api/v1/cameras/{id}/stream" alt="Live Stream">
        </div>
        <div class="controls">
            <button class="btn" onclick="document.getElementById('liveImg').src='/api/v1/cameras/{id}/stream?' + new Date().getTime();">بروزرسانی اتصال</button>
            <button class="btn" onclick="window.close();">بستن صفحه</button>
        </div>
        <script>
            // مدیریت خودکار بازیابی تصویر در صورت قطعی موقت
            const img = document.getElementById('liveImg');
            img.onerror = function() {{
                setTimeout(() => {{
                    img.src = '/api/v1/cameras/{id}/stream?' + new Date().getTime();
                }}, 2000);
            }};
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@router.get("/{id}/stream")
@max_connections(3, key="global:stream")
async def stream_camera_route(
    id: int,
    request: Request,
    response: Response,
    session: Session = Depends(get_session)
):
    import main
    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    try:
        user = auth_fn(request, response, session)
    except TypeError:
        user = auth_fn()

    camera = session.get(Camera, id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    nvr = session.exec(select(NVR).where(NVR.ip == camera.nvr_ip)).first()
    if not nvr:
        raise HTTPException(status_code=404, detail="NVR not found")

    accessible_groups = main.get_user_accessible_groups(user, session)
    if accessible_groups is not None and nvr.group_id not in accessible_groups:
        raise HTTPException(status_code=403, detail="دسترسی غیرمجاز")

    decrypted_pass = decrypt_password(nvr.password)
    try:
        chan_int = int(camera.channel_id)
        rtsp_chan = str(chan_int * 100 + 1) if chan_int < 100 else camera.channel_id
    except ValueError:
        rtsp_chan = camera.channel_id

    nvr_host = nvr.ip
    if ":" in nvr_host:
        nvr_ip_only = nvr_host.split(":")[0]
    else:
        nvr_ip_only = nvr_host

    rtsp_port = nvr.rtsp_port if nvr.rtsp_port else 554
    rtsp_host = f"{nvr_ip_only}:{rtsp_port}"

    encoded_pass = quote(decrypted_pass, safe='')
    rtsp_url = f"rtsp://{nvr.user}:{encoded_pass}@{rtsp_host}/Streaming/Channels/{rtsp_chan}"

    return StreamingResponse(
        gen_frames_ffmpeg(rtsp_url),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@router.get("/off")
def get_off_cameras_endpoint_v1(
    request: Request,
    response: Response,
    session: Session = Depends(get_session)
):
    import main
    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    try:
        user = auth_fn(request, response, session)
    except TypeError:
        user = auth_fn()

    from app.services.camera_stats import get_off_cameras
    accessible_groups = main.get_user_accessible_groups(user, session)
    return get_off_cameras(session, accessible_groups)

@router.get("/changes")
def get_camera_changes_endpoint_v1(
    request: Request,
    response: Response,
    session: Session = Depends(get_session)
):
    import main
    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    try:
        user = auth_fn(request, response, session)
    except TypeError:
        user = auth_fn()

    from app.services.camera_stats import get_camera_changes
    accessible_groups = main.get_user_accessible_groups(user, session)
    return get_camera_changes(session, accessible_groups)
