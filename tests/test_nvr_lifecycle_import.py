from __future__ import annotations

import os
from datetime import datetime, timedelta
from unittest import mock

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

import main
from app import database
from app.database import (
    NVR,
    Camera,
    DowntimeEvent,
    Settings,
)
from app.services import monitor, scheduler
from main import get_session, require_admin, require_auth

test_sqlite_url = "sqlite:///data/test_lifecycle_temp.db"
test_engine = create_engine(test_sqlite_url, connect_args={"check_same_thread": False})


@pytest.fixture(name="session")
def session_fixture():
    SQLModel.metadata.create_all(test_engine)

    old_db_engine = database.engine
    old_monitor_engine = monitor.engine
    old_scheduler_engine = scheduler.engine

    database.engine = test_engine
    monitor.engine = test_engine
    scheduler.engine = test_engine

    with Session(test_engine, expire_on_commit=False) as session:
        # Default settings
        for s in [
            Settings(key="LIMIT_LOG_RETENTION_DAYS", value="90"),
        ]:
            session.merge(s)
        session.commit()
        yield session

    database.engine = old_db_engine
    monitor.engine = old_monitor_engine
    scheduler.engine = old_scheduler_engine
    SQLModel.metadata.drop_all(test_engine)


@pytest.fixture(name="client")
def client_fixture(session: Session):
    def get_session_override():
        return session

    def require_auth_override():
        return {"id": 1, "username": "admin", "role": "admin", "group_id": None}

    def require_admin_override():
        return {"id": 1, "username": "admin", "role": "admin", "group_id": None}

    main.app.dependency_overrides[get_session] = get_session_override
    main.app.dependency_overrides[require_auth] = require_auth_override
    main.app.dependency_overrides[require_admin] = require_admin_override

    with (
        mock.patch(
            "app.api.v1.endpoints.nvrs.task_sync_nvr_configs",
            new_callable=mock.AsyncMock,
        ),
        mock.patch(
            "app.api.v1.endpoints.nvrs.task_sync_nvr_health",
            new_callable=mock.AsyncMock,
        ),
        mock.patch(
            "app.api.v1.endpoints.nvrs.task_sync_nvr_stats", new_callable=mock.AsyncMock
        ),
        mock.patch(
            "app.api.v1.endpoints.import_jobs.task_sync_nvr_configs",
            new_callable=mock.AsyncMock,
        ),
        mock.patch(
            "app.api.v1.endpoints.import_jobs.task_sync_nvr_health",
            new_callable=mock.AsyncMock,
        ),
        mock.patch(
            "app.api.v1.endpoints.import_jobs.task_sync_nvr_stats",
            new_callable=mock.AsyncMock,
        ),
        TestClient(main.app) as c,
    ):
        yield c

    main.app.dependency_overrides.clear()


def test_nvr_soft_delete_and_relink(client: TestClient, session: Session):
    """تست فرآیند حذف موقت (Soft-Delete) و اتصال مجدد (Re-link)"""
    # 1. ساخت NVR
    res = client.post(
        "/api/v1/nvrs",
        json={
            "ip": "192.168.1.100",
            "name": "Main NVR",
            "user": "admin",
            "password": "123",
            "rtsp_port": 554,
        },
    )
    assert res.status_code == 200

    # ثبت یک دوربین برای این NVR
    cam = Camera(
        name="Cam 1",
        ip="192.168.1.101",
        nvr_ip="192.168.1.100",
        channel_id="1",
        status="Online",
    )
    session.add(cam)
    session.commit()

    # 2. حذف موقت (Soft-Delete)
    del_res = client.delete("/api/v1/nvrs/192.168.1.100")
    assert del_res.status_code == 200
    assert del_res.json().get("mode") == "unlinked"

    # بررسی وضعیت در دیتابیس
    db_nvr = session.get(NVR, "192.168.1.100")
    assert db_nvr is not None
    assert db_nvr.enabled is False
    assert db_nvr.unlinked_at is not None

    # بررسی عدم نمایش در لیست فعال پیش‌فرض
    get_res = client.get("/api/v1/nvrs")
    assert len(get_res.json()) == 0

    # بررسی نمایش در صورت درخواست unlinked
    get_all_res = client.get("/api/v1/nvrs?include_unlinked=true")
    assert len(get_all_res.json()) == 1

    # 3. اتصال مجدد (Re-link) با همان IP
    relink_res = client.post(
        "/api/v1/nvrs",
        json={
            "ip": "192.168.1.100",
            "name": "Main NVR Updated",
            "user": "admin",
            "password": "456",
            "rtsp_port": 554,
        },
    )
    assert relink_res.status_code == 200

    db_nvr_relinked = session.get(NVR, "192.168.1.100")
    assert db_nvr_relinked.enabled is True
    assert db_nvr_relinked.unlinked_at is None
    assert db_nvr_relinked.name == "Main NVR Updated"


