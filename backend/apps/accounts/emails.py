from django.conf import settings
from django.core.mail import send_mail


# ── Brand colours (inline CSS — email clients strip <style> blocks) ──────────

_NAVY  = '#0c1f3d'
_GOLD  = '#c9a84c'
_CREAM = '#faf8f5'
_TEXT  = '#2c3e50'
_MUTED = '#6b7280'


def _base(preheader: str, body_html: str) -> str:
    """Wraps content in a consistent branded email shell."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>DocksBase</title>
</head>
<body style="margin:0;padding:0;background:{_CREAM};font-family:'Helvetica Neue',Arial,sans-serif;">
  <!-- preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;color:{_CREAM};">{preheader}&nbsp;</div>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:{_CREAM};padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Logo header -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:{_NAVY};letter-spacing:-0.5px;">
                DocksBase
              </div>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:10px;padding:40px 44px;
                       box-shadow:0 2px 12px rgba(0,0,0,0.07);">
              {body_html}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;font-size:12px;color:{_MUTED};line-height:1.6;">
              DocksBase · Marina Management Software<br/>
              <a href="https://docksbase.com" style="color:{_MUTED};text-decoration:none;">docksbase.com</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _btn(url: str, label: str) -> str:
    return f"""<table cellpadding="0" cellspacing="0" style="margin:28px 0;">
  <tr>
    <td style="background:{_NAVY};border-radius:6px;">
      <a href="{url}" style="display:inline-block;padding:14px 32px;
         font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;
         font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
        {label}
      </a>
    </td>
  </tr>
</table>"""


def _h1(text: str) -> str:
    return f'<h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:26px;font-weight:700;color:{_NAVY};line-height:1.2;">{text}</h1>'


def _p(text: str) -> str:
    return f'<p style="margin:0 0 16px;font-size:15px;color:{_TEXT};line-height:1.65;">{text}</p>'


def _small(text: str) -> str:
    return f'<p style="margin:16px 0 0;font-size:12px;color:{_MUTED};line-height:1.6;">{text}</p>'


def _divider() -> str:
    return f'<hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:24px 0;"/>'


# ── Email functions ───────────────────────────────────────────────────────────

def send_verification_email(user, token):
    name = user.first_name or user.email
    url  = f"{settings.FRONTEND_URL}/verify-email?token={token}"

    html = _base(
        preheader="Please verify your email address to activate your DocksBase account.",
        body_html=(
            _h1("Confirm your email address") +
            _p(f"Hi {name},") +
            _p("Thanks for signing up for DocksBase. Click the button below to verify your email address and activate your account.") +
            _btn(url, "Verify Email Address →") +
            _divider() +
            _small(f"This link expires in 24 hours. If you didn't create a DocksBase account, you can safely ignore this email.") +
            _small(f"Or copy and paste this URL into your browser:<br/><a href='{url}' style='color:{_NAVY};word-break:break-all;'>{url}</a>")
        ),
    )
    send_mail(
        subject="Confirm your DocksBase account",
        message=(
            f"Hi {name},\n\n"
            "Please verify your email address to activate your DocksBase account:\n\n"
            f"{url}\n\n"
            "This link expires in 24 hours.\n\n"
            "— The DocksBase Team"
        ),
        from_email=None,
        recipient_list=[user.email],
        html_message=html,
    )


def send_welcome_email(user):
    name = user.first_name or user.email
    url  = settings.FRONTEND_URL

    html = _base(
        preheader="Your DocksBase account is active and ready to go.",
        body_html=(
            _h1("You're all set!") +
            _p(f"Hi {name},") +
            _p("Your email is verified and your DocksBase account is active. Log in to finish setting up your marina and start your 30-day free trial.") +
            _btn(url, "Go to DocksBase →") +
            _divider() +
            _small("If you have any questions, reply to this email and we'll help you get started.")
        ),
    )
    send_mail(
        subject="Welcome to DocksBase — you're all set",
        message=(
            f"Hi {name},\n\n"
            "Your DocksBase account is active. Log in to get started:\n\n"
            f"{url}\n\n"
            "— The DocksBase Team"
        ),
        from_email=None,
        recipient_list=[user.email],
        html_message=html,
    )


def send_payment_failed_email(user):
    name        = user.first_name or user.email
    billing_url = f"{settings.FRONTEND_URL}/settings#billing"

    html = _base(
        preheader="We couldn't charge your card — please update your payment details.",
        body_html=(
            _h1("Payment failed") +
            _p(f"Hi {name},") +
            _p("We were unable to charge your card for your DocksBase subscription. To keep your account active, please update your payment details.") +
            _btn(billing_url, "Update Payment Details →") +
            _divider() +
            _small("If you believe this is a mistake or need help, reply to this email and we'll sort it out.")
        ),
    )
    send_mail(
        subject="Action required: DocksBase payment failed",
        message=(
            f"Hi {name},\n\n"
            "We were unable to charge your card for your DocksBase subscription.\n\n"
            f"Please update your payment details: {billing_url}\n\n"
            "— The DocksBase Team"
        ),
        from_email=None,
        recipient_list=[user.email],
        html_message=html,
    )


def send_abandoned_cart_email(user, marina_name, resume_url):
    name = user.first_name or user.email

    html = _base(
        preheader=f"You were so close! Finish setting up {marina_name} on DocksBase.",
        body_html=(
            _h1("You left something behind") +
            _p(f"Hi {name},") +
            _p(f"Looks like you didn't finish setting up <strong>{marina_name}</strong> on DocksBase. Pick up right where you left off — your details are saved.") +
            _btn(resume_url, "Complete Your Setup →") +
            _divider() +
            _small("This link expires in 48 hours. After that you'll need to start a new signup.") +
            _small("Questions? Reply to this email and we'll help.")
        ),
    )
    send_mail(
        subject=f"Finish setting up {marina_name} on DocksBase",
        message=(
            f"Hi {name},\n\n"
            f"Looks like you didn't finish setting up {marina_name}.\n\n"
            f"Pick up where you left off: {resume_url}\n\n"
            "This link expires in 48 hours.\n\n"
            "— The DocksBase Team"
        ),
        from_email=None,
        recipient_list=[user.email],
        html_message=html,
    )
