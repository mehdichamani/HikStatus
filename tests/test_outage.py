# -*- coding: utf-8 -*-
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine, Session, select
from datetime import datetime, timedelta

import main
from main import get_session, require_auth, require_control, require_admin
from app.database import Camera, DowntimeEvent, OutageExplanation, OutageCause, User, NVRGroup, NVR
from app.services import monitor

# ایجاد پایگاه‌داده تست جداگانه در دایرکتوری داده
test_sqlite_url = "sqlite:///data/test_monitor_temp.db"
test_engine = create_engine(test_sqlite_url, connect_args={"check_same_thread": False})

@pytest.fixture(name="session")
def session_fixture():
    # بازسازی کل ساختار دیتابیس تست
    SQLModel.metadata.create_all(test_engine)

    # همگام‌سازی موتور دیتابیس مانیتور با موتور تست
    old_engine = monitor.engine
    monitor.engine = test_engine

    with Session(test_engine) as session:
        yield session

    # بازگردانی موتور دیتابیس
    monitor.engine = old_engine
    SQLModel.metadata.drop_all(test_engine)

@pytest.fixture(name="client")
def client_fixture(session):
    def get_session_override():
        return session

    def require_auth_override():
        # شبیه‌سازی کاربر مدیر سیستم جهت دور زدن احراز هویت
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

def test_task_analyze_outages_and_auto_classification(session, client):
    # ۱. تعریف ساختار کارخانه، NVR و دوربین‌ها برای تست پیشنهاد هوشمند
    group = NVRGroup(id=1, name="کارخانه تست")
    session.add(group)

    nvr = NVR(ip="192.168.1.100", name="NVR تست", group_id=1, status="Online", user="admin")
    session.add(nvr)

    # ساخت دو دوربین روی این NVR
    cam1 = Camera(id=101, name="دوربین ۱", ip="192.168.1.101", nvr_ip="192.168.1.100", channel_id="1", status="Offline")
    cam2 = Camera(id=102, name="دوربین ۲", ip="192.168.1.102", nvr_ip="192.168.1.100", channel_id="2", status="Offline")
    session.add(cam1)
    session.add(cam2)

    # تعریف علت‌های پیش‌فرض دیتابیس
    cause_net = OutageCause(id=1, name="قطع ارتباط با سوئیچ مرکزی / خاموشی NVR", is_active=True)
    cause_other = OutageCause(id=2, name="مشکلات دیگر", is_active=True)
    session.add(cause_net)
    session.add(cause_other)

    session.commit()

    # ۲. ثبت رویداد خاموشی به مدت ۳ ساعت برای هر دو دوربین (۱۰۰٪ دوربین‌های این NVR قطع هستند)
    now = datetime.now().replace(second=0, microsecond=0)
    yesterday = now - timedelta(days=1)
    start_dt = datetime.combine(yesterday.date(), datetime.min.time()).replace(microsecond=0)

    # ثبت رکوردهای خاموشی
    event1 = DowntimeEvent(camera_id=101, start_time=start_dt, end_time=start_dt + timedelta(hours=3))
    event2 = DowntimeEvent(camera_id=102, start_time=start_dt, end_time=start_dt + timedelta(hours=3))
    session.add(event1)
    session.add(event2)
    session.commit()

    # ۳. اجرای تسک پس‌زمینه تحلیل قطعی‌ها به صورت مستقیم
    import asyncio
    asyncio.run(monitor.task_analyze_outages(override_now=now))

    # واکشی قطعی‌های ثبت‌شده
    outages = session.exec(select(OutageExplanation)).all()
    assert len(outages) == 2, "باید ۲ مورد قطعی تجمیعی ثبت شده باشد"

    # ۴. بررسی اندپوینت GET جهت پیشنهاد هوشمند
    response = client.get("/api/outage-explanations")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2

    # دوربین ۱ و ۲ باید پیشنهاد قطع ارتباط با سوئیچ مرکزی داشته باشند
    for o in data:
        assert o["suggested_cause"] == "قطع ارتباط با سوئیچ مرکزی / خاموشی NVR"
        assert "همزمان قطع شده‌اند" in o["suggested_detail"]

def test_bulk_outage_explanations(session, client):
    # ۱. ایجاد رکوردهای تستی
    cam = Camera(id=201, name="دوربین تستی", ip="192.168.2.201", nvr_ip="192.168.2.100", channel_id="1")
    session.add(cam)

    cause = OutageCause(id=5, name="قطعی برق", is_active=True)
    session.add(cause)

    now = datetime.now()
    o1 = OutageExplanation(
        id=501,
        camera_id=201,
        start_time=now - timedelta(days=2),
        end_time=now - timedelta(days=1),
        created_at=now,
        assigned_deadline=now + timedelta(hours=24)
    )
    o2 = OutageExplanation(
        id=502,
        camera_id=201,
        start_time=now - timedelta(days=3),
        end_time=now - timedelta(days=2),
        created_at=now,
        assigned_deadline=now + timedelta(hours=24)
    )
    session.add(o1)
    session.add(o2)
    session.commit()

    # ۲. ثبت دسته‌جمعی توضیحات
    payload = {
        "ids": [501, 502],
        "explanation_type": "قطعی برق",
        "explanation_detail": "تست ثبت گروهی قطعی برق برای کارخانه‌ها"
    }
    response = client.post("/api/outage-explanations/bulk", json=payload)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["status"] == "ok"
    assert res_data["updated_count"] == 2

    # بررسی تغییر اعمال‌شده در دیتابیس
    session.expire_all()
    db_o1 = session.get(OutageExplanation, 501)
    db_o2 = session.get(OutageExplanation, 502)
    assert db_o1.explanation_type == "قطعی برق"
    assert db_o1.explanation_detail == "تست ثبت گروهی قطعی برق برای کارخانه‌ها"
    assert db_o2.explanation_type == "قطعی برق"
    assert db_o2.explanation_detail == "تست ثبت گروهی قطعی برق برای کارخانه‌ها"
