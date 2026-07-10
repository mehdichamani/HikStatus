# HikStatus

[![Persian](https://img.shields.io/badge/lang-فارسی-red)](README.fa.md)

Real-time HikVision NVR/Camera monitoring dashboard with alert notifications via Email and Telegram.

## Features

- Real-time camera status monitoring (Online / Offline)
- Automatic camera name sync from NVR via Hikvision ISAPI
- Alert system with Email (SMTP) and Telegram (Bot API) notifications
- Configurable alert delays, frequency, and muting thresholds
- Downtime tracking with detailed per-camera statistics
- Camera importance levels (Low / Normal / Critical)
- Interactive map view with camera placement (floor plan or geo-map)
- Database backup download and restore upload from the web UI
- Persian (Farsi) RTL web interface
- Responsive design for desktop and mobile

---

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/yourusername/HikStatus.git
cd HikStatus

# Configure environment
cp .env.example .env
# Edit .env and set ADMIN_USER and ADMIN_PASS

# (Optional) Pre-configure NVRs and settings
cp init_config.example.json init_config.json
# Edit init_config.json with your NVR IPs and credentials

# Build and start
docker compose up -d
```

> [!TIP]
> **Permission Issues (`sqlite3.OperationalError: unable to open database file`)**
>
> If Docker creates the `./data` directory automatically, it may be owned by `root`, preventing the container's non-root user (`appuser`, UID 1000) from writing to the database. Fix with:
> ```bash
> sudo chown -R 1000:1000 ./data
> ```

---

### Option 2: Native Python (Linux / macOS)

```bash
# Clone the repository
git clone https://github.com/yourusername/HikStatus.git
cd HikStatus

# Configure environment
cp .env.example .env
# Edit .env and set ADMIN_USER and ADMIN_PASS

# (Optional) Pre-configure NVRs and settings
cp init_config.example.json init_config.json

# Start (creates .venv and installs dependencies automatically)
chmod +x start.sh
./start.sh
```

To run on a custom port:
```bash
./start.sh 8080
```

---

### Option 3: Native Python (Windows)

```bat
REM Clone the repository
git clone https://github.com/yourusername/HikStatus.git
cd HikStatus

REM Configure environment
copy .env.example .env
REM Edit .env and set ADMIN_USER and ADMIN_PASS

REM (Optional) Pre-configure NVRs and settings
copy init_config.example.json init_config.json

REM First-time setup (creates .venv, installs dependencies)
install.bat

REM Start the application
start.bat
```

To run on a custom port:
```bat
start.bat 8080
```

To uninstall (removes `.venv` only, keeps your data and config):
```bat
uninstall.bat
```

> [!NOTE]
> Python 3.10+ is required. Download from https://www.python.org/downloads/ and check **"Add Python to PATH"** during installation.

---

### Access

Open your browser: **http://localhost:28888**

Default credentials (set in `.env`):
- Username: `admin`
- Password: `admin` ← **change this before exposing to a network**

---

## Configuration

### Environment Variables (`.env`)

```env
ADMIN_USER=admin
ADMIN_PASS=your-secure-password
```

These are the login credentials for the web UI. Copy from `.env.example` and edit.

---

### Initial Configuration (`init_config.json`)

Copy `init_config.example.json` to `init_config.json` to pre-seed the database on first startup (or after a "Purge and Load Init" operation).

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
      "ip": "192.168.1.100:8000",
      "name": "Main Building",
      "user": "admin",
      "password": "your-nvr-password",
      "enabled": true
    }
  ]
}
```

> [!NOTE]
> **Telegram Proxy (Docker)**
>
> If your proxy runs on the host machine (e.g. `127.0.0.1:10808`), use `http://host.docker.internal:10808` as the proxy address in Telegram settings.

---

## Camera Names (ISAPI Auto-Sync)

Camera names are automatically fetched from each NVR via the **Hikvision ISAPI** endpoint (`GET /ISAPI/ContentMgmt/InputProxy/channels`) on every application startup. If names are changed on the NVR side, you can trigger a manual re-sync from the web UI:

**Settings → کنترل سیستم → همگام‌سازی نام دوربین‌ها**

Fallback naming when ISAPI is unavailable: `<NVR Name> ch <channel_number>`.

---

## HikVision Authentication Setup

If:

- NVR cannot be added
- Cameras stay offline
- You receive `401 Unauthorized`

you probably need to enable:

- ISAPI
- Digest Authentication

and create a dedicated non-admin user for HikStatus.

See:

- [HikVision Authentication Setup Guide](HIKVISION_AUTH_SETUP.md)

---

## Settings UI

The web settings panel is organized into tabs:

| Tab | Contents |
|-----|----------|
| **NVRها** | Add / delete NVRs with staged-delete (undo before confirming) |
| **تنظیمات ایمیل** | SMTP configuration, delay, frequency, mute settings |
| **تنظیمات تلگرام** | Bot token, chat IDs, proxy, delay and mute settings |
| **کنترل سیستم** | Camera name sync, backup/restore, apply & restart, danger zone |

### Danger Zone

| Action | Effect |
|--------|--------|
| Purge and Empty DB | Wipes all data; seeds default settings only |
| Purge and Load Init | Wipes all data; re-seeds from `init_config.json` |

---

## Database Backup & Restore

From **Settings → کنترل سیستم → پشتیبان‌گیری و بازیابی**:

- **Download Backup**: Downloads the live `monitor.db` file as `hikstatus_backup_YYYYMMDD_HHMMSS.db`
- **Restore from File**: Upload a `.db` backup file; the server validates the SQLite magic header, atomically replaces the database, and restarts the monitor automatically

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, Uvicorn |
| Database | SQLite with WAL mode (via SQLModel / SQLAlchemy) |
| Frontend | Vanilla HTML + CSS + JavaScript, RTL |
| Alerts | SMTP Email, Telegram Bot API |
| Container | Docker + Docker Compose |

---

## Project Structure

```
HikStatus/
├── main.py                   # FastAPI app, routes, auth, backup/restore
├── monitor.py                # Background camera polling loop + ISAPI sync
├── alerts.py                 # Email & Telegram alert logic
├── database.py               # SQLModel models and database engine
├── static/
│   ├── index.html            # Main dashboard SPA
│   ├── login.html            # Login page
│   ├── app.js                # Frontend logic
│   └── style.css             # Styles
├── Dockerfile                # Docker image definition
├── docker-compose.yml        # Docker Compose configuration
├── requirements.txt          # Python dependencies
├── start.sh                  # Native Python launcher (Linux/macOS)
├── install.bat               # Windows first-time setup
├── start.bat                 # Windows launcher
├── uninstall.bat             # Windows venv removal
├── init_config.example.json  # Template for initial database seed
├── .env.example              # Template for environment variables
└── .env                      # Secrets (gitignored)
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/nvrs` | List NVRs |
| POST | `/api/nvrs` | Add NVR |
| DELETE | `/api/nvrs/{ip}` | Delete NVR (cascades cameras + downtimes) |
| GET | `/api/cameras` | List all cameras |
| PUT | `/api/cameras/{id}` | Update camera (name, importance, position, mute) |
| GET | `/api/settings` | List all settings |
| PUT | `/api/settings/{key}` | Update a setting |
| GET | `/api/logs` | Search logs |
| GET | `/api/stats/{cam_id}` | Camera downtime statistics |
| GET | `/api/reports/generate` | Generate downtime report |
| POST | `/api/monitor/restart` | Restart the monitoring loop |
| POST | `/api/config/sync-names` | Manually re-sync camera names from NVRs via ISAPI |
| GET | `/api/data/backup` | Download the database as a `.db` file |
| POST | `/api/data/restore` | Restore database from uploaded `.db` file |
| POST | `/api/data/purge/empty` | Wipe database and seed defaults |
| POST | `/api/data/purge/init` | Wipe database and seed from `init_config.json` |
| POST | `/api/test/email` | Send a test email |
| POST | `/api/test/telegram` | Send a test Telegram message |

---

## License

MIT License
