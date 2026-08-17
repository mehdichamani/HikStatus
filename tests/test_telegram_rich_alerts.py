"""
تست‌های خودکار مربوط به تجمیع هشدارهای تلگرام، Rich Messages و مدیریت محدوده کاراکترها (tests/test_telegram_rich_alerts.py)
"""

from unittest.mock import patch

from app.services.alerts import (
    build_aggregated_telegram_message,
    send_telegram_batch,
    split_telegram_message,
)


def test_build_aggregated_telegram_message_rich_formatting():
    """
    بررسی قالب‌بندی Rich HTML پیام تجمیعی تلگرام شامل تگ‌های آکاردئونی، ایموجی‌ها و رویدادهای NVR
    """
    events_by_group = {
        "شعبه مرکزی": [
            {
                "type": "camera_offline",
                "name": "دوربین ورودی اصلی",
                "ip": "192.168.1.50",
                "time": "۰۹:۴۵",
            },
            {
                "type": "camera_offline",
                "name": "دوربین پارکینگ B",
                "ip": "192.168.1.51",
                "time": "۰۹:۵۰",
            },
        ],
        "انبار آفتاب": [
            {
                "type": "camera_online",
                "name": "دوربین نگهبانی",
                "ip": "192.168.2.15",
                "time": "۰۹:۵۵",
            }
        ],
    }

    nvr_events = [
        {
            "type": "nvr_offline",
            "name": "NVR انبار مرکزی",
            "ip": "192.168.1.10",
            "error": "Timeout",
        },
        {
            "type": "nvr_recovered",
            "name": "NVR شعبه اداری",
            "ip": "192.168.1.20",
        },
    ]

    message = build_aggregated_telegram_message(
        events_by_group=events_by_group, nvr_events=nvr_events
    )

    # بررسی وجود تگ آکاردئونی تلگرام
    assert "<blockquote expandable>" in message
    assert "</blockquote>" in message

    # بررسی تگ کد یکنواخت Monospace برای IP
    assert "<code>192.168.1.50</code>" in message
    assert "<code>192.168.2.15</code>" in message
    assert "<code>192.168.1.10</code>" in message

    # بررسی ایموجی‌های وضعیت
    assert "🔴" in message
    assert "🟢" in message

    # بررسی نام گروه‌ها و NVRها
    assert "شعبه مرکزی" in message
    assert "انبار آفتاب" in message
    assert "NVR انبار مرکزی" in message
    assert "NVR شعبه اداری" in message

    # بررسی خلاصه آماری
    assert "گروه درگیر" in message
    assert "NVR قطع" in message
    assert "دوربین قطع" in message


def test_build_aggregated_telegram_message_raw_lines():
    """
    بررسی قالب‌بندی پیام‌های کارت غنی با خطوط خام (مانند تغییرات ساختاری یا گزارش ساعتی)
    """
    raw_lines = [
        "➕ دوربین جدید: ورودی شمالی (<code>192.168.1.100</code>)",
        "➖ دوربین حذف‌شده: نگهبانی قدیم (<code>192.168.1.101</code>)",
    ]
    title = "تغییرات ساختاری دوربین‌ها — NVR سالن اصلی"

    msg = build_aggregated_telegram_message(
        title=title, raw_lines=raw_lines, alert_type="warning"
    )

    assert title in msg
    assert "<blockquote expandable>" in msg
    assert "</blockquote>" in msg
    assert "<code>192.168.1.100</code>" in msg
    assert "سامانه هوشمند پایش تجهیزات HikStatus" in msg


