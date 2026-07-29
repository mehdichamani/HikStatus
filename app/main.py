# -*- coding: utf-8 -*-
from main import app
from app.api.v1.router import api_router
from app.api.v1.endpoints.status import router as status_router
from app.api.v1.endpoints.cameras import router as cameras_router
from app.api.v1.endpoints.nvrs import router as nvrs_router

# اتصال روتر v1 با پیشوند مناسب
app.include_router(api_router, prefix="/api/v1")

# اتصال روترها با پیشوند /api جهت حفظ سازگاری کامل با کلاینت‌ها و تست‌های قدیمی
app.include_router(status_router, prefix="/api")
app.include_router(cameras_router, prefix="/api/cameras")
app.include_router(nvrs_router, prefix="/api/nvrs")
