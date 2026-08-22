"""
تست‌های خودکار مربوط به تجمیع اعلان‌های مرورگر و تولید متن گفتار صوتی فارسی (tests/test_browser_notifications.py)
"""

from unittest.mock import MagicMock

from app.services.monitor import build_aggregated_browser_alert


class DummyCamera:
    def __init__(self, id, name, ip, nvr_ip="192.168.1.10", group_id=1):
        self.id = id
        self.name = name
        self.ip = ip
        self.nvr_ip = nvr_ip
        self.group_id = group_id


def test_single_camera_offline():
    """
    بررسی ساخت اعلان برای سناریوی تک دوربین قطع
    """
    cam = DummyCamera(1, "دوربین ورودی اصلی", "192.168.1.50")
    offline_by_group = {1: [cam]}

    alert = build_aggregated_browser_alert(
        cycle_nvr_events=[],
        offline_by_group=offline_by_group,
        recovered_by_group={},
    )

    assert alert is not None
    assert alert["type"] == "alert"
    assert alert["alert_type"] == "error"
    assert alert["event_type"] == "camera_offline"
    assert alert["count"] == 1
    assert "دوربین ورودی اصلی" in alert["title"]
    assert "192.168.1.50" in alert["body"]
    assert "هشدار: ارتباط دوربین دوربین ورودی اصلی قطع شد" == alert["speech_text"]


def test_single_camera_recovered():
    """
    بررسی ساخت اعلان برای سناریوی تک دوربین وصل مجدد
    """
    cam = DummyCamera(2, "دوربین پارکینگ شرقی", "192.168.1.52")
    recovered_by_group = {1: [cam]}

    alert = build_aggregated_browser_alert(
        cycle_nvr_events=[],
        offline_by_group={},
        recovered_by_group=recovered_by_group,
    )

    assert alert is not None
    assert alert["alert_type"] == "success"
    assert alert["event_type"] == "camera_recovered"
    assert alert["count"] == 1
    assert "اتصال مجدد" in alert["title"]
    assert "دوربین پارکینگ شرقی" in alert["title"]
    assert "ارتباط دوربین دوربین پارکینگ شرقی مجدداً برقرار شد" == alert["speech_text"]


def test_multiple_cameras_single_group_offline():
    """
    بررسی تجمیع چند دوربین قطع در یک گروه واحد
    """
    cams = [
        DummyCamera(1, "دوربین ۱", "192.168.1.51"),
        DummyCamera(2, "دوربین ۲", "192.168.1.52"),
        DummyCamera(3, "دوربین ۳", "192.168.1.53"),
        DummyCamera(4, "دوربین ۴", "192.168.1.54"),
    ]
    offline_by_group = {1: cams}

    mock_session = MagicMock()
    mock_group = MagicMock()
    mock_group.name = "کارخانه شماره ۱"
    mock_session.get.return_value = mock_group

    alert = build_aggregated_browser_alert(
        cycle_nvr_events=[],
        offline_by_group=offline_by_group,
        recovered_by_group={},
        session=mock_session,
    )

    assert alert is not None
    assert alert["count"] == 4
    assert alert["alert_type"] == "error"
    assert "۴ دوربین" in alert["title"] or "4 دوربین" in alert["title"]
    assert "کارخانه شماره ۱" in alert["title"]
    assert (
        "هشدار: ۴ دوربین در کارخانه شماره ۱ قطع شدند" == alert["speech_text"]
        or "هشدار: 4 دوربین در کارخانه شماره ۱ قطع شدند" == alert["speech_text"]
    )


def test_multiple_cameras_multiple_groups_offline():
    """
    بررسی تجمیع دوربین‌های قطع شده در چند گروه مختلف
    """
    offline_by_group = {
        1: [DummyCamera(1, "دوربین A", "192.168.1.10")],
        2: [DummyCamera(2, "دوربین B", "192.168.2.10")],
        3: [DummyCamera(3, "دوربین C", "192.168.3.10")],
    }

    alert = build_aggregated_browser_alert(
        cycle_nvr_events=[],
        offline_by_group=offline_by_group,
        recovered_by_group={},
    )

    assert alert is not None
    assert alert["count"] == 3
    assert alert["alert_type"] == "error"
    assert "۳ گروه" in alert["title"] or "3 گروه" in alert["title"]
    assert "۳ گروه" in alert["speech_text"] or "3 گروه" in alert["speech_text"]


def test_single_nvr_offline():
    """
    بررسی سناریوی قطع ارتباط یک دستگاه NVR
    """
    cycle_nvr_events = [
        {
            "type": "nvr_offline",
            "name": "NVR انبار مرکزی",
            "ip": "192.168.1.200",
            "error": "Connection refused",
        }
    ]

    alert = build_aggregated_browser_alert(
        cycle_nvr_events=cycle_nvr_events,
        offline_by_group={},
        recovered_by_group={},
    )

    assert alert is not None
    assert alert["alert_type"] == "error"
    assert alert["event_type"] == "nvr_offline"
    assert alert["count"] == 1
    assert "NVR انبار مرکزی" in alert["title"]
    assert "هشدار: اتصال دستگاه ان‌وی‌آر NVR انبار مرکزی قطع شد" == alert["speech_text"]


def test_mixed_nvr_and_cameras_offline():
    """
    بررسی سناریوی ترکیبی قطعی همزمان NVR و دوربین‌ها
    """
    cycle_nvr_events = [
        {
            "type": "nvr_offline",
            "name": "NVR سالن تولید",
            "ip": "192.168.1.201",
        }
    ]
    offline_by_group = {
        1: [
            DummyCamera(1, "دوربین خط ۱", "192.168.1.11"),
            DummyCamera(2, "دوربین خط ۲", "192.168.1.12"),
        ]
    }

    alert = build_aggregated_browser_alert(
        cycle_nvr_events=cycle_nvr_events,
        offline_by_group=offline_by_group,
        recovered_by_group={},
    )

    assert alert is not None
    assert alert["alert_type"] == "error"
    assert alert["count"] == 3
    assert "1 NVR" in alert["title"] or "۱ NVR" in alert["title"]
    assert "2 دوربین" in alert["title"] or "۲ دوربین" in alert["title"]
    assert "دستگاه ان‌وی‌آر" in alert["speech_text"]
    assert "دوربین" in alert["speech_text"]


def test_mixed_offline_and_recovery_simultaneous():
    """
    بررسی سناریوی همزمانی قطعی برخی دوربین‌ها و وصل مجدد برخی دیگر
    """
    offline_by_group = {1: [DummyCamera(1, "دوربین A", "192.168.1.1")]}
    recovered_by_group = {1: [DummyCamera(2, "دوربین B", "192.168.1.2")]}

    alert = build_aggregated_browser_alert(
        cycle_nvr_events=[],
        offline_by_group=offline_by_group,
        recovered_by_group=recovered_by_group,
    )

    assert alert is not None
    assert alert["alert_type"] == "warning"
    assert alert["count"] == 2
    assert "قطع" in alert["title"]
    assert "وصل" in alert["title"]
    assert "قطع" in alert["speech_text"]
    assert "وصل شدند" in alert["speech_text"]


def test_empty_events_returns_none():
    """
    بررسی اینکه اگر هیچ رخدادی در چرخه اتفاق نیفتاده باشد، خروجی None است
    """
    alert = build_aggregated_browser_alert(
        cycle_nvr_events=[],
        offline_by_group={},
        recovered_by_group={},
    )
    assert alert is None
