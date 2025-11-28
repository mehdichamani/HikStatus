# CCTV Mailer - Web Service

A modern web service for monitoring NVR (Network Video Recorder) cameras with email alerts, logging, and a responsive web UI.

This project consists of two main components that run in parallel:
1.  **Flask Web Service** (`app.py`): Provides the web dashboard, login, and API.
2.  **Background Monitor** (`run_background_monitor.py`): A separate process that continuously polls NVRs and updates the database.

## Features

-   **Web Dashboard**: Real-time status monitoring of all cameras.
-   **Advanced Logging**: All events (camera down, NVR error, mail sent) are stored in a SQLite database.
-   **Email Alerts**: Automatic email notifications when cameras go offline.
-   **Configuration Management**: Web interface for managing non-sensitive settings.
-   **Secure**: All passwords and secret keys are loaded from environment variables, not config files.
-   **Translation**: UI supports English and Farsi (`en`/`fa`).

## Setup

1.  **Clone the project**
    ```bash
    git clone [your-repo-url]
    cd cctv-mailer
    ```

2.  **Create Virtual Environment**
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    ```

3.  **Install Dependencies**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Configure Environment Variables**
    This is the most important step for security. Set these in your environment:

    ```bash
    # For app.py (Web UI)
    export SECRET_KEY="a-very-long-and-random-string-for-sessions"
    export MAIL_PASS="your-gmail-app-password"
    
    # For background_monitor.py (NVR Passwords)
    # Format: NVR_PASS_[IP_ADDRESS_WITH_UNDERSCORES]
    export NVR_PASS_172_20_2_2="@A@m1717"
    export NVR_PASS_172_20_2_3="@A@m1717"
    export NVR_PASS_172_20_2_4="@A@m1717"
    export NVR_PASS_172_20_2_5="@A@m1717"
    ```

5.  **Set Web UI Password**
    Run this command and copy the generated hash:
    ```bash
    flask hash-password "YourNewSecurePassword"
    ```
    Paste the resulting hash (starts with `$2b$12$...`) into `config.json` for the `WEB_PASSWORD_HASH` value.

6.  **Initialize Database**
    The database will be created automatically.

7.  **Compile Translations**
    ```bash
    flask compile-translations
    ```

## Running the Service

You must run **two** separate processes.

1.  **Terminal 1: Start the Web Service**
    ```bash
    python app.py
    # OR for production:
    # gunicorn -w 4 -b 0.0.0.0:5000 "app:create_app()"
    ```
    The web UI will be at `http://localhost:5000`.

2.  **Terminal 2: Start the Background Monitor**
    ```bash
    python run_background_monitor.py
    ```
    The monitor will start polling and updating the database.

## File Structure

-   `app.py`: Main Flask application (Web UI).
-   `run_background_monitor.py`: Entry point for the monitoring service.
-   `background_monitor.py`: The monitor logic (polling, alerting).
-   `models.py`: SQLAlchemy database schema.
-   `api.py`: All `/api/...` endpoints.
-   `config.json`: **Non-sensitive** configuration (intervals, NVR IPs/users).
-   `camera_names.csv`: Maps camera IPs to friendly names.
-   `instance/cctv_mailer.db`: SQLite database (auto-created).
-   `templates/` & `static/`: All frontend files.# HikStatus
