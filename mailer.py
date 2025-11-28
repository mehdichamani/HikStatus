"""
CCTV Mailer - Mailer Module
Handles sending emails and logging mail events.
"""
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from time_utils import get_tehran_time
from models import db, AlertLog

def send_email(app, recipients, subject, body):
    """
    Sends an email to a list of recipients.
    """
    # Load config from the app context
    sender_email = app.config.get('MAIL_USER')
    smtp_server = app.config.get('MAIL_SERVER')
    smtp_port = app.config.get('MAIL_PORT')
    smtp_user = app.config.get('MAIL_USER')
    smtp_password = app.config.get('MAIL_PASS') # Loaded from config.json by app.py
    use_tls = app.config.get('MAIL_USE_TLS', True) # Default to True

    if not all([sender_email, smtp_server, smtp_port, smtp_user, smtp_password]):
        app.logger.error("SMTP settings are not fully configured in config.json.")
        return False

    message = MIMEMultipart()
    message['From'] = sender_email
    message['To'] = ", ".join(recipients)
    message['Subject'] = subject
    message.attach(MIMEText(body, 'html'))

    try:
        with smtplib.SMTP(smtp_server, smtp_port) as server:
            if use_tls:
                server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(sender_email, recipients, message.as_string())
            app.logger.info(f"Email sent successfully to {', '.join(recipients)}")
            log_mail_event(app, recipients, subject, success=True)
            return True
    except Exception as e:
        app.logger.error(f"Failed to send email: {e}")
        log_mail_event(app, recipients, subject, success=False, error_message=str(e))
        return False

def log_mail_event(app, recipients, subject, success, error_message=None):
    """
    Logs the email sending event to the database.
    """
    with app.app_context():
        try:
            log_entry = AlertLog(
                timestamp=get_tehran_time(),
                alert_type='mail_sent' if success else 'mail_error',
                mail_recipients=', '.join(recipients),
                details=f"Subject: {subject}" if success else f"Error: {error_message}",
                severity='info' if success else 'error'
            )
            db.session.add(log_entry)
            db.session.commit()
        except Exception as e:
            app.logger.error(f"Failed to log mail event to DB: {e}")
            db.session.rollback()