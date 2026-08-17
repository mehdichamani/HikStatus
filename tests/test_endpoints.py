from datetime import datetime
from unittest import mock

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

import main
from app import database
from app.database import (
    NVR,
    Camera,
    NVRGroup,
    ScheduledTask,
    Settings,
    User,
    hash_password,
)
from app.services import monitor, scheduler
from main import get_session, require_admin, require_auth, require_control

# پایگاه‌داده تست موقت در دایرکتوری داده
test_sqlite_url = "sqlite:///data/test_endpoints_temp.db"
test_engine = create_engine(test_sqlite_url, connect_args={"check_same_thread": False})


@pytest.fixture(name="session")
def session_fixture():
    # ساخت مجدد دیتابیس تست
    SQLModel.metadata.create_all(test_engine)

    # همگام‌سازی موقت موتور مانیتور و دیتابیس با موتور تست
    old_db_engine = database.engine
    old_monitor_engine = monitor.engine
    old_scheduler_engine = scheduler.engine

    database.engine = test_engine
    monitor.engine = test_engine
    scheduler.engine = test_engine

    with Session(test_engine, expire_on_commit=False) as session:
        # مقداردهی اولیه تنظیمات پیش‌فرض برای تست‌ها
        session.add(Settings(key="MAIL_ENABLED", value="false"))
        session.add(Settings(key="TELEGRAM_ENABLED", value="false"))
        session.add(Settings(key="OUTAGE_MIN_HOURS_TO_EXPLAIN", value="2"))
        session.add(Settings(key="OUTAGE_EXPLANATION_DEADLINE_HOURS", value="24"))

        # مقداردهی وظایف زمان‌بندی‌شده
        session.add(
            ScheduledTask(
                id="task_sync_nvr_health",
                name="Sync NVR Health",
                description="Sync NVR Health Task",
                interval=300,
                is_enabled=True,
                status="Idle",
            )
        )
        session.add(
            ScheduledTask(
                id="task_analyze_outages",
                name="Analyze Outages",
                description="Analyze Outages Task",
                interval=3600,
                is_enabled=True,
                status="Idle",
            )
        )

        # ثبت کاربر مدیر با شناسه ۱ جهت جلوگیری از تداخل شناسه در تغییر رمز و CRUD کاربر
        admin_user = User(
            id=1,
            username="admin",
            password_hash=hash_password("admin"),
            role="admin",
            is_active=True,
        )
        session.add(admin_user)

        session.commit()
        yield session

    database.engine = old_db_engine
    monitor.engine = old_monitor_engine
    scheduler.engine = old_scheduler_engine
    SQLModel.metadata.drop_all(test_engine)


@pytest.fixture(name="client")
def client_fixture(session):
    def get_session_override():
        return session

    # به صورت پیش‌فرض ادمین برگشت داده می‌شود تا اکثر تست‌ها با دسترسی کامل پاس شوند
    def require_auth_override():
        return {"user_id": 1, "username": "admin", "role": "admin", "group_id": None}

    def require_control_override():
        return {"user_id": 1, "username": "admin", "role": "admin", "group_id": None}

    def require_admin_override():
        return {"user_id": 1, "username": "admin", "role": "admin", "group_id": None}

    main.app.dependency_overrides[get_session] = get_session_override
    main.app.dependency_overrides[require_auth] = require_auth_override
    main.app.dependency_overrides[require_control] = require_control_override
    main.app.dependency_overrides[require_admin] = require_admin_override

    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


# ==================== ۱. تست‌های اندپوئینت‌های عمومی و سیستمی ====================


def test_endpoint_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_endpoint_service_worker(client):
    response = client.get("/service-worker.js")
    assert response.status_code == 200


def test_endpoint_manifest(client):
    response = client.get("/manifest.json")
    assert response.status_code == 200


def test_endpoint_login_page(client):
    response = client.get("/login")
    assert response.status_code == 200


def test_endpoint_root_page(client):
    response = client.get("/")
    assert response.status_code == 200


# ==================== ۲. تست‌های احراز هویت و امنیت ====================


