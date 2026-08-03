import inspect

import pytest

from app.services.monitor import task_sync_nvr_health


@pytest.mark.asyncio
async def test_task_sync_nvr_health_exists():
    assert task_sync_nvr_health is not None
    assert inspect.iscoroutinefunction(task_sync_nvr_health)