def test_nvr_hard_delete_purges_everything(client: TestClient, session: Session):
    """تست حذف کامل (Hard-Delete) و پاکسازی دیتابیس و فایل‌های اسنپ‌شات"""
    # 1. ایجاد NVR و دوربین و اسنپ‌شات ساختگی
    nvr = NVR(ip="192.168.1.200", name="NVR To Purge", user="admin", enabled=True)
    session.add(nvr)
    session.commit()

    cam = Camera(
        name="Cam To Purge",
        ip="192.168.1.201",
        nvr_ip="192.168.1.200",
        channel_id="1",
        status="Offline",
    )
    session.add(cam)
    session.commit()
    session.refresh(cam)

    os.makedirs("data/snapshots", exist_ok=True)
    fake_snapshot_path = f"data/snapshots/camera_{cam.id}.jpg"
    with open(fake_snapshot_path, "wb") as f:
        f.write(b"fake_image_bytes")

    assert os.path.exists(fake_snapshot_path)

    # 2. اجرای Hard-Delete
    del_res = client.delete("/api/v1/nvrs/192.168.1.200?hard=true")
    assert del_res.status_code == 200
    assert del_res.json().get("mode") == "purged"

    # بررسی حذف کامل از دیتابیس
    assert session.get(NVR, "192.168.1.200") is None
    assert (
        session.exec(select(Camera).where(Camera.nvr_ip == "192.168.1.200")).first()
        is None
    )
    # بررسی حذف فایل از دیسک
    assert not os.path.exists(fake_snapshot_path)


def test_edit_nvr_ip_preserves_camera_history(client: TestClient, session: Session):
    """تست ویرایش IP دستگاه NVR و حفظ دقیق شناسه‌های دوربین و سوابق قطعی"""
    # 1. ایجاد NVR و دوربین و رویداد قطعی
    nvr = NVR(ip="10.0.0.1", name="Old NVR", user="admin", enabled=True)
    session.add(nvr)
    session.commit()

    cam = Camera(
        name="Office Cam",
        ip="10.0.0.2",
        nvr_ip="10.0.0.1",
        channel_id="1",
        status="Online",
    )
    session.add(cam)
    session.commit()
    session.refresh(cam)
    original_cam_id = cam.id

    dt = DowntimeEvent(
        camera_id=original_cam_id, start_time=datetime.now() - timedelta(hours=2)
    )
    session.add(dt)
    session.commit()

    # 2. تغییر IP به 10.0.0.50
    update_res = client.put(
        "/api/v1/nvrs/10.0.0.1",
        json={
            "ip": "10.0.0.50",
            "name": "Old NVR Renamed",
            "user": "admin",
            "rtsp_port": 554,
        },
    )
    assert update_res.status_code == 200

    # بررسی دیتابیس
    assert session.get(NVR, "10.0.0.1") is None
    new_nvr = session.get(NVR, "10.0.0.50")
    assert new_nvr is not None
    assert new_nvr.name == "Old NVR Renamed"

    # دوربین باید همان id قبلی را حفظ کرده و فقط nvr_ip آن به 10.0.0.50 آپدیت شده باشد
    db_cam = session.get(Camera, original_cam_id)
    assert db_cam is not None
    assert db_cam.nvr_ip == "10.0.0.50"

    # سابقه قطعی بدون تغییر باقی مانده باشد
    db_dt = session.exec(
        select(DowntimeEvent).where(DowntimeEvent.camera_id == original_cam_id)
    ).first()
    assert db_dt is not None


