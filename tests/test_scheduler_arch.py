import asyncio
from datetime import datetime, timedelta
import pytest
from sqlmodel import Session, select

from app.database import NVR, ScheduledTask, engine
from app.services.monitor import (
    task_capture_camera_snapshots,
    task_sync_nvr_configs,
    task_sync_nvr_health,
    task_sync_nvr_stats,
)
from app.services.scheduler import TaskScheduler


@pytest.mark.asyncio
async def test_scheduler_startup_preserves_next_run():
    future_time = datetime.now() + timedelta(hours=5)
    with Session(engine) as session:
        t = session.get(ScheduledTask, "ping_cameras")
        if not t:
            t = ScheduledTask(
                id="ping_cameras",
                name="پایش وضعیت اتصال دوربین‌ها",
                description="بررسی دوره‌ای وضعیت دوربین‌ها",
                interval=60,
                next_run=future_time,
            )
            session.add(t)
        else:
            t.next_run = future_time
            session.add(t)
        session.commit()

    test_scheduler = TaskScheduler()
    # شبیه‌سازی شروع کار موتور زمان‌بند
    with Session(engine) as session:
        tasks = session.exec(select(ScheduledTask)).all()
        now = datetime.now()
        for task in tasks:
            task.status = "Idle"
            if not task.next_run:
                task.next_run = now
            session.add(task)
        session.commit()

    with Session(engine) as session:
        db_task = session.get(ScheduledTask, "ping_cameras")
        assert db_task is not None
        assert db_task.next_run.strftime("%Y-%m-%d %H:%M") == future_time.strftime("%Y-%m-%d %H:%M")


@pytest.mark.asyncio
async def test_monitor_tasks_accept_nvr_ip():
    # تست فراخوانی توابع پایش با ورودی nvr_ip
    await task_sync_nvr_configs(nvr_ip="192.168.1.250")
    await task_sync_nvr_stats(nvr_ip="192.168.1.250")
    await task_sync_nvr_health(nvr_ip="192.168.1.250")
    await task_capture_camera_snapshots(nvr_ip="192.168.1.250")
