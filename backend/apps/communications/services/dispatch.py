from django.utils import timezone
from apps.communications.models import MessageLog


def dispatch(marina, channel, recipient, subject='', body='', member=None,
             booking=None, journey_step=None, whatsapp_template_name=None,
             whatsapp_variables=None) -> MessageLog:
    log = MessageLog.objects.create(
        marina=marina, member=member, booking=booking, journey_step=journey_step,
        channel=channel, recipient=recipient, subject=subject, body=body,
        status=MessageLog.Status.QUEUED,
    )
    try:
        if channel == MessageLog.Channel.EMAIL:
            from apps.communications.adapters.email import send_email
            provider_id = send_email(recipient, subject, body)
        elif channel == MessageLog.Channel.SMS:
            from apps.communications.adapters.sms import send_sms
            provider_id = send_sms(recipient, body)
        elif channel == MessageLog.Channel.WHATSAPP:
            from apps.communications.adapters.whatsapp import send_whatsapp_template
            if not member or not member.whatsapp_opt_in:
                raise ValueError('No WhatsApp opt-in')
            provider_id = send_whatsapp_template(recipient, whatsapp_template_name, whatsapp_variables)
        elif channel in (MessageLog.Channel.SLACK, MessageLog.Channel.TEAMS):
            from apps.communications.adapters.slack_teams import send_webhook
            send_webhook(recipient, body)
            provider_id = ''
        else:
            raise ValueError(f'Unknown channel: {channel}')
        log.status = MessageLog.Status.SENT
        log.provider_message_id = provider_id or ''
        log.sent_at = timezone.now()
    except Exception as e:
        log.status = MessageLog.Status.FAILED
        log.failed_reason = str(e)
    log.save(update_fields=['status', 'provider_message_id', 'sent_at', 'failed_reason'])
    return log
