from fastapi import APIRouter

from app.api.v1.endpoints.cameras import router as cameras_router
from app.api.v1.endpoints.import_jobs import router as import_jobs_router
from app.api.v1.endpoints.nvrs import router as nvrs_router
from app.api.v1.endpoints.status import router as status_router

api_router = APIRouter()

# ثبت روتر وضعیت و تنظیمات
api_router.include_router(status_router)

# ثبت روترهای دوربین‌ها و NVRها و ایمپورت
api_router.include_router(cameras_router, prefix="/cameras", tags=["cameras"])
api_router.include_router(nvrs_router, prefix="/nvrs", tags=["nvrs"])
api_router.include_router(import_jobs_router, prefix="/config", tags=["import"])
