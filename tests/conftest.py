import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import init_db


@pytest.fixture(scope="session", autouse=True)
def initialize_test_database():
    """راه‌اندازی ساختار دیتابیس و جداول قبل از اجرای آزمون‌ها"""
    init_db()
