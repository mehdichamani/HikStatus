"""
ANSI Color codes for terminal output colorization.
Provides a clean interface for colored terminal logging.
"""

# ANSI color codes
class Colors:
    """ANSI color codes for terminal output."""
    
    # Text colors
    BLACK = '\033[30m'
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    MAGENTA = '\033[35m'
    CYAN = '\033[36m'
    WHITE = '\033[37m'
    
    # Bright colors
    BRIGHT_BLACK = '\033[90m'
    BRIGHT_RED = '\033[91m'
    BRIGHT_GREEN = '\033[92m'
    BRIGHT_YELLOW = '\033[93m'
    BRIGHT_BLUE = '\033[94m'
    BRIGHT_MAGENTA = '\033[95m'
    BRIGHT_CYAN = '\033[96m'
    BRIGHT_WHITE = '\033[97m'
    
    # Background colors
    BG_BLACK = '\033[40m'
    BG_RED = '\033[41m'
    BG_GREEN = '\033[42m'
    BG_YELLOW = '\033[43m'
    BG_BLUE = '\033[44m'
    BG_MAGENTA = '\033[45m'
    BG_CYAN = '\033[46m'
    BG_WHITE = '\033[47m'
    
    # Text styles
    BOLD = '\033[1m'
    DIM = '\033[2m'
    ITALIC = '\033[3m'
    UNDERLINE = '\033[4m'
    BLINK = '\033[5m'
    
    # Reset
    RESET = '\033[0m'


# Predefined logging message styles
class LogStyle:
    """Predefined color combinations for different log levels."""
    
    INFO = f"{Colors.BRIGHT_CYAN}[INFO]{Colors.RESET}"
    WARNING = f"{Colors.BRIGHT_YELLOW}[WARNING]{Colors.RESET}"
    ERROR = f"{Colors.BRIGHT_RED}[ERROR]{Colors.RESET}"
    FATAL_ERROR = f"{Colors.BRIGHT_RED}{Colors.BOLD}[FATAL ERROR]{Colors.RESET}"
    SUCCESS = f"{Colors.BRIGHT_GREEN}[SUCCESS]{Colors.RESET}"
    FAIL = f"{Colors.BRIGHT_RED}[FAIL]{Colors.RESET}"
    
    # Alert styles
    CAMERA_OFFLINE = f"{Colors.BRIGHT_RED}⚠️"
    CAMERA_ONLINE = f"{Colors.BRIGHT_GREEN}✅"
    SYSTEM_ERROR = f"{Colors.BRIGHT_RED}🚫"
    WARNING_ICON = f"{Colors.BRIGHT_YELLOW}⚠️"
    CLOCK_ICON = f"{Colors.BRIGHT_CYAN}⌚"
    ROCKET_ICON = f"{Colors.BRIGHT_GREEN}🚀"
    ALERT_ICON = f"{Colors.BRIGHT_RED}🚨"


def colored_text(text, color):
    """Apply a color to text and reset."""
    return f"{color}{text}{Colors.RESET}"


def colored_background(text, bg_color):
    """Apply a background color to text and reset."""
    return f"{bg_color}{text}{Colors.RESET}"
