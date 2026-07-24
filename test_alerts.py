import alerts

def test_invalidate_config_cache():
    """تست پاک کردن کش تنظیمات."""
    # قرار دادن مقادیر فرضی در متغیرهای سراسری
    alerts._config_cache = {"test_key": "test_value"}
    alerts._config_cache_time = 1234567890.0

    # فراخوانی تابع برای پاک کردن کش
    alerts.invalidate_config_cache()

    # بررسی مقادیر که آیا ریست شده‌اند یا خیر
    assert alerts._config_cache is None
    assert alerts._config_cache_time == 0

def test_invalidate_config_cache_already_empty():
    """تست پاک کردن کش زمانی که از قبل خالی است."""
    # قرار دادن مقادیر اولیه
    alerts._config_cache = None
    alerts._config_cache_time = 0

    # فراخوانی تابع برای پاک کردن کش
    alerts.invalidate_config_cache()

    # بررسی مقادیر
    assert alerts._config_cache is None
    assert alerts._config_cache_time == 0
