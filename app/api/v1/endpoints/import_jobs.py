from __future__ import annotations

import asyncio
import uuid
from datetime import datetime

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Request,
    Response,
)
from sqlmodel import Session, select

from app.database import (
    NVR,
    NVRGroup,
    ScheduledTask,
    Settings,
    encrypt_password,
    get_session,
)
from app.logging_config import log_event, logger
from app.services.monitor import (
    task_sync_nvr_configs,
    task_sync_nvr_health,
    task_sync_nvr_stats,
)

router = APIRouter()

# حافظه موقت نگهداری وضعیت پردازش‌های ایمپورت
_import_jobs: dict[str, dict] = {}


def _cleanup_old_jobs():
    """پاکسازی جاب‌های قدیمی‌تر از ۱ ساعت از حافظه"""
    now = datetime.now()
    expired = [
        jid
        for jid, job in _import_jobs.items()
        if (now - job.get("created_at", now)).total_seconds() > 3600
    ]
    for jid in expired:
        _import_jobs.pop(jid, None)


async def _run_analysis(job_id: str):
    """اجرای ناهمگام تحلیل مقایسه‌ای داده‌های فایل JSON با پایگاه داده"""
    try:
        job = _import_jobs.get(job_id)
        if not job:
            return

        job["status"] = "processing"
        job["progress"] = 20
        job["message"] = "در حال بارگذاری و بررسی ساختار داده‌ها..."
        await asyncio.sleep(0.2)

        payload = job["payload"]
        json_nvrs = payload.get("nvrs", [])
        json_settings = payload.get("settings", {})
        json_groups = payload.get("groups", [])
        json_plans = payload.get("plans", [])
        json_users = payload.get("users", [])
        json_tasks = payload.get("tasks", [])

        # اگر فقط یک آرایه از NVRها مستقیماً ارسال شده باشد
        if isinstance(payload, list):
            json_nvrs = payload
            json_settings = {}
            json_groups = []
            json_plans = []
            json_users = []
            json_tasks = []

        job["progress"] = 45
        job["message"] = "در حال تطبیق دستگاه‌های NVR با پایگاه داده..."
        await asyncio.sleep(0.2)

        from app import database

        with Session(database.engine) as session:
            db_nvrs = {n.ip: n for n in session.exec(select(NVR)).all()}
            db_groups = {g.name: g for g in session.exec(select(NVRGroup)).all()}

            new_nvrs = []
            relinked_nvrs = []
            modified_nvrs = []
            unchanged_nvrs = []

            for n_item in json_nvrs:
                ip = n_item.get("ip")
                if not ip:
                    continue
                if ip not in db_nvrs:
                    new_nvrs.append({"ip": ip, "name": n_item.get("name") or ip})
                else:
                    existing = db_nvrs[ip]
                    if existing.unlinked_at is not None:
                        relinked_nvrs.append(
                            {"ip": ip, "name": n_item.get("name") or ip}
                        )
                    else:
                        # بررسی تغییرات
                        has_changes = False
                        if n_item.get("name") and n_item.get("name") != existing.name:
                            has_changes = True
                        if n_item.get("user") and n_item.get("user") != existing.user:
                            has_changes = True
                        if (
                            n_item.get("rtsp_port")
                            and int(n_item.get("rtsp_port")) != existing.rtsp_port
                        ):
                            has_changes = True
                        if n_item.get("group_id") != existing.group_id:
                            has_changes = True
                        if n_item.get("password"):
                            has_changes = True

                        if has_changes:
                            modified_nvrs.append(
                                {"ip": ip, "name": n_item.get("name") or ip}
                            )
                        else:
                            unchanged_nvrs.append(
                                {"ip": ip, "name": existing.name or ip}
                            )

            # دستگاه‌های موجود در دیتابیس که در فایل JSON نیستند
            json_nvr_ips = {n.get("ip") for n in json_nvrs if n.get("ip")}
            untouched_nvrs = [
                {"ip": ip, "name": n.name or ip}
                for ip, n in db_nvrs.items()
                if ip not in json_nvr_ips and n.unlinked_at is None
            ]

        job["progress"] = 80
        job["message"] = "در حال جمع‌بندی آماری و ایجاد پیش‌نمایش..."
        await asyncio.sleep(0.2)

        summary = {
            "total_nvrs_in_file": len(json_nvrs),
            "new_nvrs_count": len(new_nvrs),
            "relinked_nvrs_count": len(relinked_nvrs),
            "modified_nvrs_count": len(modified_nvrs),
            "unchanged_nvrs_count": len(unchanged_nvrs),
            "untouched_nvrs_count": len(untouched_nvrs),
            "settings_count": len(json_settings),
            "groups_count": len(json_groups),
            "plans_count": len(json_plans),
            "users_count": len(json_users),
            "tasks_count": len(json_tasks),
            "new_nvrs": new_nvrs[:50],
            "relinked_nvrs": relinked_nvrs[:50],
            "modified_nvrs": modified_nvrs[:50],
            "untouched_nvrs": untouched_nvrs[:50],
        }

        job["progress"] = 100
        job["status"] = "completed"
        job["message"] = "تحلیل فایل با موفقیت به پایان رسید."
        job["summary"] = summary

    except Exception as e:
        logger.error(f"Error analyzing import job {job_id}: {e}")
        job["status"] = "failed"
        job["progress"] = 100
        job["error"] = f"خطا در تحلیل فایل: {e!s}"