def test_orphaned_cleanup_30_days(session: Session):
    """تست پاکسازی زمان‌بندی‌شده NVRهای unlinked بالای ۳۰ روز"""
    now = datetime.now()

    # NVR قدیمی Unlink شده (۳۵ روز قبل) -> باید پاک شود
    old_nvr = NVR(
        ip="192.168.10.1",
        name="Old Unlinked",
        user="admin",
        enabled=False,
        unlinked_at=now - timedelta(days=35),
    )
    session.add(old_nvr)

    # NVR به تازگی Unlink شده (۵ روز قبل) -> نباید پاک شود
    recent_nvr = NVR(
        ip="192.168.10.2",
        name="Recent Unlinked",
        user="admin",
        enabled=False,
        unlinked_at=now - timedelta(days=5),
    )
    session.add(recent_nvr)
    session.commit()

    # ایجاد دوربین برای NVR قدیمی
    cam_old = Camera(
        name="Cam Old", ip="192.168.10.11", nvr_ip="192.168.10.1", channel_id="1"
    )
    session.add(cam_old)
    session.commit()
    session.refresh(cam_old)

    # فایل اسنپ‌شات موقت
    os.makedirs("data/snapshots", exist_ok=True)
    snap_path = f"data/snapshots/camera_{cam_old.id}.jpg"
    with open(snap_path, "wb") as f:
        f.write(b"snap")

    # اجرای پاکسازی
    monitor.cleanup_old_data(session, days=90)

    # بررسی نتایج
    assert session.get(NVR, "192.168.10.1") is None
    assert session.get(NVR, "192.168.10.2") is not None
    assert not os.path.exists(snap_path)


def test_json_import_analyze_and_upsert_replace(client: TestClient, session: Session):
    """تست موتور تحلیل و استراتژی‌های Upsert و Replace"""
    # 1. ایجاد یک NVR پیش‌فرض در دیتابیس
    existing_nvr = NVR(ip="172.16.0.1", name="Existing NVR", user="admin", enabled=True)
    session.add(existing_nvr)
    session.commit()

    payload = {
        "settings": {"MAIL_SERVER": "smtp.company.local"},
        "groups": [{"name": "Factory North", "description": "North Branch"}],
        "nvrs": [
            {
                "ip": "172.16.0.1",
                "name": "Existing NVR (Modified)",
                "user": "root",
                "rtsp_port": 554,
            },
            {
                "ip": "172.16.0.2",
                "name": "Brand New NVR",
                "user": "admin",
                "rtsp_port": 554,
            },
        ],
    }

    # تحلیل فایل
    res_analyze = client.post("/api/v1/config/import/analyze", json=payload)
    assert res_analyze.status_code == 200
    job_id = res_analyze.json()["job_id"]

    res_status = client.get(f"/api/v1/config/import/status/{job_id}")
    assert res_status.status_code == 200
    job_data = res_status.json()
    assert job_data["status"] == "completed"
    summary = job_data["summary"]
    assert summary["new_nvrs_count"] == 1
    assert summary["modified_nvrs_count"] == 1

    # اجرای Upsert
    res_exec = client.post(
        "/api/v1/config/import/execute", json={"job_id": job_id, "strategy": "upsert"}
    )
    assert res_exec.status_code == 200

    # بررسی اعمال تغییرات
    nvr1 = session.get(NVR, "172.16.0.1")
    assert nvr1.name == "Existing NVR (Modified)"
    assert nvr1.user == "root"

    nvr2 = session.get(NVR, "172.16.0.2")
    assert nvr2 is not None
    assert nvr2.name == "Brand New NVR"
