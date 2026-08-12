import asyncio
import os
import signal
import sys

# افزودن مسیر روت پروژه به sys.path جهت فراخوانی درست ماژول‌ها
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import Session, engine, init_db
from app.logging_config import log_event, logger
from app.main import seed_defaults, seed_scheduled_tasks
from app.services.monitor import set_broadcast_callback, ws_manager
from app.services.scheduler import scheduler


async def main():
    logger.info("در حال راه‌اندازی پروسه مستقل زمان‌بند (Scheduler Runner)...")
    init_db()
    seed_defaults()
    seed_scheduled_tasks()
    set_broadcast_callback(ws_manager.broadcast)

    with Session(engine) as session:
        log_event(
            session,
            category="System",
            action="SERVICE_STARTED",
            details="راه‌اندازی سرویس زمان‌بندی مستقل (Scheduler Service)",
            level="INFO",
        )

    stop_event = asyncio.Event()

    def signal_handler():
        logger.info("سیگنال توقف دریافت شد. در حال توقف موتور زمان‌بندی...")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, signal_handler)
        except NotImplementedError:
            # عدم پشتیبانی کامل add_signal_handler در سیستم‌عامل ویندوز
            pass

    await scheduler.start()
    logger.info("موتور زمان‌بندی با موفقیت شروع به کار کرد.")

    try:
        await stop_event.wait()
    except asyncio.CancelledError:
        pass

    logger.info("در حال متوقف کردن موتور زمان‌بندی...")
    await scheduler.stop()
    logger.info("موتور زمان‌بندی با موفقیت متوقف شد.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("پروسه زمان‌بند با دستور کاربر متوقف شد.")
