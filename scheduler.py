from __future__ import annotations
import asyncio
from datetime import datetime, timedelta
import time
from typing import Optional
from sqlmodel import Session, select
from database import engine, ScheduledTask
from monitor import task_ping_cameras, task_sync_camera_names, task_sync_nvr_configs, task_sync_nvr_stats, task_cleanup_database, broadcast

TASK_FUNCTIONS = {
    "ping_cameras": task_ping_cameras,
    "sync_camera_names": task_sync_camera_names,
    "sync_nvr_configs": task_sync_nvr_configs,
    "sync_nvr_stats": task_sync_nvr_stats,
    "cleanup_database": task_cleanup_database
}

class TaskScheduler:
    def __init__(self):
        self.active_tasks: dict[str, asyncio.Task] = {}
        self.running = False
        self.loop_task: Optional[asyncio.Task] = None
        
    async def start(self):
        if self.running:
            return
        self.running = True
        # Upon startup, schedule next runs based on intervals if next_run is empty
        with Session(engine) as session:
            tasks = session.exec(select(ScheduledTask)).all()
            now = datetime.now()
            for t in tasks:
                t.status = "Idle"  # Reset status on startup
                # Run sync/pings immediately on startup (instead of waiting for first interval)
                if t.id in ["ping_cameras", "sync_camera_names", "sync_nvr_configs", "sync_nvr_stats"]:
                    t.next_run = now
                elif not t.next_run:
                    t.next_run = now + timedelta(seconds=t.interval)
                session.add(t)
            session.commit()
            
        self.loop_task = asyncio.create_task(self._main_loop())
        print("Scheduler engine started.")
        
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
        print("Scheduler engine stopped.")
            
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
                    if task.status == "Idle" and (not task.next_run or task.next_run <= now):
                        self.active_tasks[task.id] = asyncio.create_task(self._run_task_wrapper(task.id))
                        
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Scheduler main loop error: {e}")
                
            await asyncio.sleep(2)  # Check every 2 seconds
            
    async def _run_task_wrapper(self, task_id: str):
        func = TASK_FUNCTIONS.get(task_id)
        if not func:
            return
            
        start_time = time.time()
        with Session(engine) as session:
            db_task = session.get(ScheduledTask, task_id)
            if db_task:
                db_task.status = "Running"
                db_task.last_run = datetime.now()
                session.add(db_task)
                session.commit()
        await self._broadcast_status(task_id, "Running")
        
        status_str = "Success"
        try:
            await func()
        except asyncio.CancelledError:
            status_str = "Cancelled"
            raise
        except Exception as e:
            print(f"Error running task {task_id}: {e}")
            status_str = "Failed"
        finally:
            duration = time.time() - start_time
            with Session(engine) as session:
                db_task = session.get(ScheduledTask, task_id)
                if db_task:
                    db_task.status = "Idle"
                    db_task.last_duration = round(duration, 2)
                    db_task.last_status = status_str
                    # Schedule next run based on interval
                    db_task.next_run = datetime.now() + timedelta(seconds=db_task.interval)
                    session.add(db_task)
                    session.commit()
            self.active_tasks.pop(task_id, None)
            await self._broadcast_status(task_id, "Idle")
            
    async def trigger_task_now(self, task_id: str):
        with Session(engine) as session:
            db_task = session.get(ScheduledTask, task_id)
            if not db_task:
                return False
            if db_task.status == "Running":
                return False
                
        self.active_tasks[task_id] = asyncio.create_task(self._run_task_wrapper(task_id))
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
                    await broadcast({
                        "type": "task_status",
                        "data": {
                            "id": task.id,
                            "name": task.name,
                            "status": task.status,
                            "last_run": task.last_run.isoformat() if task.last_run else None,
                            "last_duration": task.last_duration,
                            "last_status": task.last_status,
                            "next_run": task.next_run.isoformat() if task.next_run else None,
                            "interval": task.interval,
                            "is_enabled": task.is_enabled
                        }
                    })
        except Exception as e:
            print(f"Failed to broadcast task status update: {e}")
            
scheduler = TaskScheduler()
