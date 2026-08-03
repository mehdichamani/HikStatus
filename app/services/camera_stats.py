from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.database import NVR, Camera, CameraChangeEvent, NVRGroup


def to_persian_numbers(s: str) -> str:
    eng = "0123456789"
    per = "۰۱۲۳۴۵۶۷۸۹"
    translation_table = str.maketrans(eng, per)
    return s.translate(translation_table)


def get_off_cameras(session: Session, accessible_groups: list[int] | None):
    # Fetch all NVR Groups
    groups = {g.id: g.name for g in session.exec(select(NVRGroup)).all()}
    # Fetch all NVRs
    nvrs = {n.ip: n for n in session.exec(select(NVR)).all()}

    # Query cameras where recording is disabled (recording_scheduled == False)
    cameras = session.exec(
        select(Camera).where(Camera.recording_scheduled == False)
    ).all()

    result = []
    now = datetime.now()

    for cam in cameras:
        nvr = nvrs.get(cam.nvr_ip)
        group_id = nvr.group_id if nvr else None

        # Filter by accessible groups
        if accessible_groups is not None and group_id not in accessible_groups:
            continue

        group_name = groups.get(group_id, "بدون گروه")

        # Find the latest event of recording turned off or apply fallback chain
        off_since = None
        event = session.exec(
            select(CameraChangeEvent)
            .where(
                CameraChangeEvent.nvr_ip == cam.nvr_ip,
                CameraChangeEvent.camera_channel_id == cam.channel_id,
                CameraChangeEvent.change_type == "recording_changed",
                CameraChangeEvent.new_value == "ضبط: خاموش",
            )
            .order_by(CameraChangeEvent.detected_at.desc())
        ).first()

        if event:
            off_since = event.detected_at

        if not off_since:
            off_since = cam.stats_last_updated

        if not off_since:
            added_event = session.exec(
                select(CameraChangeEvent).where(
                    CameraChangeEvent.nvr_ip == cam.nvr_ip,
                    CameraChangeEvent.camera_channel_id == cam.channel_id,
                    CameraChangeEvent.change_type == "camera_added",
                )
            ).first()
            if added_event:
                off_since = added_event.detected_at

        if not off_since:
            off_since = cam.last_online

        if not off_since:
            off_since = now

        hours_str = "نامشخص"
        if off_since:
            hours = int((now - off_since).total_seconds() / 3600)
            if hours <= 0:
                hours_str = "کمتر از یک ساعت پیش"
            else:
                hours_str = to_persian_numbers(f"{hours} ساعت پیش")

        result.append(
            {
                "id": cam.id,
                "name": cam.name,
                "factory": group_name,
                "hours_off_str": hours_str,
            }
        )

    return result


def _time_ago(dt: datetime, now: datetime) -> str:
    diff = now - dt
    seconds = int(diff.total_seconds())
    if seconds < 60:
        return "کمتر از یک دقیقه پیش"
    minutes = seconds // 60
    if minutes < 60:
        return to_persian_numbers(f"{minutes} دقیقه پیش")
    hours = minutes // 60
    if hours < 24:
        return to_persian_numbers(f"{hours} ساعت پیش")
    days = hours // 24
    if days < 30:
        return to_persian_numbers(f"{days} روز پیش")
    return to_persian_numbers(f"{days // 30} ماه پیش")


def get_camera_changes(session: Session, accessible_groups: list[int] | None):
    groups = {g.id: g.name for g in session.exec(select(NVRGroup)).all()}
    nvrs = {n.ip: n for n in session.exec(select(NVR)).all()}

    now = datetime.now()
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    # Fetch events in the last 30 days
    events = session.exec(
        select(CameraChangeEvent)
        .where(
            CameraChangeEvent.change_type.in_(["camera_added", "camera_removed"]),
            CameraChangeEvent.detected_at >= month_ago,
        )
        .order_by(CameraChangeEvent.detected_at.desc())
    ).all()

    changes_24h = []
    changes_week = []
    changes_month = []

    for event in events:
        # Determine group_id
        group_id = event.group_id
        if group_id is None:
            nvr = nvrs.get(event.nvr_ip)
            if nvr:
                group_id = nvr.group_id

        # Filter by accessibility
        if accessible_groups is not None and group_id not in accessible_groups:
            continue

        group_name = groups.get(group_id, "بدون گروه")

        action_fa = "اضافه شده" if event.change_type == "camera_added" else "حذف شده"
        time_ago = _time_ago(event.detected_at, now)

        item = {
            "name": event.camera_name or "نامشخص",
            "factory": group_name,
            "action": action_fa,
            "time_ago": time_ago,
        }

        # 24 Hours
        if event.detected_at >= day_ago:
            changes_24h.append(item)

        # Week
        if event.detected_at >= week_ago:
            changes_week.append(item)

        # Month
        changes_month.append(item)

    return {
        "changes_24h": changes_24h,
        "changes_week": changes_week,
        "changes_month": changes_month,
    }
