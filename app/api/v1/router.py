# -*- coding: utf-8 -*-
from fastapi import APIRouter
from app.api.v1.endpoints.status import router as status_router

api_router = APIRouter()

# ثبت روتر وضعیت و تنظیمات
api_router.include_router(status_router)
