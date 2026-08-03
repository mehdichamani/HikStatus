# انتقال کدهای اصلی به app/main.py صورت گرفت و این فایل صرفاً به عنوان نقطه ورود عمل می‌کند.
import os
import sys

# برای اطمینان از اینکه مسیرها نسبت به پوشه روت به درستی کار می‌کنند
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main import (  # noqa: F401
    app,
    get_session,
    get_user_accessible_groups,
    require_admin,
    require_auth,
    require_control,
)
