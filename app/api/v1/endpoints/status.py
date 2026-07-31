# -*- coding: utf-8 -*-
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlmodel import Session, select

from app.database import get_session, Settings
from app.logging_config import log_event
from app.services.alerts import invalidate_config_cache

router = APIRouter()

@router.get("/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}

@router.get("/settings", response_model=list[Settings])
def get_settings(
    request: Request,
    response: Response,
    session: Session = Depends(get_session)
):
    import main
    # حل پویا جهت اعمال صحیح شبیه‌سازی‌ها (Dependency Overrides) در محیط تست
    auth_fn = main.app.dependency_overrides.get(main.require_auth, main.require_auth)
    admin_fn = main.app.dependency_overrides.get(main.require_admin, main.require_admin)

    try:
        user = auth_fn(request, response, session)
    except TypeError:
        user = auth_fn()

    try:
        admin_fn(user)
    except TypeError:
        admin_fn()

    return session.exec(select(Settings)).all()

@router.put("/settings/{key}")
def update_setting(
    key: str,
    p: Settings,
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
        admin_fn(user)
    except TypeError:
        admin_fn()

    s = session.get(Settings, key)
    if not s:
        raise HTTPException(status_code=404, detail="Setting not found")
    old_val = s.value
    s.value = p.value
    session.add(s)
    session.commit()
    log_event(
        session,
        category="Config",
        action="SETTING_UPDATE",
        details=f"تنظیم سیستم '{key}' از '{old_val}' به '{p.value}' تغییر یافت",
        level="WARNING",
        actor_username=user.get("username", "admin") if user else "admin",
        target_type="Setting",
        target_id=key
    )
    invalidate_config_cache()
    return s
