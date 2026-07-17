from __future__ import annotations

import asyncio
import inspect
import threading
import time
from collections import defaultdict
from functools import wraps
from typing import Optional

from fastapi import HTTPException, Request
from starlette.responses import StreamingResponse


class RateLimiter:
    """Memory-based, thread-safe rate limiter with connection tracking."""

    def __init__(self, cleanup_interval: int = 60):
        self._lock = threading.Lock()
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._connections: dict[str, int] = defaultdict(int)
        self._last_cleanup = time.time()
        self._cleanup_interval = cleanup_interval

    def _cleanup(self) -> None:
        now = time.time()
        if now - self._last_cleanup < self._cleanup_interval:
            return
        self._last_cleanup = now
        cutoff = now - 3600
        expired = [k for k, v in self._requests.items() if not v or v[-1] < cutoff]
        for k in expired:
            del self._requests[k]

    def check_rate(self, key: str, max_requests: int, window: int) -> bool:
        """Record a request and return True if within limit."""
        now = time.time()
        with self._lock:
            self._cleanup()
            cutoff = now - window
            self._requests[key] = [t for t in self._requests[key] if t > cutoff]
            if len(self._requests[key]) >= max_requests:
                return False
            self._requests[key].append(now)
            return True

    def retry_after(self, key: str, window: int) -> int:
        """Seconds until the oldest request in the window expires."""
        now = time.time()
        with self._lock:
            timestamps = self._requests.get(key, [])
            if not timestamps:
                return 0
            return max(0, int(window - (now - min(timestamps))) + 1)

    def acquire(self, key: str, max_conn: int) -> bool:
        """Try to acquire a connection slot. Returns True if successful."""
        with self._lock:
            if self._connections[key] >= max_conn:
                return False
            self._connections[key] += 1
            return True

    def release(self, key: str) -> None:
        """Release a connection slot."""
        with self._lock:
            if self._connections[key] > 0:
                self._connections[key] -= 1

    def connection_count(self, key: str) -> int:
        """Get current number of active connections for a key."""
        with self._lock:
            return self._connections.get(key, 0)


# Thread-safe singleton instance
limiter = RateLimiter()


def _find_request(args: tuple, kwargs: dict) -> Optional[Request]:
    """Extract the FastAPI Request from function arguments."""
    if "request" in kwargs and isinstance(kwargs["request"], Request):
        return kwargs["request"]
    for arg in args:
        if isinstance(arg, Request):
            return arg
    for v in kwargs.values():
        if isinstance(v, Request):
            return v
    return None


def _get_client_ip(request: Optional[Request]) -> str:
    if request and request.client:
        return request.client.host
    return "unknown"


def rate_limit(max_requests: int, window_seconds: int):
    """
    Decorator: rate-limit requests per client IP within a time window.

    Usage:
        @app.post("/api/test/email")
        @rate_limit(3, 60)
        def test_mail(request: Request):
            ...
    """

    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            request = _find_request(args, kwargs)
            ip = _get_client_ip(request)
            key = f"rl:{func.__name__}:{ip}"

            if not limiter.check_rate(key, max_requests, window_seconds):
                wait = limiter.retry_after(key, window_seconds)
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limit exceeded. Retry after {wait}s.",
                    headers={"Retry-After": str(wait)},
                )
            return await func(*args, **kwargs)

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            request = _find_request(args, kwargs)
            ip = _get_client_ip(request)
            key = f"rl:{func.__name__}:{ip}"

            if not limiter.check_rate(key, max_requests, window_seconds):
                wait = limiter.retry_after(key, window_seconds)
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limit exceeded. Retry after {wait}s.",
                    headers={"Retry-After": str(wait)},
                )
            return func(*args, **kwargs)

        wrapper = async_wrapper if asyncio.iscoroutinefunction(func) else sync_wrapper
        wrapper.__signature__ = inspect.signature(func)
        return wrapper

    return decorator


def max_connections(max_conn: int, key: str = None):
    """
    Decorator: limit concurrent connections.

    For StreamingResponse endpoints: wraps close() to automatically
    release the slot when the stream ends (client disconnect or done).

    Usage:
        @app.get("/api/cameras/{id}/stream")
        @max_connections(3, key="global:stream")
        async def stream(...):
            return StreamingResponse(...)
    """

    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            conn_key = key or f"mc:{func.__name__}"

            if not limiter.acquire(conn_key, max_conn):
                raise HTTPException(
                    status_code=429,
                    detail=f"Too many concurrent connections (max: {max_conn})",
                    headers={"Retry-After": "5"},
                )

            try:
                result = await func(*args, **kwargs)
            except Exception:
                limiter.release(conn_key)
                raise

            if isinstance(result, StreamingResponse):
                body_iter = result.body_iterator

                async def wrapped_body():
                    try:
                        async for chunk in body_iter:
                            yield chunk
                    finally:
                        limiter.release(conn_key)

                result.body_iterator = wrapped_body()
                return result

            limiter.release(conn_key)
            return result

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            conn_key = key or f"mc:{func.__name__}"

            if not limiter.acquire(conn_key, max_conn):
                raise HTTPException(
                    status_code=429,
                    detail=f"Too many concurrent connections (max: {max_conn})",
                    headers={"Retry-After": "5"},
                )

            try:
                result = func(*args, **kwargs)
            except Exception:
                limiter.release(conn_key)
                raise

            if isinstance(result, StreamingResponse):
                body_iter = result.body_iterator

                async def wrapped_body():
                    try:
                        async for chunk in body_iter:
                            yield chunk
                    finally:
                        limiter.release(conn_key)

                result.body_iterator = wrapped_body()
                return result

            limiter.release(conn_key)
            return result

        wrapper = async_wrapper if asyncio.iscoroutinefunction(func) else sync_wrapper
        wrapper.__signature__ = inspect.signature(func)
        return wrapper

    return decorator
