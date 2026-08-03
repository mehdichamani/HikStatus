from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, StreamingResponse
from sqlmodel import Session, select

from app.database import NVR, Camera, decrypt_password, get_session
from app.rate_limiter import max_connections
from app.services.hikvision_service import fetch_camera_snapshot, gen_frames_ffmpeg

router = APIRouter()


@router.get("", response_model=list[Camera])
def get_cameras(
    request: Request, response: Response, session: Session = Depends(get_session)
):
    import main

    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    try:
        user = auth_fn(request, response, session)
    except TypeError:
        user = auth_fn()

    accessible_groups = main.get_user_accessible_groups(user, session)
    if accessible_groups is None:
        return session.exec(
            select(Camera).order_by(Camera.nvr_ip, Camera.channel_id)
        ).all()
    if not accessible_groups:
        return []
    nvrs = session.exec(select(NVR).where(NVR.group_id.in_(accessible_groups))).all()
    nvr_ips = [n.ip for n in nvrs]
    if not nvr_ips:
        return []
    return session.exec(
        select(Camera)
        .where(Camera.nvr_ip.in_(nvr_ips))
        .order_by(Camera.nvr_ip, Camera.channel_id)
    ).all()


@router.put("/{id}")
def update_cam(
    id: int,
    p: dict,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
):
    import main

    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    control_fn = main.app.dependency_overrides.get(
        main.require_control, main.require_control
    )
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
        if (
            not nvr
            or accessible_groups is None
            or nvr.group_id not in accessible_groups
        ):
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
    session: Session = Depends(get_session),
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
            raise HTTPException(
                status_code=400, detail=f"NVR returned HTTP {mime_or_status}"
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch snapshot: {e!s}")


@router.get("/{id}/live", response_class=HTMLResponse)
def get_camera_live_page(
    id: int,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
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

    from app.database import NVRGroup

    group_name = "تعریف نشده"
    if nvr.group_id:
        group = session.get(NVRGroup, nvr.group_id)
        if group:
            group_name = group.name

    html_content = f"""
    <!DOCTYPE html>
    <html lang="fa" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>پخش زنده - {camera.name}</title>
        <link rel="stylesheet" href="/static/style.css">
        <style>
            body {{
                margin: 0;
                padding: 0;
                background-color: var(--bg);
                color: var(--text);
                font-family: 'Vazirmatn', system-ui, -apple-system, sans-serif;
                display: flex;
                flex-direction: column;
                height: 100vh;
                overflow: hidden;
            }}
            .live-header {{
                background-color: var(--surface);
                padding: 12px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid var(--border);
            }}
            .live-title {{
                margin: 0;
                font-size: 16px;
                font-weight: 700;
                color: var(--text);
            }}
            .live-info {{
                font-size: 13px;
                color: var(--text-secondary);
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
                box-shadow: var(--shadow);
                border: 2px solid var(--border);
                border-radius: var(--radius-sm);
                display: none;
            }}
            .overlay-container {{
                position: absolute;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 15px;
                text-align: center;
                padding: 20px;
                z-index: 10;
            }}
            .spinner {{
                width: 50px;
                height: 50px;
                border: 4px solid rgba(99, 102, 241, 0.1);
                border-left-color: var(--primary);
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }}
            .error-box {{
                display: none;
                background-color: var(--danger-bg);
                border: 1px solid rgba(239, 68, 68, 0.2);
                border-radius: var(--radius-sm);
                padding: 20px;
                max-width: 400px;
            }}
            .error-icon {{
                font-size: 40px;
                color: var(--danger);
                margin-bottom: 10px;
            }}
            .error-title {{
                font-weight: bold;
                color: var(--danger);
                margin-bottom: 8px;
            }}
            .error-message {{
                font-size: 14px;
                color: var(--text-secondary);
                line-height: 1.6;
            }}
            @keyframes spin {{
                0% {{ transform: rotate(0deg); }}
                100% {{ transform: rotate(360deg); }}
            }}
            .live-controls {{
                background-color: var(--surface);
                padding: 12px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-top: 1px solid var(--border);
            }}
            .control-group {{
                display: flex;
                gap: 10px;
                align-items: center;
            }}
            .btn-quality {{
                background-color: var(--surface-2);
                color: var(--text-secondary);
                border: 1px solid var(--border);
                padding: 6px 14px;
                border-radius: 20px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
                transition: var(--transition);
            }}
            .btn-quality.active {{
                background-color: var(--primary);
                color: white;
                border-color: var(--primary);
                box-shadow: 0 0 10px var(--primary-glow);
            }}
        </style>
    </head>
    <body>
        <div class="live-header">
            <h1 class="live-title">پخش زنده</h1>
            <span class="live-info">کارخانه: {group_name} | دستگاه: {nvr.name} | دوربین: {camera.name}</span>
        </div>
        <div class="video-container">
            <div class="overlay-container" id="overlay">
                <div class="spinner" id="spinner"></div>
                <div id="statusText">در حال برقراری ارتباط با دوربین و آماده‌سازی جریان ویدیو...</div>
                
                <div class="error-box" id="errorBox">
                    <div class="error-icon">⚠️</div>
                    <div class="error-title" id="errorTitle">خطا در پخش زنده</div>
                    <div class="error-message" id="errorMessage">اتصال به دوربین برقرار نشد.</div>
                </div>
            </div>
            <img class="video-frame" id="liveImg" alt="Live Stream">
        </div>
        <div class="live-controls">
            <div class="control-group">
                <span style="font-size: 12px; color: var(--text-secondary); margin-left: 8px;">کیفیت پخش:</span>
                <button class="btn-quality active" id="btnSub" onclick="setQuality('sub')">کیفیت معمولی (Sub)</button>
                <button class="btn-quality" id="btnMain" onclick="setQuality('main')">کیفیت بالا (Main)</button>
            </div>
            <div class="control-group">
                <button class="btn" onclick="retryStream();">بروزرسانی اتصال</button>
                <button class="btn btn-secondary" onclick="window.close();">بستن صفحه</button>
            </div>
        </div>
        <script>
            // ارث‌بری تم از سامانه
            const savedTheme = localStorage.getItem('theme') || (window.opener ? window.opener.localStorage.getItem('theme') : 'dark');
            document.documentElement.setAttribute('data-theme', savedTheme);

            const img = document.getElementById('liveImg');
            const overlay = document.getElementById('overlay');
            const spinner = document.getElementById('spinner');
            const statusText = document.getElementById('statusText');
            const errorBox = document.getElementById('errorBox');
            const errorMessage = document.getElementById('errorMessage');
            const errorTitle = document.getElementById('errorTitle');
            const btnSub = document.getElementById('btnSub');
            const btnMain = document.getElementById('btnMain');

            const baseStreamUrl = '/api/v1/cameras/{id}/stream';
            let currentQuality = 'sub';

            function setQuality(q) {{
                if (currentQuality === q) return;
                currentQuality = q;
                if (q === 'sub') {{
                    btnSub.classList.add('active');
                    btnMain.classList.remove('active');
                }} else {{
                    btnMain.classList.add('active');
                    btnSub.classList.remove('active');
                }}
                startStream();
            }}

            function startStream() {{
                overlay.style.display = 'flex';
                spinner.style.display = 'block';
                statusText.style.display = 'block';
                statusText.innerText = 'در حال برقراری ارتباط با دوربین و آماده‌سازی جریان ویدیو...';
                errorBox.style.display = 'none';
                img.style.display = 'none';
                
                // ارسال کوئری پارامتر کیفیت استریم به وب‌سرویس
                img.src = baseStreamUrl + '?stream_type=' + currentQuality + '&t=' + new Date().getTime();
            }}

            img.onload = function() {{
                overlay.style.display = 'none';
                img.style.display = 'block';
            }};

            img.onerror = async function() {{
                img.style.display = 'none';
                spinner.style.display = 'none';
                statusText.style.display = 'none';
                errorBox.style.display = 'block';
                
                try {{
                    const testUrl = baseStreamUrl + '?stream_type=' + currentQuality;
                    const response = await fetch(testUrl);
                    if (!response.ok) {{
                        const data = await response.json().catch(() => ({{}}));
                        const detail = data.detail || '';
                        
                        if (response.status === 429) {{
                            errorTitle.innerText = 'محدودیت ترافیک همزمان (ترافیک فشرده)';
                            errorMessage.innerText = 'تعداد اتصالات همزمان به پخش زنده بیش از حد مجاز است. حداکثر ۳ اتصال فعال به صورت سراسری مجاز است. لطفاً چند لحظه بعد مجدداً تلاش کنید.';
                        }} else if (response.status === 403) {{
                            errorTitle.innerText = 'عدم دسترسی';
                            errorMessage.innerText = 'شما دسترسی لازم برای مشاهده پخش زنده این دوربین را ندارید.';
                        }} else if (response.status === 404) {{
                            errorTitle.innerText = 'پیدا نشد';
                            errorMessage.innerText = 'دوربین یا دستگاه ذخیره‌ساز (NVR) مربوطه یافت نشد.';
                        }} else {{
                            errorTitle.innerText = 'خطای ارتباطی سرور';
                            errorMessage.innerText = detail || 'سرور قادر به برقراری ارتباط با جریان RTSP دوربین نیست. لطفاً سلامت کابل‌ها و تنظیمات شبکه دوربین را بررسی کنید.';
                        }}
                    }} else {{
                        errorTitle.innerText = 'خطای بارگذاری تصویر';
                        errorMessage.innerText = 'اتصال برقرار است اما فریم‌های تصویر رندر نمی‌شوند. لطفاً مجدداً تلاش کنید.';
                    }}
                }} catch (e) {{
                    errorTitle.innerText = 'خطای شبکه یا قطعی سرور';
                    errorMessage.innerText = 'امکان برقراری ارتباط با سرور مانیتورینگ وجود ندارد. لطفاً اتصال اینترنت خود را بررسی کنید.';
                }}
            }};

            function retryStream() {{
                startStream();
            }}

            startStream();
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
    stream_type: str = "sub",
    session: Session = Depends(get_session),
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
        # پیش‌فرض sub استریم با پایان 2 است و main استریم با 1
        stream_suffix = 2 if stream_type == "sub" else 1
        rtsp_chan = (
            str(chan_int * 100 + stream_suffix) if chan_int < 100 else camera.channel_id
        )
    except ValueError:
        rtsp_chan = camera.channel_id

    nvr_host = nvr.ip
    if ":" in nvr_host:
        nvr_ip_only = nvr_host.split(":")[0]
    else:
        nvr_ip_only = nvr_host

    rtsp_port = nvr.rtsp_port if nvr.rtsp_port else 554
    rtsp_host = f"{nvr_ip_only}:{rtsp_port}"

    encoded_pass = quote(decrypted_pass, safe="")
    rtsp_url = (
        f"rtsp://{nvr.user}:{encoded_pass}@{rtsp_host}/Streaming/Channels/{rtsp_chan}"
    )

    scale_w = 640 if stream_type == "sub" else 1280
    fps_val = 5 if stream_type == "sub" else 12

    return StreamingResponse(
        gen_frames_ffmpeg(rtsp_url, scale_width=scale_w, fps=fps_val),
        media_type="multipart/x-mixed-replace; boundary=ffmpeg",
    )


@router.get("/off")
def get_off_cameras_endpoint_v1(
    request: Request, response: Response, session: Session = Depends(get_session)
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
    request: Request, response: Response, session: Session = Depends(get_session)
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
