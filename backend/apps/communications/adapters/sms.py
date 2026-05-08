def send_sms(recipient, body) -> str:
    from django.conf import settings
    if not getattr(settings, 'TWILIO_ACCOUNT_SID', ''):
        return ''
    from twilio.rest import Client
    client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    msg = client.messages.create(body=body, from_=settings.TWILIO_FROM_NUMBER, to=recipient)
    return msg.sid
