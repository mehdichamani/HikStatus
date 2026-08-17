# 🛠 الگوهای استاندارد کدبیس (HikStatus Code Patterns)

> **🎯 هدف:** ثبت الگوهای تکرارشونده و استاندارد توسعه در پایتون، FastAPI و SQLModel برای حفظ یکپارچگی کد و سرعت‌بخشی به کار ایجنت‌های هوشمند.  
> **تاریخ آخرین به‌روزرسانی:** ۱۴۰۵/۰۵/۲۴

---

## 📌 ۱. الگوی ساخت و تعریف API Endpoint (FastAPI)

تمامی مسیرهای جدید در FastAPI باید از ساختار زیر جهت احراز هویت، کنترل نرخ، تزریق سشن و ثبت لاگ پیروی کنند:

```python
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select
from app.database import Camera, get_session
from app.logging_config import log_event
from app.rate_limiter import rate_limit
from app.main import require_control, get_user_accessible_groups

router = APIRouter(prefix="/api/v1/custom", tags=["Custom"])


@router.post("/items", response_model=dict)
@rate_limit(max_requests=30, window_seconds=60)  # ۱. کنترل نرخ درخواست
def create_custom_item(
    item_data: dict,
    request: Request,
    user: dict = Depends(require_control),  # ۲. بررسی سطح دسترسی نقش (admin/it_manager)
    db: Session = Depends(get_session),  # ۳. تزریق سشن دیتابیس
):
    """
    توضیح عملکرد اندپوئینت
    """
    # ۴. بررسی دسترسی به گروه‌ها
    accessible_groups = get_user_accessible_groups(user, db)
    group_id = item_data.get("group_id")
    if accessible_groups is not None and group_id not in accessible_groups:
        raise HTTPException(status_code=403, detail="شما دسترسی به این گروه را ندارید")

    try:
        # ۵. منطق عملیاتی و ذخیره‌سازی
        new_camera = Camera(**item_data)
        db.add(new_camera)
        db.commit()
        db.refresh(new_camera)

        # ۶. ثبت لاگ سیستم (Audit Logging)
        log_event(
            db=db,
            category="Camera",
            level="INFO",
            action="CREATE",
            actor_username=user["username"],
            actor_ip=request.client.host if request.client else None,
            group_id=new_camera.group_id,
            target_type="Camera",
            target_id=str(new_camera.id),
            details=f"دوربین جدید با نام {new_camera.name} ایجاد شد.",
        )

        return {"success": True, "id": new_camera.id}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"خطا در ایجاد آیتم: {str(e)}")
```

---

## 📌 ۲. الگوی تعامل با دیتابیس (SQLModel Transactions & Queries)

### الف) استفاده از Session در Background Task و پروسه‌های ایزوله (مانند Scheduler)
در پروسه‌های مستقل (خارج از درخواست‌های وب)، باید مستقیماً از Context Manager استفاده شود:

```python
from sqlmodel import Session, select
from app.database import engine, NVR


def update_nvr_status_background(nvr_ip: str, new_status: str):
    with Session(engine) as session:
        nvr = session.get(NVR, nvr_ip)
        if not nvr:
            return False

        nvr.status = new_status
        session.add(nvr)
        session.commit()
        session.refresh(nvr)
        return True
```

### ب) اجرای کوئری با اعمال دسترسی سازمانی (Group Filtering)
برای کوئری‌هایی که باید بر اساس دسترسی کاربر محدود شوند:

```python
from sqlmodel import select, col
from app.database import Camera


def get_cameras_for_user(user: dict, db: Session):
    statement = select(Camera)

    # اگر کاربر به همه گروه‌ها دسترسی ندارد (غیر Admin کل)
    accessible_groups = get_user_accessible_groups(user, db)
    if accessible_groups is not None:
        statement = statement.where(col(Camera.group_id).in_(accessible_groups))

    return db.exec(statement).all()
```

---

## 📌 ۳. الگوی تعریف و افزودن وظیفه زمان‌بندی‌شده (Scheduled Task)

برای افزودن وظیفه زمان‌بندی‌شده جدید به سیستم پایش مستقل:

### step ۱: ثبت وظیفه در دیتابیس (`app/main.py` -> `seed_scheduled_tasks`)
```python
ScheduledTask(
    id="custom_cleanup_task",
    name="پاک‌سازی داده‌های موقت",
    description="بررسی و حذف فایل‌ها و لاگ‌های موقت قدیمی سیستم",
    interval=86400,  # به ثانیه (مثلاً ۲۴ ساعت)
)
```

### step ۲: پیاده‌سازی منطق وظیفه و به‌روزرسانی وضعیت در `app/services/scheduler.py`
```python
import time
from datetime import datetime
from sqlmodel import Session
from app.database import engine, ScheduledTask
from loguru import logger


def run_custom_cleanup_task():
    task_id = "custom_cleanup_task"
    start_time = time.time()

    with Session(engine) as session:
        task = session.get(ScheduledTask, task_id)
        if not task or not task.is_enabled:
            return

        task.status = "Running"
        task.last_run = datetime.now()
        session.add(task)
        session.commit()

        try:
            # انجام عملیات اصلی
            # ... logic ...

            duration = round(time.time() - start_time, 2)
            task.status = "Idle"
            task.last_duration = duration
            task.last_status = "Success"
            task.last_error = None
            task.next_run = datetime.now() + timedelta(seconds=task.interval)
            session.add(task)
            session.commit()
            logger.info(f"Task {task_id} completed in {duration}s")

        except Exception as e:
            duration = round(time.time() - start_time, 2)
            task.status = "Idle"
            task.last_duration = duration
            task.last_status = "Failed"
            task.last_error = str(e)
            session.add(task)
            session.commit()
            logger.error(f"Task {task_id} failed: {e}")
```

---

## 💡 نکات کلیدی ایجنت‌ها
1. همیشه برای هر تغییر در دیتابیس از `try...except...db.rollback()` استفاده کنید.
2. تمام تاریخ‌های ثبت‌شده در دیتابیس باید به صورت میلادی (`datetime.now()`) ذخیره شده و صرفاً هنگام نمایش در UI با توابع آماده به شمسی تبدیل شوند.
3. پروسه‌های زمان‌بندی‌شده نباید هیچ اتصال جامانده در دیتابیس باقی بگذارند.
