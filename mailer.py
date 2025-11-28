import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import logging

def send_email(config, recipients, subject, body):
    """
    Sends an email using the configuration provided.
    """
    sender_email = config.get('MAIL_USER')
    smtp_server = config.get('MAIL_SERVER')
    smtp_port = config.get('MAIL_PORT')
    smtp_user = config.get('MAIL_USER')
    smtp_password = config.get('MAIL_PASS')
    use_tls = config.get('MAIL_USE_TLS', True)

    if not all([sender_email, smtp_server, smtp_port, smtp_user, smtp_password, recipients]):
        logging.error("Mail configuration incomplete or no recipients.")
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
        return True
    except Exception as e:
        logging.error(f"Failed to send email: {e}")
        return False