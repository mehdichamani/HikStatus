from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.database import ScheduledTask, TaskExecutionLog, engine
from app.logging_config import log_event, logger
from app.services.monitor import (
    broadcast,
    task_analyze_outages,
    task_capture_camera_snapshots,
    task_cleanup_database,
    task_ping_cameras,
    task_sync_nvr_configs,
    task_sync_nvr_health,
    task_sync_nvr_stats,
)

TASK_FUNCTIONS = {
    "ping_cameras": task_ping_cameras,
    "sync_nvr_configs": task_sync_nvr_configs,
    "sync_nvr_stats": task_sync_nvr_stats,
    "sync_nvr_health": task_sync_nvr_health,
    "cleanup_database": task_cleanup_database,
    "capture_camera_snapshots": task_capture_camera_snapshots,
    "analyze_outages": task_analyze_outages,
}


def get_next_analysis_run(
    base_time: datetime, days_str: str, time_str: str
) -> datetime:
    try:
        days = [int(x.strip()) for x in days_str.split(",") if x.strip().isdigit()]
        hour, minute = map(int, time_str.split(":"))
    except Exception:
        days = [5, 6, 0, 1, 2, 3]  # Saturday to Thursday
        hour, minute = 7, 30

    for i in range(8):
        check_date = base_time + timedelta(days=i)
        check_weekday = check_date.weekday()  # 0=Monday, ..., 6=Sunday
        if check_weekday in days:
            run_time = datetime(
                check_date.year, check_date.month, check_date.day, hour, minute
            )
            if run_time > base_time:
                return run_time
    return base_time + timedelta(days=1)


