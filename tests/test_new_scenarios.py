import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

import main
from app.database import NVR, Camera, NVRGroup, Settings
from main import get_session, require_admin, require_auth, require_control

# پایگاه‌داده تست موقت برای سناریوهای جدید
test_sqlite_url = "sqlite:///data/test_scenarios_temp.db"
test_engine = create_engine(test_sqlite_url, connect_args={"check_same_thread": False})


@pytest.fixture(name="session")
def session_fixture():
    # اطمینان از پاک بودن ساختار قبل از ساخت و ایجاد مجدد دیتابیس تست
    SQLModel.metadata.drop_all(test_engine)
    SQLModel.metadata.create_all(test_engine)

    from app import database
    from app.services import monitor, scheduler

    old_db_engine = database.engine
    old_monitor_engine = monitor.engine
    old_scheduler_engine = scheduler.engine

    database.engine = test_engine
    monitor.engine = test_engine
    scheduler.engine = test_engine

    with Session(test_engine, expire_on_commit=False) as session:
        # مقداردهی تنظیمات
        session.add(Settings(key="MAIL_ENABLED", value="false"))
        session.add(Settings(key="TELEGRAM_ENABLED", value="false"))
        session.add(Settings(key="OUTAGE_MIN_HOURS_TO_EXPLAIN", value="2"))
        session.add(Settings(key="OUTAGE_EXPLANATION_DEADLINE_HOURS", value="24"))

        # گروه تستی
        g = NVRGroup(id=1, name="کارخانه تست")
        session.add(g)

        # دوربین تستی برای تست ثبت پین نقشه
        c = Camera(
            id=123,
            name="دوربین تست نقشه",
            ip="192.168.1.100",
            nvr_ip="192.168.1.10",
            channel_id="1",
            importance=2,
            status="Online",
        )
        session.add(c)

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


# ۱. تست اعتبارسنجی ثبت NVR با داده‌های نامعتبر و معتبر
def test_create_nvr_validation(client):
    # الف. ثبت NVR با IP نامعتبر (باید خطای 400 بدهد)
    invalid_payload = {
        "ip": "invalid_ip_format!!",
        "name": "NVR اشتباه",
        "user": "admin",
        "password": "password123",
        "enabled": True,
        "group_id": 1,
        "rtsp_port": 554,
    }
    response = client.post("/api/nvrs", json=invalid_payload)
    assert response.status_code == 400
    assert "قالب آدرس IP یا میزبان نامعتبر" in response.json()["detail"]

    # ب. ثبت NVR با پورت نامعتبر (باید خطای 400 بدهد)
    invalid_port_payload = {
        "ip": "192.168.1.50",
        "name": "NVR پورت اشتباه",
        "user": "admin",
        "password": "password123",
        "enabled": True,
        "group_id": 1,
        "rtsp_port": 999999,
    }
    response = client.post("/api/nvrs", json=invalid_port_payload)
    assert response.status_code == 400

    # ج. ثبت NVR با آدرس معتبر (باید با موفقیت انجام شود)
    valid_payload = {
        "ip": "192.168.1.10",
        "name": "NVR تستی معتبر",
        "user": "admin",
        "password": "password123",
        "enabled": True,
        "group_id": 1,
        "rtsp_port": 554,
    }
    response = client.post("/api/nvrs", json=valid_payload)
    assert response.status_code == 200
    assert response.json()["ip"] == "192.168.1.10"


# ۲. تست ثبت نقطه و پین روی نقشه برای دوربین و تضمین عدم بازگشت خطای 500
def test_update_camera_position_on_map(client, session):
    # ایجاد فرضی NVR مرتبط با دوربین ابتدا جهت رعایت ارتباط دیتابیس
    nvr = NVR(ip="192.168.1.10", name="NVR تستی نقشه", user="admin")
    session.add(nvr)
    session.commit()

    # الف. ثبت موقعیت پلان/نقشه برای دوربین (PUT)
    map_payload = {
        "x_pos": 45.5,
        "y_pos": 60.2,
        "plan_id": 1,
        "fov_angle": 90,
        "fov_radius": 150,
        "fov_spread": 45,
    }
    response = client.put("/api/cameras/123", json=map_payload)
    assert response.status_code == 200
    data = response.json()
    assert data["x_pos"] == 45.5
    assert data["y_pos"] == 60.2
    assert data["plan_id"] == 1
    assert data["fov_angle"] == 90

    # ب. ثبت موقعیت جغرافیایی نقشه برای دوربین (PUT)
    geo_payload = {"latitude": 35.6892, "longitude": 51.3890}
    response = client.put("/api/cameras/123", json=geo_payload)
    assert response.status_code == 200
    data = response.json()
    assert data["latitude"] == 35.6892
    assert data["longitude"] == 51.3890
