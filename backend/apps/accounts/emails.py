from django.conf import settings
from django.core.mail import send_mail


def send_verification_email(user, token):
    url = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    send_mail(
        subject="Confirm your DocksBase account",
        message=f"Hi {user.first_name or user.email},\n\nClick the link below to verify your email address:\n\n{url}\n\nThis link expires in 24 hours.\n\n— The DocksBase Team",
        from_email=None,  # uses DEFAULT_FROM_EMAIL
        recipient_list=[user.email],
    )


def send_welcome_email(user):
    send_mail(
        subject="Welcome to DocksBase",
        message=f"Hi {user.first_name or user.email},\n\nYour account is verified and ready to go. Log in to finish setting up your marina:\n\n{settings.FRONTEND_URL}\n\n— The DocksBase Team",
        from_email=None,
        recipient_list=[user.email],
    )
