from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlmodel import Session, select

from app.database import Settings, get_session
from app.logging_config import log_event
from app.services.alerts import invalidate_config_cache

router = APIRouter()


@router.get("/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}


@router.get("/settings", response_model=list[Settings])
def get_settings(
    request: Request, response: Response, session: Session = Depends(get_session)
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
        target_id=key,
    )
    invalidate_config_cache()
    return s


@router.get("/tts")
def text_to_speech(text: str):
    if not text:
        raise HTTPException(status_code=400, detail="Text parameter is required")
    try:
        import io
        from fastapi.responses import StreamingResponse
        from gtts import gTTS

        # Synthesize Persian speech
        tts = gTTS(text=text, lang="fa", slow=False)
        mp3_fp = io.BytesIO()
        tts.write_to_fp(mp3_fp)
        mp3_fp.seek(0)
        return StreamingResponse(mp3_fp, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")
