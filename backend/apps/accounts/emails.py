from django.conf import settings


def send_verification_email(user, token):
    """
    FUTURE: Implement with SendGrid or django-ses.
    Send to:   user.email
    Subject:   "Confirm your DocksBase account"
    Body:      Absolute link to /verify-email?token={token}

    SMTP checklist (when ready):
    - Add EMAIL_BACKEND, EMAIL_HOST, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD to Railway env
    - Set DEFAULT_FROM_EMAIL = "noreply@docksbase.com" in settings
    - Replace print() below with django.core.mail.send_mail() or provider SDK
    - Call send_welcome_email(user) from VerifyEmailView on successful verification
    """
    url = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    print(f"[EMAIL STUB] Verification link for {user.email}: {url}")


def send_welcome_email(user):
    """
    FUTURE: Send after email is verified.
    Subject: "Welcome to DocksBase"
    Body:    Getting-started tips, link to the setup guide.
    """
    print(f"[EMAIL STUB] Welcome email for {user.email}")