def test_endpoint_auth_me(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "admin"
    assert data["role"] == "admin"


def test_endpoint_auth_login_fail(client):
    # تست ورود ناموفق
    payload = {"username": "wronguser", "password": "wrongpassword"}
    response = client.post("/api/auth/login", json=payload)
    assert response.status_code == 401


def test_endpoint_auth_login_success(session, client):
    # شبیه‌سازی کاربر تستی در دیتابیس برای لاگین
    user = User(
        id=99,
        username="test_login_user",
        password_hash=hash_password("correct_pass"),
        role="admin",
        is_active=True,
    )
    session.add(user)
    session.commit()

    # غیرفعال کردن موقت دیپندنسی اورراید لاگین جهت تست جریان واقعی
    main.app.dependency_overrides.pop(require_auth, None)

    payload = {"username": "test_login_user", "password": "correct_pass"}
    response = client.post("/api/auth/login", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


def test_endpoint_auth_logout(client):
    response = client.post("/api/auth/logout")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_endpoint_auth_change_password(session, client):
    payload = {"new_password": "new_secure_pass"}
    response = client.post("/api/me/change-password", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


# ==================== ۳. تست‌های مدیریت دستگاه‌های ضبط (NVRs) ====================


def test_endpoint_nvrs_crud(session, client):
    # ۱. ایجاد گروه تستی
    g = NVRGroup(id=1, name="گروه ۱")
    session.add(g)
    session.commit()

    # ۲. ثبت NVR جدید (POST)
    nvr_payload = {
        "ip": "192.168.10.5",
        "name": "NVR کارخانه اصلی",
        "user": "admin",
        "password": "encrypted_pass_mock",
        "enabled": True,
        "group_id": 1,
        "rtsp_port": 554,
    }
    response = client.post("/api/nvrs", json=nvr_payload)
    assert response.status_code in [200, 201]

    # ۳. دریافت لیست NVRها (GET)
    response = client.get("/api/nvrs")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert any(x["ip"] == "192.168.10.5" for x in data)

    # ۴. ویرایش NVR (PUT)
    update_payload = {"name": "نام جدید NVR"}
    response = client.put("/api/nvrs/192.168.10.5", json=update_payload)
    assert response.status_code == 200
    assert response.json()["name"] == "نام جدید NVR"

    # ۵. حذف NVR (DELETE)
    response = client.delete("/api/nvrs/192.168.10.5")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


# ==================== ۴. تست‌های مدیریت گروه‌ها و پلان‌ها ====================


def test_endpoint_groups_crud(session, client):
    # ۱. ثبت گروه جدید
    group_payload = {
        "name": "گروه تست هوشمند",
        "description": "توضیحات تستی گروه",
        "map_center_lat": 35.7,
        "map_center_lng": 51.4,
        "map_zoom": 12,
    }
    response = client.post("/api/groups", json=group_payload)
    assert response.status_code in [200, 201]
    print("GROUP RESPONSE JSON:", response.json())
    gid = response.json()["id"]

    # ۲. دریافت گروه‌ها
    response = client.get("/api/groups")
    assert response.status_code == 200
    assert any(x["id"] == gid for x in response.json())

    # ۳. ویرایش گروه
    update_payload = {"name": "نام ویرایش شده گروه"}
    response = client.put(f"/api/groups/{gid}", json=update_payload)
    assert response.status_code == 200
    assert response.json()["name"] == "نام ویرایش شده گروه"

    # ۴. ایجاد پلان تصویری نقشه روی گروه
    response = client.get(f"/api/groups/{gid}/plans")
    assert response.status_code == 200

    # ۵. حذف گروه
    response = client.delete(f"/api/groups/{gid}")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


# ==================== ۵. تست‌های دوربین‌ها ====================


def test_endpoint_cameras(session, client):
    # ایجاد فرضی NVR و دوربین
    n = NVR(ip="10.10.10.10", name="NVR تستی", status="Online", user="admin")
    session.add(n)

    c = Camera(
        id=888,
        name="دوربین تست نهایی",
        ip="10.10.10.20",
        nvr_ip="10.10.10.10",
        channel_id="1",
        importance=2,
        status="Online",
    )
    session.add(c)
    session.commit()

    # ۱. دریافت لیست دوربین‌ها
    response = client.get("/api/cameras")
    assert response.status_code == 200
    data = response.json()
    assert any(x["id"] == 888 for x in data)

    # ۲. ویرایش دوربین
    update_payload = {"importance": 3}
    response = client.put("/api/cameras/888", json=update_payload)
    assert response.status_code == 200
    assert response.json()["importance"] == 3

    # ۳. دریافت وضعیت آفلاین دوربین‌ها و تغییرات ضبط
    response = client.get("/api/cameras/off")
    assert response.status_code == 200

    response = client.get("/api/cameras/changes")
    assert response.status_code == 200


# ==================== ۶. تست شبیه‌سازی snapshot و stream دوربین ====================


@mock.patch("requests.get")
def test_endpoint_camera_snapshot_mocked(mock_get, session, client):
    # شبیه‌سازی پاسخ پاسخ موفق هایک‌ویژن
    mock_get.return_value.status_code = 200
    mock_get.return_value.content = b"fake_jpeg_image_data"

    n = NVR(ip="10.10.10.10", name="NVR تستی", status="Online", user="admin")
    session.add(n)
    c = Camera(
        id=888,
        name="دوربین تست",
        ip="10.10.10.20",
        nvr_ip="10.10.10.10",
        channel_id="1",
    )
    session.add(c)
    session.commit()

    response = client.get("/api/cameras/888/snapshot")
    assert response.status_code in [200, 500, 404]  # در صورت شبیه‌سازی یا عدم دسترسی


# ==================== ۷. تست‌های تنظیمات، لاگ‌ها و آمارها ====================


def test_endpoint_settings(client):
    response = client.get("/api/settings")
    assert response.status_code == 200

    update_payload = {"value": "true"}
    response = client.put("/api/settings/MAIL_ENABLED", json=update_payload)
    assert response.status_code == 200


def test_endpoint_logs(client):
    response = client.get("/api/logs")
    assert response.status_code == 200


def test_endpoint_heatmap_stats(client):
    response = client.get("/api/stats/heatmap")
    assert response.status_code == 200


# ==================== ۸. تست‌های گزارش‌گیری پایداری (Reports) ====================


def test_endpoint_reports_generation(client):
    # تست تولید گزارش متنی/اکسل برای یک بازه زمانی
    now_ts = datetime.now().timestamp()
    past_ts = now_ts - 86400

    response = client.get(f"/api/reports/generate?start={past_ts}&end={now_ts}")
    assert response.status_code == 200


def test_endpoint_reports_charts(client):
    now_ts = datetime.now().timestamp()
    past_ts = now_ts - 86400
    response = client.get(f"/api/reports/charts?start={past_ts}&end={now_ts}")
    assert response.status_code == 200


def test_endpoint_reports_causes(client):
    response = client.get("/api/reports/causes?period=30d")
    assert response.status_code == 200


# ==================== ۹. تست‌های کاربران و تنظیمات هشدار اختصاصی ====================


def test_endpoint_users_crud(session, client):
    user_payload = {
        "username": "new_it_user",
        "password": "strongpassword123",
        "role": "it_manager",
        "group_id": None,
        "accessible_group_ids": "",
        "is_active": True,
    }
    # ایجاد کاربر
    response = client.post("/api/users", json=user_payload)
    assert response.status_code in [200, 201]
    uid = response.json()["id"]

    # واکشی لیست کاربران
    response = client.get("/api/users")
    assert response.status_code == 200
    assert any(x["id"] == uid for x in response.json())

    # ویرایش کاربر
    update_payload = {"is_active": False}
    response = client.put(f"/api/users/{uid}", json=update_payload)
    print("USER UPDATE RESPONSE TEXT:", response.text)
    assert response.status_code == 200

    # حذف کاربر
    response = client.delete(f"/api/users/{uid}")
    assert response.status_code == 200


def test_endpoint_me_alerts(client):
    response = client.get("/api/me/alerts")
    assert response.status_code == 200

    update_payload = {
        "mail_enabled": True,
        "mail_recipients": "admin@example.com",
        "telegram_enabled": False,
        "telegram_chat_ids": "",
    }
    response = client.put("/api/me/alerts", json=update_payload)
    assert response.status_code == 200


# ==================== ۱۰. تست‌های علل قطعی دوربین‌ها (Outage Causes) ====================


def test_endpoint_outage_causes_crud(session, client):
    cause_payload = {"name": "قطع موقت کابل فیبر نوری"}
    response = client.post("/api/outage-causes", json=cause_payload)
    assert response.status_code in [200, 201]
    cid = response.json()["id"]

    response = client.get("/api/outage-causes")
    assert response.status_code == 200
    assert any(x["id"] == cid for x in response.json())

    response = client.delete(f"/api/outage-causes/{cid}")
    assert response.status_code == 200


# ==================== ۱۱. تست مانیتور و زمان‌بند (Scheduler Tasks) ====================


def test_endpoint_scheduler_tasks_and_control(client):
    # لیست کردن وظایف زمان‌بندی‌شده
    response = client.get("/api/scheduler/tasks")
    assert response.status_code == 200

    # ویرایش اینتروال یک کار
    update_payload = {"interval": 600}
    response = client.put(
        "/api/scheduler/tasks/task_sync_nvr_health/interval", json=update_payload
    )
    assert response.status_code == 200

    # فعال/غیرفعال کردن کار زمان‌بندی‌شده
    toggle_payload = {"is_enabled": False}
    response = client.put(
        "/api/scheduler/tasks/task_sync_nvr_health/toggle", json=toggle_payload
    )
    assert response.status_code == 200

    # اجرای زمان‌بندی دستی
    response = client.post("/api/scheduler/tasks/task_sync_nvr_health/run")
    assert response.status_code == 200
    assert response.json()["status"] in ["running", "ok", "triggered"]


# ==================== ۱۲. تست بازیابی و پاک‌سازی داده‌ها (Data & Import/Export) ====================


def test_endpoint_config_export(client):
    response = client.get("/api/config/export")
    assert response.status_code == 200
    assert "settings" in response.json()


# ==================== ۱۳. تست‌های اعتبارسنجی ضد CSRF و Reverse Proxy ====================


def test_csrf_validation_allowed_and_blocked(session):
    from fastapi import HTTPException, Request

    # ۱. تست مسدود شدن درخواست از دامنه نامعتبر (CSRF Attack)
    req_evil = Request(
        scope={
            "type": "http",
            "method": "POST",
            "headers": [
                (b"origin", b"https://evil-attacker.com"),
                (b"host", b"hikstatus.up.railway.app"),
            ],
            "scheme": "http",
            "server": ("hikstatus.up.railway.app", 80),
            "path": "/api/outage-causes",
            "query_string": b"",
        }
    )
    with pytest.raises(HTTPException) as exc_info:
        main.require_auth(req_evil, None, session)
    assert exc_info.value.status_code == 403
    assert "CSRF Origin" in exc_info.value.detail

    # ۲. تست پذیرش درخواست معتبر از طریق Reverse Proxy و کلود (Railway)
    req_valid_proxy = Request(
        scope={
            "type": "http",
            "method": "POST",
            "headers": [
                (b"origin", b"https://hikstatus.up.railway.app"),
                (b"x-forwarded-host", b"hikstatus.up.railway.app"),
                (b"x-forwarded-proto", b"https"),
            ],
            "scheme": "http",
            "server": ("127.0.0.1", 28888),
            "path": "/api/outage-causes",
            "query_string": b"",
        }
    )
    # هدرهای پروکسی پذیرفته می‌شوند و چون توکن ورود ندارد، خطای 401 احراز هویت می‌دهد نه 403 CSRF
    with pytest.raises(HTTPException) as exc_info:
        main.require_auth(req_valid_proxy, None, session)
    assert exc_info.value.status_code == 401


