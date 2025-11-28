"""
CCTV Mailer Web Service - Flask Application
Main entry point for the web service with background monitoring.
"""

from time_utils import get_tehran_time, format_datetime, format_persian_datetime, get_formatted_tehran_time
import json
import os
import signal
import threading
from datetime import timedelta
from pathlib import Path
import click

from flask import Flask, render_template, jsonify, request, session, redirect, url_for, flash
from flask_cors import CORS
from flask_wtf.csrf import CSRFProtect, CSRFError
from flask_babel import Babel, get_locale  # Import get_locale here

# ... (imports)
from models import db, AlertLog, CameraState, CheckRecord
from monitor_manager import start_monitor_thread

def select_locale(): # Renamed from get_locale to avoid conflict
    """Selects the user's preferred language."""
    return session.get('language', 'en')

def load_secure_config(app, config_path):
    """Loads the secure config file and updates the app config."""
    try:
        # Normalize path for OS
        normalized_path = os.path.normpath(config_path)
        with open(normalized_path) as f:
            secure_config = json.load(f)
        
        # Load secrets into app.config
        app.config.update(secure_config)
        print(f"Successfully loaded secure config from: {normalized_path}")
        return True
    except FileNotFoundError:
        print(f"FATAL: Security config file not found at: {normalized_path}")
        return False
    except Exception as e:
        print(f"FATAL: Error loading security config: {e}")
        return False

def create_app(config_file="config.json"):
    """Create and configure the Flask application."""
    app = Flask(__name__, instance_relative_config=True)
    
    # Ensure instance folder exists
    try:
        os.makedirs(app.instance_path)
    except OSError:
        pass

    # Load non-sensitive config from config.json
    try:
        with open(config_file) as f:
            app.config.update(json.load(f))
    except FileNotFoundError:
        print(f"FATAL: Main {config_file} not found.")
        return None

    # Load sensitive config from the path specified in config.json
    security_path = app.config.get('SECURITY_CONFIG_PATH')
    if not security_path or not load_secure_config(app, security_path):
        return None # Stop if secure config fails to load

    # Database Config
    db_path = os.path.join(app.instance_path, 'cctv_mailer.db')
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    
    # Language Config
    app.config['JSON_SORT_KEYS'] = False
    app.config['LANGUAGES'] = ['en', 'fa']
    app.config['BABEL_DEFAULT_LOCALE'] = 'en'
    
    # Initialize extensions
    db.init_app(app)
    CORS(app)
    csrf = CSRFProtect(app)
    babel = Babel(app, locale_selector=select_locale) # Use the new function name
    
    # --- FIX: Inject get_locale into templates ---
    @app.context_processor
    def inject_babel_utilities():
        """Injects Babel's get_locale() and custom time formatters into templates."""
        return dict(
            get_locale=get_locale,
            format_datetime=format_datetime,
            format_persian_datetime=format_persian_datetime
        )
    # ---------------------------------------------
    
    # CSRF error handler
    @app.errorhandler(CSRFError)
    def handle_csrf_error(e):
        return jsonify({'success': False, 'error': 'CSRF token invalid or missing'}), 400
    
    # Create database tables
    with app.app_context():
        db.create_all()
    
    app.config_file = config_file
    
    # Register blueprints
    from api import api_bp
    app.register_blueprint(api_bp, url_prefix='/api')
    
    @app.route('/language/<lang>')
    def set_language(lang):
        if lang in app.config['LANGUAGES']:
            session['language'] = lang
        return redirect(request.referrer or url_for('index'))

    # Routes
    @app.route('/login', methods=['GET', 'POST'])
    def login():
        if request.method == 'POST':
            password = request.form.get('password')
            web_password = app.config.get('WEB_PASSWORD') # Loaded from secure config
            
            if web_password and password == web_password:
                session['logged_in'] = True
                return redirect(url_for('index'))
            else:
                flash('Invalid password')
        return render_template('login.html')

    @app.route('/logout')
    def logout():
        session.pop('logged_in', None)
        return redirect(url_for('login'))

    @app.route('/')
    def index():
        """Serve main web UI."""
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return render_template('index.html')
    
    @app.route('/health')
    def health():
        """Health check endpoint."""
        return jsonify({
            'status': 'healthy',
            'timestamp': get_formatted_tehran_time()
        })
    
    @app.route('/api/change_password', methods=['POST'])
    def change_password():
        if not session.get('logged_in'):
            return jsonify({'error': 'Unauthorized'}), 401
        
        new_password = request.json.get('new_password')
        if not new_password:
            return jsonify({'error': 'New password is required'}), 400
        
        secure_config_path = app.config.get('SECURITY_CONFIG_PATH')
        if not secure_config_path:
            return jsonify({'error': 'Security config path not set'}), 500
            
        try:
            # Read, update, and write the secure config file
            secure_path_norm = os.path.normpath(secure_config_path)
            with open(secure_path_norm, 'r+') as f:
                config = json.load(f)
                config['WEB_PASSWORD'] = new_password
                f.seek(0)
                json.dump(config, f, indent=2)
                f.truncate()
            
            # Update running app config
            app.config['WEB_PASSWORD'] = new_password
        except Exception as e:
            print(f"Error writing to secure config: {e}")
            return jsonify({'error': 'Failed to write to secure config file'}), 500
            
        return jsonify({'message': 'Password changed successfully'})
    
    # --- CLI Commands for Translation ---

    @app.cli.command("init-translations")
    def init_translations():
        """Initializes translation files."""
        os.system("pybabel extract -F babel.cfg -o messages.pot .")
        os.system("pybabel init -i messages.pot -d translations -l en")
        os.system("pybabel init -i messages.pot -d translations -l fa")
        os.remove("messages.pot")

    @app.cli.command("update-translations")
    def update_translations():
        """Updates translation files."""
        os.system("pybabel extract -F babel.cfg -o messages.pot .")
        os.system("pybabel update -i messages.pot -d translations")
        os.remove("messages.pot")

    @app.cli.command("compile-translations")
    def compile_translations():
        """Compiles translation files."""
        os.system("pybabel compile -d translations")

    # --- Start Background Monitor Thread ---
    if not app.debug or os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        start_monitor_thread(app)

    return app


def run_web_service(config_file="config.json", host='0.0.0.0', port=5000, debug=False):
    """
    Start the web service AND the background monitor.
    """
    app = create_app(config_file)
    if app is None:
        print("Exiting due to configuration error.")
        return

    print(f"\n{'='*50}")
    print(f"CCTV Mailer Service (Web UI + Monitor)")
    print(f"{'='*50}")
    print(f"Web UI: http://{host}:{port}")
    print(f"Health: http://{host}:{port}/health")
    print(f"Running as a single process. Monitor is in a background thread.")
    print(f"{'='*50}\n")
    
    try:
        app.run(host=host, port=port, debug=debug, use_reloader=False)
    except KeyboardInterrupt:
        print("\n\nShutting down...")
        print("Service stopped.")


if __name__ == '__main__':
    run_web_service(debug=False)