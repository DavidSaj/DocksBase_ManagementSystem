def send_email(recipient, subject, body) -> str:
    from django.core.mail import send_mail
    send_mail(subject=subject, message=body, from_email=None, recipient_list=[recipient], html_message=body)
    return ''
