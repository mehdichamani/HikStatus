# -*- coding: utf-8 -*-
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlmodel import Session, select
import re

from app.database import NVR, Camera, DowntimeEvent, get_session, encrypt_password, CameraChangeEvent
from app.logging_config import log_event

router = APIRouter()

def is_valid_ip_or_host(value: str) -> bool:
    """
    بررسی معتبر بودن آدرس IP یا نام میزبان (میزبان استاتیک، نام دامنه، DDNS و غیره)
    """
    if not value or len(value) > 253:
        return False
    # پذیرش آدرس‌های IPv4 معتبر، نام‌های دامنه و هاست‌نیم‌ها، احتمالاً همراه با پورت
    # استفاده از نویسه‌های مجاز استاندارد و ممانعت از کاراکترهای مخرب
    pattern = r'^[a-zA-Z0-9_\-\.]+(:[0-9]+)?$'
    return bool(re.match(pattern, value))

@router.get("", response_model=list[NVR], response_model_exclude={"password"})
def get_nvrs(
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
        return session.exec(select(NVR)).all()
    if not accessible_groups:
        return []
    return session.exec(select(NVR).where(NVR.group_id.in_(accessible_groups))).all()

@router.post("")
def create_nvr(
    nvr: NVR,
    request: Request,
    response: Response,
    session: Session = Depends(get_session)
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
        raise HTTPException(status_code=400, detail="قالب آدرس IP یا میزبان نامعتبر است")

    if nvr.rtsp_port < 1 or nvr.rtsp_port > 65535:
        raise HTTPException(status_code=400, detail="پورت RTSP باید عددی بین ۱ تا ۶۵۵۳۵ باشد")

    existing = session.get(NVR, nvr.ip)
    if existing:
        raise HTTPException(status_code=400, detail="این آدرس IP قبلاً ثبت شده است")

    if nvr.password:
        nvr.password = encrypt_password(nvr.password)
    session.add(nvr)
    session.commit()
    log_event(
        session,
        category="NVR",
        action="NVR_CREATE",
        details=f"دستگاه NVR جدید ({nvr.name or nvr.ip}) ایجاد شد",
        level="INFO",
        actor_username=user.get("username","admin") if user else "admin",
        group_id=nvr.group_id,
        target_type="NVR",
        target_id=nvr.ip
    )
    return nvr

@router.delete("/{ip}")
def delete_nvr(
    ip: str,
    request: Request,
    response: Response,
    session: Session = Depends(get_session)
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
    cams = session.exec(select(Camera).where(Camera.nvr_ip == ip)).all()
    for cam in cams:
        downtimes = session.exec(select(DowntimeEvent).where(DowntimeEvent.camera_id == cam.id)).all()
        for dt in downtimes:
            session.delete(dt)
        session.delete(cam)
    session.delete(n)
    session.commit()
    log_event(
        session,
        category="NVR",
        action="NVR_DELETE",
        details=f"دستگاه NVR ({n_name}) حذف شد",
        level="WARNING",
        actor_username=user.get("username","admin") if user else "admin",
        group_id=g_id,
        target_type="NVR",
        target_id=ip
    )
    return {"ok": True}

@router.put("/{ip}")
def update_nvr(
    ip: str,
    p: dict,
    request: Request,
    response: Response,
    session: Session = Depends(get_session)
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
            raise HTTPException(status_code=400, detail="قالب آدرس IP یا میزبان نامعتبر است")

        # بررسی عدم وجود تداخل آدرس IP جدید با دستگاه‌های دیگر
        existing = session.get(NVR, new_ip)
        if existing:
            raise HTTPException(status_code=400, detail="این آدرس IP قبلاً ثبت شده است")

        # شبیه‌سازی تغییر کلید اصلی با کپی کل فیلدها و ساخت رکورد جدید
        new_nvr = NVR(
            ip=new_ip,
            name=p.get("name", n.name),
            user=p.get("user", n.user),
            password=encrypt_password(p["password"]) if (p.get("password") and p["password"] != n.password) else n.password,
            enabled=p.get("enabled", n.enabled),
            status="Unknown",
            group_id=p.get("group_id", n.group_id) if user["role"] == "admin" else n.group_id,
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
            mail_alert_count=n.mail_alert_count,
            mail_last_alert=n.mail_last_alert,
            telegram_alert_count=n.telegram_alert_count,
            telegram_last_alert=n.telegram_last_alert
        )

        session.add(new_nvr)

        # بروزرسانی ارجاعات در جدول دوربین‌ها (Camera)
        cameras = session.exec(select(Camera).where(Camera.nvr_ip == ip)).all()
        for c in cameras:
            c.nvr_ip = new_ip
            session.add(c)

        # بروزرسانی ارجاعات در جدول وقایع تغییر دوربین (CameraChangeEvent)
        events = session.exec(select(CameraChangeEvent).where(CameraChangeEvent.nvr_ip == ip)).all()
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
            actor_username=user.get("username","admin") if user else "admin",
            group_id=new_nvr.group_id,
            target_type="NVR",
            target_id=new_ip
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
            raise HTTPException(status_code=400, detail="پورت RTSP باید عددی بین ۱ تا ۶۵۵۳۵ باشد")
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
        actor_username=user.get("username","admin") if user else "admin",
        group_id=n.group_id,
        target_type="NVR",
        target_id=ip
    )
    return n