def require_admin_user(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
):
    import main

    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    admin_fn = main.app.dependency_overrides.get(main.require_admin, main.require_admin)
    try:
        user = auth_fn(request, response, session)
    except TypeError:
        user = auth_fn()
    try:
        user = admin_fn(user)
    except TypeError:
        user = admin_fn()
    return user


def require_auth_user(
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
    return user


@router.post("/import/analyze")
async def analyze_config_import(
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin_user),
    session: Session = Depends(get_session),
):
    """دریافت فایل JSON و شروع تحلیل مقایسه‌ای در پس‌زمینه"""
    cl = request.headers.get("content-length")
    if cl and int(cl) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413, detail="حجم فایل بیش از حد مجاز (۱۰ مگابایت) است"
        )
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="فایل ارسالی فرمت JSON معتبر ندارد")

    _cleanup_old_jobs()
    job_id = str(uuid.uuid4())
    _import_jobs[job_id] = {
        "job_id": job_id,
        "status": "processing",
        "progress": 5,
        "message": "شروع تحلیل فایل...",
        "payload": body,
        "summary": None,
        "error": None,
        "created_at": datetime.now(),
    }

    background_tasks.add_task(_run_analysis, job_id)
    return {"job_id": job_id}


@router.get("/import/status/{job_id}")
def get_import_job_status(
    job_id: str,
    user: dict = Depends(require_auth_user),
    session: Session = Depends(get_session),
):
    """استعلام وضعیت آنی تحلیل فایل JSON"""
    job = _import_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="شناسه عملیات یافت نشد")

    return {
        "job_id": job["job_id"],
        "status": job["status"],
        "progress": job["progress"],
        "message": job["message"],
        "summary": job.get("summary"),
        "error": job.get("error"),
    }


