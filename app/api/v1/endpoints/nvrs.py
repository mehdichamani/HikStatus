import os
import re
from datetime import datetime

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
)
from sqlmodel import Session, select

from app.database import (
    NVR,
    Camera,
    CameraChangeEvent,
    DowntimeEvent,
    OutageExplanation,
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


def delete_camera_snapshots(camera_ids: list[int]):
    """حذف فایل‌های فیزیکی اسنپ‌شات دوربین‌ها از روی دیسک"""
    for cid in camera_ids:
        for ext in [".jpg", ".png", ".jpeg"]:
            p = os.path.join("data", "snapshots", f"camera_{cid}{ext}")
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception as e:
                    logger.warning(f"خطا در حذف فایل اسنپ‌شات {p}: {e}")


def is_valid_ip_or_host(value: str) -> bool:
    """
    بررسی معتبر بودن آدرس IP یا نام میزبان (میزبان استاتیک، نام دامنه، DDNS و غیره)
    """
    if not value or len(value) > 253:
        return False
    # پذیرش آدرس‌های IPv4 معتبر، نام‌های دامنه و هاست‌نیم‌ها، احتمالاً همراه با پورت
    # استفاده از نویسه‌های مجاز استاندارد و ممانعت از کاراکترهای مخرب
    pattern = r"^[a-zA-Z0-9_\-\.]+(:[0-9]+)?$"
    return bool(re.match(pattern, value))


@router.get("", response_model=list[NVR], response_model_exclude={"password"})
def get_nvrs(
    request: Request,
    response: Response,
    include_unlinked: bool = Query(
        default=False, description="نمایش NVRهای غیرفعال/حذف موقت شده"
    ),
    session: Session = Depends(get_session),
):
    import main

    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    try:
        user = auth_fn(request, response, session)
    except TypeError:
        user = auth_fn()

    accessible_groups = main.get_user_accessible_groups(user, session)
    query = select(NVR)
    if not include_unlinked:
        query = query.where(NVR.unlinked_at == None)

    if accessible_groups is None:
        return session.exec(query).all()
    if not accessible_groups:
        return []
    return session.exec(query.where(NVR.group_id.in_(accessible_groups))).all()


@router.post("")
def create_nvr(
    nvr: NVR,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
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

    if not is_valid_ip_or_host(nvr.ip):
        raise HTTPException(
            status_code=400, detail="قالب آدرس IP یا میزبان نامعتبر است"
        )

    if nvr.rtsp_port < 1 or nvr.rtsp_port > 65535:
        raise HTTPException(
            status_code=400, detail="پورت RTSP باید عددی بین ۱ تا ۶۵۵۳۵ باشد"
        )

    existing = session.get(NVR, nvr.ip)
    if existing:
        if existing.unlinked_at is not None:
            # اتصال مجدد (Re-link) دستگاه از پیش ثبت شده
            existing.unlinked_at = None
            existing.enabled = True
            if nvr.name:
                existing.name = nvr.name
            if nvr.user:
                existing.user = nvr.user
            if nvr.password:
                existing.password = encrypt_password(nvr.password)
            existing.rtsp_port = nvr.rtsp_port
            if nvr.group_id is not None:
                existing.group_id = nvr.group_id

            session.add(existing)
            session.commit()
            log_event(
                session,
                category="NVR",
                action="NVR_RELINK",
                details=f"دستگاه NVR ({existing.name or existing.ip}) مجدداً متصل و فعال گردید (Re-link)",
                level="INFO",
                actor_username=user.get("username", "admin") if user else "admin",
                group_id=existing.group_id,
                target_type="NVR",
                target_id=existing.ip,
            )
            background_tasks.add_task(task_sync_nvr_configs, nvr_ip=existing.ip)
            background_tasks.add_task(task_sync_nvr_health, nvr_ip=existing.ip)
            background_tasks.add_task(task_sync_nvr_stats, nvr_ip=existing.ip)
            return existing
        else:
            raise HTTPException(status_code=400, detail="این آدرس IP قبلاً ثبت شده است")

    if nvr.password:
        nvr.password = encrypt_password(nvr.password)
    nvr.unlinked_at = None
    session.add(nvr)
    session.commit()
    log_event(
        session,
        category="NVR",
        action="NVR_CREATE",
        details=f"دستگاه NVR جدید ({nvr.name or nvr.ip}) ایجاد شد",
        level="INFO",
        actor_username=user.get("username", "admin") if user else "admin",
        group_id=nvr.group_id,
        target_type="NVR",
        target_id=nvr.ip,
    )
    # همگام‌سازی فوری پس‌زمینه برای NVR جدید بدون بلاک شدن کلاینت
    background_tasks.add_task(task_sync_nvr_configs, nvr_ip=nvr.ip)
    background_tasks.add_task(task_sync_nvr_health, nvr_ip=nvr.ip)
    background_tasks.add_task(task_sync_nvr_stats, nvr_ip=nvr.ip)
    return nvr


@router.delete("/{ip}")
def delete_nvr(
    ip: str,
    hard: bool = Query(
        default=False,
        description="حذف کامل فیزیکی رکوردهای دیتابیس و فایل‌های اسنپ‌شات",
    ),
    request: Request = None,
    response: Response = None,
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

    n = session.get(NVR, ip)
    if not n:
        raise HTTPException(status_code=404, detail="NVR not found")
    n_name = n.name or ip
    g_id = n.group_id

    if not hard:
        # حذف موقت (Soft-Delete / Unlink)
        n.unlinked_at = datetime.now()
        n.enabled = False
        session.add(n)
        session.commit()
        log_event(
            session,
            category="NVR",
            action="NVR_UNLINK",
            details=f"دستگاه NVR ({n_name}) غیرفعال و ارتباط آن قطع گردید (Soft-Delete)",
            level="WARNING",
            actor_username=user.get("username", "admin") if user else "admin",
            group_id=g_id,
            target_type="NVR",
            target_id=ip,
        )
        return {"ok": True, "mode": "unlinked"}

    # حذف کامل قطعی (Hard-Delete)
    cams = session.exec(select(Camera).where(Camera.nvr_ip == ip)).all()
    cam_ids = [c.id for c in cams if c.id is not None]
    delete_camera_snapshots(cam_ids)

    for cam in cams:
        # پاکسازی توضیحات و وقایع قطعی
        explanations = session.exec(
            select(OutageExplanation).where(OutageExplanation.camera_id == cam.id)
        ).all()
        for exp in explanations:
            session.delete(exp)

        downtimes = session.exec(
            select(DowntimeEvent).where(DowntimeEvent.camera_id == cam.id)
        ).all()
        for dt in downtimes:
            session.delete(dt)

        session.delete(cam)

    events = session.exec(
        select(CameraChangeEvent).where(CameraChangeEvent.nvr_ip == ip)
    ).all()
    for ev in events:
        session.delete(ev)

    session.delete(n)
    session.commit()
    log_event(
        session,
        category="NVR",
        action="NVR_DELETE",
        details=f"دستگاه NVR ({n_name}) و تمامی سوابق و فایل‌های آن به‌صورت کامل حذف شدند (Hard-Delete)",
        level="WARNING",
        actor_username=user.get("username", "admin") if user else "admin",
        group_id=g_id,
        target_type="NVR",
        target_id=ip,
    )
    return {"ok": True, "mode": "purged"}


@router.put("/{ip}")
def update_nvr(
    ip: str,
    p: dict,
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

    n = session.get(NVR, ip)
    if not n:
        raise HTTPException(status_code=404, detail="NVR not found")
    if user["role"] != "admin":
        accessible_groups = main.get_user_accessible_groups(user, session)
        if accessible_groups is None or n.group_id not in accessible_groups:
            raise HTTPException(status_code=403, detail="دسترسی غیرمجاز به این NVR")

    # بررسی تغییر آدرس IP دستگاه NVR
    new_ip = p.get("ip")
    if new_ip and new_ip != ip:
        if not is_valid_ip_or_host(new_ip):
            raise HTTPException(
                status_code=400, detail="قالب آدرس IP یا میزبان نامعتبر است"
            )

        # بررسی عدم وجود تداخل آدرس IP جدید با دستگاه‌های دیگر
        existing = session.get(NVR, new_ip)
        if existing:
            raise HTTPException(status_code=400, detail="این آدرس IP قبلاً ثبت شده است")

        # شبیه‌سازی تغییر کلید اصلی با کپی کل فیلدها و ساخت رکورد جدید
        new_nvr = NVR(
            ip=new_ip,
            name=p.get("name", n.name),
            user=p.get("user", n.user),
            password=encrypt_password(p["password"])
            if (p.get("password") and p["password"] != n.password)
            else n.password,
            enabled=p.get("enabled", n.enabled),
            status="Unknown",
            group_id=p.get("group_id", n.group_id)
            if user["role"] == "admin"
            else n.group_id,
            rtsp_port=int(p.get("rtsp_port", n.rtsp_port)),
            # کپی بقیه مشخصات سخت‌افزاری و اطلاعات پیشرفته
            model=n.model,
            firmware_version=n.firmware_version,
            serial_number=n.serial_number,
            mac_address=n.mac_address,
            uptime=n.uptime,
            cpu_usage=n.cpu_usage,
            memory_usage=n.memory_usage,
            hdd_status=n.hdd_status,
            device_time=n.device_time,
            last_online=n.last_online,
            unlinked_at=n.unlinked_at,
            mail_alert_count=n.mail_alert_count,
            mail_last_alert=n.mail_last_alert,
            telegram_alert_count=n.telegram_alert_count,
            telegram_last_alert=n.telegram_last_alert,
        )

        session.add(new_nvr)

        # بروزرسانی ارجاعات در جدول دوربین‌ها (Camera)
        cameras = session.exec(select(Camera).where(Camera.nvr_ip == ip)).all()
        for c in cameras:
            c.nvr_ip = new_ip
            session.add(c)

        # بروزرسانی ارجاعات در جدول وقایع تغییر دوربین (CameraChangeEvent)
        events = session.exec(
            select(CameraChangeEvent).where(CameraChangeEvent.nvr_ip == ip)
        ).all()
        for ev in events:
            ev.nvr_ip = new_ip
            session.add(ev)

        # حذف رکورد قبلی
        session.delete(n)
        session.commit()

        log_event(
            session,
            category="NVR",
            action="NVR_UPDATE",
            details=f"تنظیمات NVR ({new_nvr.name or new_ip}) و آدرس IP آن از {ip} به {new_ip} بروزرسانی گردید",
            level="INFO",
            actor_username=user.get("username", "admin") if user else "admin",
            group_id=new_nvr.group_id,
            target_type="NVR",
            target_id=new_ip,
        )
        return new_nvr

    if "name" in p:
        n.name = p["name"]
    if "user" in p:
        n.user = p["user"]
        n.status = "Unknown"
    if "password" in p:
        if p["password"]:
            n.password = encrypt_password(p["password"])
            n.status = "Unknown"
    if "group_id" in p and user["role"] == "admin":
        n.group_id = p["group_id"] if p["group_id"] is not None else None
    if "rtsp_port" in p:
        try:
            port_val = int(p["rtsp_port"])
            if port_val < 1 or port_val > 65535:
                raise ValueError()
            n.rtsp_port = port_val
            n.status = "Unknown"
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400, detail="پورت RTSP باید عددی بین ۱ تا ۶۵۵۳۵ باشد"
            )
    if "enabled" in p:
        n.enabled = bool(p["enabled"])
        n.status = "Unknown"

    session.add(n)
    session.commit()
    log_event(
        session,
        category="NVR",
        action="NVR_UPDATE",
        details=f"تنظیمات NVR ({n.name or ip}) بروزرسانی گردید",
        level="INFO",
        actor_username=user.get("username", "admin") if user else "admin",
        group_id=n.group_id,
        target_type="NVR",
        target_id=ip,
    )
    return n
