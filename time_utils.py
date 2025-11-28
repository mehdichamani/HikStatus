
import datetime
import jdatetime
import pytz

def get_tehran_time():
    """Returns the current time in Tehran timezone."""
    utc_now = datetime.datetime.utcnow().replace(tzinfo=pytz.utc)
    tehran_tz = pytz.timezone('Asia/Tehran')
    return utc_now.astimezone(tehran_tz)

def format_datetime(dt_obj):
    """Formats a datetime object to 'yyyy/mm/dd HH:MM'."""
    if dt_obj is None:
        return ""
    return dt_obj.strftime('%Y/%m/%d %H:%M')

def format_persian_datetime(dt_obj):
    """Formats a datetime object to Persian date and time 'yyyy/mm/dd HH:MM'."""
    if dt_obj is None:
        return ""
    try:
        jd = jdatetime.datetime.fromgregorian(datetime=dt_obj)
        return jd.strftime('%Y/%m/%d %H:%M')
    except (ValueError, TypeError):
        # Fallback for invalid or None dates
        return format_datetime(dt_obj)

def get_formatted_tehran_time():
    """Returns the current Tehran time formatted as 'yyyy/mm/dd HH:MM'."""
    return format_datetime(get_tehran_time())

def get_formatted_persian_tehran_time():
    """Returns the current Tehran time formatted as Persian date 'yyyy/mm/dd HH:MM'."""
    return format_persian_datetime(get_tehran_time())
