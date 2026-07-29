import sys
import os
from typing import Optional
from loguru import logger

def setup_logging():
    """Configure loguru for structured logging."""
    
    # Remove default handler
    logger.remove()
    
    # Console handler - INFO level for terminal
    logger.add(
        sys.stderr,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        level="INFO",
        colorize=True
    )
    
    # File handler - DEBUG level for file logging
    log_dir = "data/logs"
    os.makedirs(log_dir, exist_ok=True)
    
    logger.add(
        os.path.join(log_dir, "app_{time:YYYY-MM-DD}.log"),
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{function}:{line} - {message}",
        level="DEBUG",
        rotation="00:00",  # Daily rotation at midnight
        retention="30 days",
        compression="zip",
        encoding="utf-8"
    )
    
    # Error file handler - ERROR level only
    logger.add(
        os.path.join(log_dir, "error_{time:YYYY-MM-DD}.log"),
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{function}:{line} - {message}",
        level="ERROR",
        rotation="00:00",
        retention="30 days",
        compression="zip",
        encoding="utf-8"
    )
    
    return logger

# Initialize logging when module is imported
logger = setup_logging()

def log_event(
    session=None,
    category: str = "System",
    action: str = "EVENT",
    details: str = "",
    level: str = "INFO",
    actor_username: Optional[str] = "system",
    actor_ip: Optional[str] = None,
    group_id: Optional[int] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None
):
    """
    Centralized logging function. Log to terminal/files via loguru
    and persist structured audit log to database if session is provided.
    """
    from app.database import Log

    # 1. Terminal / File logging (loguru)
    msg = f"[{category}:{action}] {details}"
    if actor_username and actor_username != "system":
        msg = f"[{actor_username}@{actor_ip or 'local'}] " + msg
        
    lvl = (level or "INFO").upper()
    if lvl in ("ERROR", "CRITICAL"):
        logger.error(msg)
    elif lvl == "WARNING":
        logger.warning(msg)
    elif lvl == "DEBUG":
        logger.debug(msg)
    else:
        logger.info(msg)

    # 2. Database persistence
    if session is not None:
        try:
            log_record = Log(
                category=category,
                level=lvl,
                action=action,
                actor_username=actor_username or "system",
                actor_ip=actor_ip,
                group_id=group_id,
                target_type=target_type,
                target_id=str(target_id) if target_id is not None else None,
                details=details,
                log_type=category,
                state=action or lvl
            )
            session.add(log_record)
            session.commit()
        except Exception as e:
            logger.warning(f"Failed to persist log_event to DB: {e}")