def test_split_telegram_message_smart_chunking():
    """
    بررسی شکستن هوشمند پیام در صورت فراتر رفتن از حد مجاز (مثلاً ۳۸۰۰ کاراکتر)
    بدون شکستن تگ‌های HTML یا قطع ناقص بلوک‌ها
    """
    # ساخت ساختار داده بزرگ با ۲۵ گروه
    events_by_group = {}
    for g in range(1, 26):
        group_name = f"شعبه شماره {g}"
        events_by_group[group_name] = [
            {
                "type": "camera_offline",
                "name": f"دوربین سالن شماره {c}",
                "ip": f"192.168.{g}.{10 + c}",
                "time": "۱۰:۰۰",
            }
            for c in range(1, 6)
        ]

    long_message = build_aggregated_telegram_message(events_by_group)
    assert len(long_message) > 4096, (
        "پیام تولید شده باید برای تست از ۴۰۹۶ کاراکتر بزرگ‌تر باشد"
    )

    # فراخوانی تابع تقسیم پیام با حد مجاز ۳۸۰۰ کاراکتر
    chunks = split_telegram_message(long_message, max_chars=3800)

    assert len(chunks) > 1, "پیام بلند باید به چند بخش (چنک) تقسیم شده باشد"

    for i, chunk in enumerate(chunks, 1):
        # طول هیچ چنکی نباید از حد مجاز بیشتر باشد
        assert len(chunk) <= 3800, (
            f"چنک شماره {i} بیشتر از حد مجاز ۳۸۰۰ کاراکتر است ({len(chunk)})"
        )

        # بررسی تگ‌های باز و بسته HTML در هر چنک برای جلوگیری از Parse Error تلگرام
        open_blockquotes = chunk.count("<blockquote expandable>") + chunk.count(
            "<blockquote>"
        )
        close_blockquotes = chunk.count("</blockquote>")
        assert open_blockquotes == close_blockquotes, (
            f"تگ‌های blockquote در چنک {i} متوازن نیستند"
        )

        open_b = chunk.count("<b>")
        close_b = chunk.count("</b>")
        assert open_b == close_b, f"تگ‌های <b> در چنک {i} متوازن نیستند"

        # بررسی پسوند شماره بخش
        assert f"بخش {i} از" in chunk or len(chunks) == 1


def test_telegram_api_4096_character_limit_enforcement():
    """
    تست حصول اطمینان از اینکه هیچ پیام تک‌بخشی بالای ۴۰۹۶ کاراکتر به API تلگرام ارسال نمی‌شود
    و الگوریتم chunking به صورت خودکار فعال می‌گردد.
    """
    large_text = "A" * 5000  # متن فرضی ۵۰۰۰ کاراکتری

    # ارسال متون بالای ۴۰۹۶ کاراکتر باید قبل از ارسال API شکسته شوند
    chunks = split_telegram_message(large_text, max_chars=3800)
    for chunk in chunks:
        assert len(chunk) <= 4096


def test_send_telegram_batch_structured_and_raw():
    """
    تست فراخوانی send_telegram_batch با داده ساختاریافته و خطوط خام
    """
    with patch("app.services.alerts.get_config_dict") as mock_conf, patch(
        "app.services.alerts.send_telegram_raw"
    ) as mock_send_raw:
        mock_conf.return_value = {
            "TELEGRAM_ENABLED": "true",
            "TELEGRAM_CHAT_IDS": "123456,789012",
        }
        mock_send_raw.return_value = True

        # ۱. ارسال ساختاریافته
        events_by_group = {
            "گروه آزمایشی": [
                {
                    "type": "camera_offline",
                    "name": "دوربین تست",
                    "ip": "10.0.0.1",
                    "downtime_mins": 5,
                }
            ]
        }
        res = send_telegram_batch(events_by_group)
        assert res is True
        assert mock_send_raw.called
        sent_msg = mock_send_raw.call_args[0][1]
        assert "گروه آزمایشی" in sent_msg
        assert "<code>10.0.0.1</code>" in sent_msg
        assert "<blockquote expandable>" in sent_msg

        mock_send_raw.reset_mock()

        # ۲. ارسال خطوط خام
        res_raw = send_telegram_batch("عنوان گزارش", ["خط اول", "خط دوم"])
        assert res_raw is True
        assert mock_send_raw.called
        sent_raw_msg = mock_send_raw.call_args[0][1]
        assert "عنوان گزارش" in sent_raw_msg
        assert "خط اول" in sent_raw_msg
        assert "<blockquote expandable>" in sent_raw_msg

