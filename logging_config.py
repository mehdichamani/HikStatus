import sys
import os
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
