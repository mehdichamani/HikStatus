"""
Mail Tester
Tests email configuration in config.json
"""
import json
import os
from mailer import send_email
from colors import LogStyle

CONFIG_FILE = 'config.json'

def test_mail():
    if not os.path.exists(CONFIG_FILE):
        print(f"{LogStyle.FATAL_ERROR} Config file {CONFIG_FILE} not found.")
        return

    with open(CONFIG_FILE, 'r') as f:
        config = json.load(f)

    recipients = config.get("MAIL_RECIPIENTS", [])
    if not recipients:
        print(f"{LogStyle.ERROR} No recipients found in config.json.")
        return

    print("--- Mail Tester ---")
    print(f"From: {config.get('MAIL_USER')}")
    print(f"To:   {recipients}")
    print("Sending test email...")

    subject = "✅ CCTV Monitor Test Email"
    body = """
    <h3>Test Successful</h3>
    <p>This is a test email from the CCTV Monitor system.</p>
    <p>If you are reading this, your SMTP configuration is correct.</p>
    """

    success = send_email(config, recipients, subject, body)

    if success:
        print(f"\n{LogStyle.SUCCESS} Email sent successfully!")
    else:
        print(f"\n{LogStyle.FAIL} Failed to send email. Check your settings.")

if __name__ == "__main__":
    test_mail()