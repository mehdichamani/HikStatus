# HikStatus

[![Persian](https://img.shields.io/badge/lang-فارسی-red)](README.fa.md)

HikVision NVR/Camera monitoring dashboard with real-time alerts via Email and Telegram.

## Features

- Real-time camera status monitoring (Online/Offline)
- NVR auto-discovery and camera detection
- Alert system with Email and Telegram notifications
- Persian (Farsi) RTL web interface
- Downtime tracking and hourly reports
- Camera importance levels (Low/Normal/Critical)
- Alert muting after configurable threshold
- Responsive design for desktop and mobile

## Quick Start

### Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/yourusername/HikStatus.git
cd HikStatus

# Configure environment
cp .env.example .env  # Edit with your credentials

# Run with Docker Compose
docker compose up -d
```

> [!TIP]
> **Permission Issues (`sqlite3.OperationalError: unable to open database file`)**
> 
> If Docker creates the `./data` directory automatically, it may be owned by `root`, preventing the container's non-root user (`appuser` with UID 1000) from writing to the SQLite database. To fix this, adjust the ownership on your host machine:
> ```bash
> sudo chown -R 1000:1000 ./data
> ```

### Native OS (Windows/Linux/macOS)

```bash
# Clone the repository
git clone https://github.com/yourusername/HikStatus.git
cd HikStatus

# Windows
install.bat
start.bat

# Linux/macOS
chmod +x run.sh
./run.sh
```

### Access

Open your browser: http://localhost:28888

Default credentials:
- Username: `admin`
- Password: `admin`

**Important:** Change the default password after first login!

## Configuration

### Environment Variables (.env)

```env
ADMIN_USER=admin
ADMIN_PASS=your-secure-password
```

### Initial Configuration (init_config.json)

Copy `init_config.example.json` to `init_config.json` and customize:

```json
{
  "settings": {
    "MAIL_ENABLED": "true",
    "MAIL_SERVER": "smtp.gmail.com",
    "MAIL_PORT": "587",
    "MAIL_USER": "your-email@gmail.com",
    "MAIL_PASS": "your-app-password",
    "MAIL_RECIPIENTS": "admin@example.com",
    "TELEGRAM_ENABLED": "true",
    "TELEGRAM_BOT_TOKEN": "your-bot-token",
    "TELEGRAM_CHAT_IDS": "your-chat-id"
  },
  "nvrs": [
    {
      "ip": "192.168.1.100",
      "user": "admin",
      "password": "your-nvr-password",
      "enabled": true
    }
  ]
}
```

> [!NOTE]
> **Telegram Proxy Configuration (Docker)**
> 
> If you are running the application in a Docker container and want to connect to a proxy running on your host system (e.g., at `127.0.0.1:10808`), use `http://host.docker.internal:10808` as the proxy address instead of `127.0.0.1`.

### Camera Names (camera_names.csv)

Optional CSV file to assign custom names to cameras:

```csv
ip_address,camera_name
192.168.1.100,Front Door
192.168.1.101,Backyard
```

## Architecture

- **Backend:** Python FastAPI + SQLite (SQLModel)
- **Frontend:** Vanilla HTML/CSS/JS with RTL support
- **Database:** SQLite with WAL mode for concurrent access
- **Alerts:** Email (SMTP) and Telegram (Bot API)

## Project Structure

```
HikStatus/
├── main.py              # FastAPI application
├── monitor.py           # Camera monitoring loop
├── alerts.py            # Email & Telegram alerts
├── database.py          # SQLModel database definitions
├── static/              # Frontend files
│   ├── index.html
│   ├── login.html
│   ├── app.js
│   └── style.css
├── Dockerfile           # Docker image
├── docker-compose.yml   # Docker Compose config
├── requirements.txt     # Python dependencies
├── install.bat          # Windows installer
├── start.bat            # Windows launcher
├── run.sh               # Linux/macOS launcher
└── .env                 # Environment variables (gitignored)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/nvrs` | List NVRs |
| POST | `/api/nvrs` | Add NVR |
| DELETE | `/api/nvrs/{ip}` | Delete NVR |
| GET | `/api/cameras` | List cameras |
| PUT | `/api/cameras/{id}` | Update camera |
| GET | `/api/settings` | List settings |
| PUT | `/api/settings/{key}` | Update setting |
| GET | `/api/logs` | Search logs |
| GET | `/api/stats/{cam_id}` | Camera downtime stats |
| GET | `/api/reports/generate` | Generate report |

## License

MIT License
