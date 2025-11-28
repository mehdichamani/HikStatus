import smtplib
import json
import os
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# --- Configuration ---
CONFIG_FILE = "config.json"
# ---------------------

def load_config():
    """Loads main and secure config files."""
    print(f"--- Loading Configuration ---")
    
    # 1. Load main config.json
    if not os.path.exists(CONFIG_FILE):
        print(f"Error: '{CONFIG_FILE}' not found.")
        return None
    
    try:
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)
        print(f"Successfully loaded '{CONFIG_FILE}'.")
    except Exception as e:
        print(f"Error reading '{CONFIG_FILE}': {e}")
        return None

    # 2. Load secure config
    secure_path = config.get('SECURITY_CONFIG_PATH')
    if not secure_path:
        print(f"Error: 'SECURITY_CONFIG_PATH' not set in '{CONFIG_FILE}'.")
        return None
        
    secure_path_norm = os.path.normpath(secure_path)
    if not os.path.exists(secure_path_norm):
        print(f"Error: Secure config file not found at: {secure_path_norm}")
        return None
        
    try:
        with open(secure_path_norm, 'r') as f:
            secure_config = json.load(f)
        print(f"Successfully loaded secure config from: {secure_path_norm}")
    except Exception as e:
        print(f"Error reading secure config '{secure_path_norm}': {e}")
        return None
        
    # 3. Merge configs
    config.update(secure_config)
    return config

def send_test_email(config):
    """Connects to SMTP server and sends a test email."""
    
    # Extract settings
    sender_email = config.get('MAIL_USER')
    smtp_server = config.get('MAIL_SERVER')
    smtp_port = config.get('MAIL_PORT')
    smtp_password = config.get('MAIL_PASS')
    recipients = config.get('MAIL_RECIPIENTS')
    
    if not all([sender_email, smtp_server, smtp_port, smtp_password, recipients]):
        print("\nError: Mail configuration is incomplete.")
        print(f"  MAIL_USER: {'OK' if sender_email else 'MISSING'}")
        print(f"  MAIL_SERVER: {'OK' if smtp_server else 'MISSING'}")
        print(f"  MAIL_PORT: {'OK' if smtp_port else 'MISSING'}")
        print(f"  MAIL_PASS: {'OK' if smtp_password else 'MISSING'}")
        print(f"  MAIL_RECIPIENTS: {'OK' if recipients else 'MISSING'}")
        return

    print(f"\n--- Attempting to Send Email ---")
    print(f"  Host: {smtp_server}")
    print(f"  Port: {smtp_port}")
    print(f"  User: {sender_email}")
    print(f"  To: {', '.join(recipients)}")
    
    # Create message
    message = MIMEMultipart()
    message['From'] = sender_email
    message['To'] = ", ".join(recipients)
    message['Subject'] = "CCTV Mailer - Test Email"
    body = "This is a test email from the CCTV Mailer test script. If you received this, your settings are correct!"
    message.attach(MIMEText(body, 'plain'))
    
    try:
        # Create a secure SSL context
        context = ssl.create_default_context()
        
        print(f"\n1. Connecting to {smtp_server}:{smtp_port}...")
        # Use smtplib.SMTP for port 587 (STARTTLS)
        if smtp_port == 587:
            with smtplib.SMTP(smtp_server, smtp_port, timeout=10) as server:
                print("2. Starting TLS (secure connection)...")
                server.starttls(context=context)
                print("3. Logging in...")
                server.login(sender_email, smtp_password)
                print("4. Sending email...")
                server.sendmail(sender_email, recipients, message.as_string())
        # Use smtplib.SMTP_SSL for port 465 (SSL)
        elif smtp_port == 465:
             with smtplib.SMTP_SSL(smtp_server, smtp_port, context=context, timeout=10) as server:
                print("2. Logging in...")
                server.login(sender_email, smtp_password)
                print("3. Sending email...")
                server.sendmail(sender_email, recipients, message.as_string())
        else:
            print(f"Error: Unsupported port {smtp_port}. Use 587 (STARTTLS) or 465 (SSL).")
            return

        print("\n--- ✅ SUCCESS ---")
        print("Email sent successfully!")

    except smtplib.SMTPAuthenticationError as e:
        print("\n--- ❌ SMTP AUTHENTICATION ERROR ---")
        print(f"Error: {e}")
        print("This means the server connected, but your 'MAIL_USER' or 'MAIL_PASS' is incorrect.")
        print("If using Gmail, ensure you are using an 'App Password'.")
        
    except smtplib.socket.gaierror as e:
        print("\n--- ❌ NETWORK ERROR (getaddrinfo failed) ---")
        print(f"Error: {e}")
        print("This is the *exact* error you are seeing.")
        print("It means Python could not find the host 'smtp.gmail.com'.")
        print("Check:")
        print("  1. Is the server connected to the internet?")
        print("  2. Is the DNS service on the server working correctly?")
        print("  3. Is 'MAIL_SERVER' in config.json spelled correctly?")

    except smtplib.socket.timeout:
        print("\n--- ❌ NETWORK TIMEOUT ---")
        print("Error: The connection timed out.")
        print("This usually means a Firewall is blocking the connection to port 587.")
        print("Check:")
        print("  1. Windows Defender Firewall (Outbound Rules).")
        print("  2. Any other antivirus or network firewall.")
        
    except Exception as e:
        print(f"\n--- ❌ UNEXPECTED ERROR ---")
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    main_config = load_config()
    if main_config:
        send_test_email(main_config)