class TaskScheduler:
    def __init__(self):
        self.active_tasks: dict[str, asyncio.Task] = {}
        self.running = False
        self.loop_task: asyncio.Task | None = None
        self._trigger_lock = asyncio.Lock()

    async def start(self):
        if self.running:
            return
        self.running = True
        # Upon startup, schedule next runs based on intervals if next_run is empty
        with Session(engine) as session:
            tasks = session.exec(select(ScheduledTask)).all()
            now = datetime.now()
            for t in tasks:
                t.status = "Idle"  # ریست کردن وضعیت در راه‌اندازی
                # اگر next_run خالی باشد یا در گذشته مانده باشد، برای اجرای فوری به now تنظیم می‌شود
                if not t.next_run or t.next_run < now:
                    t.next_run = now
                session.add(t)
            session.commit()

        self.loop_task = asyncio.create_task(self._main_loop())
        logger.info("Scheduler engine started.")

    async def stop(self):
        self.running = False
        if self.loop_task:
            self.loop_task.cancel()
            try:
                await self.loop_task
            except asyncio.CancelledError:
                pass
        # Cancel any active running tasks
        for tid, t in list(self.active_tasks.items()):
            t.cancel()
        logger.info("Scheduler engine stopped.")

    async def _main_loop(self):
        while self.running:
            try:
                now = datetime.now()
                with Session(engine) as session:
                    tasks = session.exec(select(ScheduledTask)).all()

                for task in tasks:
                    # Check if it is marked running but has no active task (stale state)
                    if task.status == "Running" and task.id not in self.active_tasks:
                        with Session(engine) as session:
                            db_task = session.get(ScheduledTask, task.id)
                            if db_task:
                                db_task.status = "Idle"
                                session.add(db_task)
                                session.commit()
                        await self._broadcast_status(task.id, "Idle")
                        continue

                    if not task.is_enabled:
                        continue

                    # Time to run?
                    if (
                        task.status == "Idle"
                        and task.id not in self.active_tasks
                        and (not task.next_run or task.next_run <= now)
                    ):
                        self.active_tasks[task.id] = asyncio.create_task(
                            self._run_task_wrapper(task.id)
                        )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Scheduler main loop error: {e}")

            await asyncio.sleep(2)  # Check every 2 seconds

    async def _run_task_wrapper(self, task_id: str, trigger_type: str = "Auto"):
        func = TASK_FUNCTIONS.get(task_id)
        if not func:
            return

        start_time = time.time()
        started_dt = datetime.now()

        # محاسبه و ذخیره فوری زمان اجرای بعدی و وضعیت در حال اجرا
        with Session(engine) as session:
            db_task = session.get(ScheduledTask, task_id)
            if db_task:
                db_task.status = "Running"
                db_task.last_run = started_dt

                if db_task.id == "analyze_outages":
                    from app.database import Settings

                    days_str = "5,6,0,1,2,3"
                    time_str = "07:30"
                    s_days = session.get(Settings, "OUTAGE_ANALYSIS_DAYS")
                    s_time = session.get(Settings, "OUTAGE_ANALYSIS_TIME")
                    if s_days:
                        days_str = s_days.value
                    if s_time:
                        time_str = s_time.value
                    db_task.next_run = get_next_analysis_run(
                        started_dt, days_str, time_str
                    )
                else:
                    db_task.next_run = started_dt + timedelta(
                        seconds=db_task.interval
                    )
                session.add(db_task)
                session.commit()

        await self._broadcast_status(task_id, "Running")

        status_str = "Success"
        error_msg = None
        # تعریف حداکثر زمان انتظار برای تسک‌های مختلف جهت جلوگیری از قفل شدن نامحدود
        task_timeout = 180 if task_id == "sync_nvr_stats" else 60
        try:
            await asyncio.wait_for(func(), timeout=task_timeout)
        except asyncio.TimeoutError:
            status_str = "Failed"
            error_msg = f"زمان اجرای تسک از حد مجاز ({task_timeout} ثانیه) فراتر رفت (Timeout)"
            logger.error(f"Task {task_id} timed out after {task_timeout}s")
        except asyncio.CancelledError:
            status_str = "Cancelled"
            raise
        except Exception as e:
            logger.error(f"Error running task {task_id}: {e}")
            status_str = "Failed"
            error_msg = str(e)
        finally:
            finished_dt = datetime.now()
            duration = round(time.time() - start_time, 2)
            with Session(engine) as session:
                db_task = session.get(ScheduledTask, task_id)
                task_name = db_task.name if db_task else task_id
                if db_task:
                    db_task.status = "Idle"
                    db_task.last_duration = duration
                    db_task.last_status = status_str
                    db_task.last_error = error_msg
                    session.add(db_task)

                    if status_str != "Success":
                        status_fa = (
                            "لغو شد" if status_str == "Cancelled" else "با خطا مواجه شد"
                        )
                        details_str = f"پایان اجرای تسک {db_task.name} ({status_fa})"
                        if error_msg:
                            details_str += f" - خطای سیستم: {error_msg}"
                        log_event(
                            session,
                            category="Task",
                            action=f"TASK_{status_str.upper()}",
                            details=details_str,
                            level="WARNING" if status_str == "Cancelled" else "ERROR",
                            target_type="Task",
                            target_id=db_task.id,
                        )

                # ثبت در تاریخچه اجراها
                exec_log = TaskExecutionLog(
                    task_id=task_id,
                    task_name=task_name,
                    trigger_type=trigger_type,
                    status=status_str,
                    started_at=started_dt,
                    finished_at=finished_dt,
                    duration=duration,
                    error_message=error_msg,
                )
                session.add(exec_log)
                session.commit()

            self.active_tasks.pop(task_id, None)
            await self._broadcast_status(task_id, "Idle")

    async def trigger_task_now(self, task_id: str):
        async with self._trigger_lock:
            with Session(engine) as session:
                db_task = session.get(ScheduledTask, task_id)
                if not db_task:
                    return False
                if db_task.status == "Running":
                    return False

            self.active_tasks[task_id] = asyncio.create_task(
                self._run_task_wrapper(task_id, trigger_type="Manual")
            )
        return True

    async def stop_task_now(self, task_id: str):
        act_task = self.active_tasks.get(task_id)
        if act_task:
            act_task.cancel()
            return True
        return False

    async def _broadcast_status(self, task_id: str, status: str):
        try:
            with Session(engine) as session:
                task = session.get(ScheduledTask, task_id)
                if task:
                    await broadcast(
                        {
                            "type": "task_status",
                            "data": {
                                "id": task.id,
                                "name": task.name,
                                "status": task.status,
                                "last_run": task.last_run.isoformat()
                                if task.last_run
                                else None,
                                "last_duration": task.last_duration,
                                "last_status": task.last_status,
                                "last_error": task.last_error,
                                "next_run": task.next_run.isoformat()
                                if task.next_run
                                else None,
                                "interval": task.interval,
                                "is_enabled": task.is_enabled,
                            },
                        }
                    )
        except Exception as e:
            logger.warning(f"Failed to broadcast task status update: {e}")


scheduler = TaskScheduler()
