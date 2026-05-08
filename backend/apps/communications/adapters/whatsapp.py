def send_whatsapp_template(recipient, template_name, variables=None) -> str:
    # Stub — implement against Meta Cloud API when WHATSAPP_ACCESS_TOKEN is configured
    from django.conf import settings
    if not getattr(settings, 'WHATSAPP_ACCESS_TOKEN', ''):
        raise ValueError('WhatsApp not configured')
    return ''