@router.post("/import/execute")
async def execute_config_import(
    request: Request,
    user: dict = Depends(require_admin_user),
    session: Session = Depends(get_session),
):
    """اعمال نهایی تنظیمات و دستگاه‌ها بر اساس استراتژی انتخابی کاربر (Upsert یا Replace)"""
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="داده‌های ارسالی نامعتبر است")

    job_id = data.get("job_id")
    strategy = data.get("strategy", "upsert").lower()

    if strategy not in ["upsert", "replace"]:
        raise HTTPException(
            status_code=400, detail="استراتژی نامعتبر است (باید upsert یا replace باشد)"
        )

    job = _import_jobs.get(job_id)
    if not job or "payload" not in job:
        raise HTTPException(
            status_code=404, detail="عملیات مورد نظر منقضی شده یا یافت نشد"
        )

    payload = job["payload"]
    json_nvrs = payload.get("nvrs", []) if isinstance(payload, dict) else payload
    json_settings = payload.get("settings", {}) if isinstance(payload, dict) else {}
    json_groups = payload.get("groups", []) if isinstance(payload, dict) else []
    json_plans = payload.get("plans", []) if isinstance(payload, dict) else []
    json_users = payload.get("users", []) if isinstance(payload, dict) else []
    json_tasks = payload.get("tasks", []) if isinstance(payload, dict) else []

    imported_nvr_ips = []

    # 1. اعمال تنظیمات (Settings)
    if json_settings:
        for k, v in json_settings.items():
            s = session.get(Settings, k)
            if s:
                s.value = str(v)
                session.add(s)
            else:
                session.add(Settings(key=k, value=str(v)))

    # 2. اعمال گروه‌ها (NVR Groups)
    for g_data in json_groups:
        g_name = g_data.get("name")
        if not g_name:
            continue
        g = session.exec(select(NVRGroup).where(NVRGroup.name == g_name)).first()
        if not g:
            g = NVRGroup(
                name=g_name,
                description=g_data.get("description"),
                map_center_lat=g_data.get("map_center_lat"),
                map_center_lng=g_data.get("map_center_lng"),
                map_zoom=g_data.get("map_zoom"),
            )
            session.add(g)
        else:
            g.description = g_data.get("description", g.description)
            g.map_center_lat = g_data.get("map_center_lat", g.map_center_lat)
            g.map_center_lng = g_data.get("map_center_lng", g.map_center_lng)
            g.map_zoom = g_data.get("map_zoom", g.map_zoom)
            session.add(g)

    session.commit()

    # 3. مدیریت دستگاه‌های NVR
    json_nvr_ips_set = set()

    for n_data in json_nvrs:
        ip = n_data.get("ip")
        if not ip:
            continue
        json_nvr_ips_set.add(ip)
        imported_nvr_ips.append(ip)

        existing = session.get(NVR, ip)
        if existing:
            if n_data.get("name"):
                existing.name = n_data["name"]
            if n_data.get("user"):
                existing.user = n_data["user"]
            if n_data.get("password"):
                existing.password = encrypt_password(n_data["password"])
            if n_data.get("rtsp_port"):
                existing.rtsp_port = int(n_data["rtsp_port"])
            if "enabled" in n_data:
                existing.enabled = bool(n_data["enabled"])
            if "group_id" in n_data:
                existing.group_id = n_data["group_id"]
            existing.unlinked_at = None
            session.add(existing)
        else:
            pwd = (
                encrypt_password(n_data.get("password", ""))
                if n_data.get("password")
                else ""
            )
            new_nvr = NVR(
                ip=ip,
                name=n_data.get("name"),
                user=n_data.get("user", "admin"),
                password=pwd,
                enabled=bool(n_data.get("enabled", True)),
                status="Unknown",
                rtsp_port=int(n_data.get("rtsp_port", 554)),
                group_id=n_data.get("group_id"),
                unlinked_at=None,
            )
            session.add(new_nvr)

    # اگر استراتژی Replace باشد، دستگاه‌هایی که در فایل نیستند Soft-Delete (Unlink) می‌شوند
    if strategy == "replace":
        db_nvrs = session.exec(select(NVR).where(NVR.unlinked_at == None)).all()
        for old_nvr in db_nvrs:
            if old_nvr.ip not in json_nvr_ips_set:
                old_nvr.unlinked_at = datetime.now()
                old_nvr.enabled = False
                session.add(old_nvr)

    # 4. اعمال وظایف زمان‌بندی‌شده (Tasks)
    for t_data in json_tasks:
        tid = t_data.get("id")
        if not tid:
            continue
        task_db = session.get(ScheduledTask, tid)
        if task_db:
            if "interval" in t_data:
                task_db.interval = int(t_data["interval"])
            if "is_enabled" in t_data:
                task_db.is_enabled = bool(t_data["is_enabled"])
            session.add(task_db)

    session.commit()

    log_event(
        session,
        category="Config",
        action="CONFIG_IMPORT",
        details=f"پیکربندی سامانه با استراتژی {strategy.upper()} و تعداد {len(imported_nvr_ips)} دستگاه NVR اعمال گردید",
        level="INFO",
        actor_username=user.get("username", "admin") if user else "admin",
    )

    # اجرای فوری همگام‌سازی پس‌زمینه
    for ip in imported_nvr_ips[:30]:  # همگام‌سازی سریع دستگاه‌های ورودی
        asyncio.create_task(task_sync_nvr_configs(nvr_ip=ip))
        asyncio.create_task(task_sync_nvr_health(nvr_ip=ip))
        asyncio.create_task(task_sync_nvr_stats(nvr_ip=ip))

    _import_jobs.pop(job_id, None)

    return {
        "ok": True,
        "message": f"پیکربندی سامانه با استراتژی {strategy} با موفقیت اعمال گردید",
        "strategy": strategy,
        "imported_nvrs_count": len(imported_nvr_ips),
    }
