def send_alert(marina_id, alert_type, subject, body, priority='normal'):
    from apps.communications.models import AlertRoute
    routes = AlertRoute.objects.filter(marina_id=marina_id, alert_type=alert_type, is_active=True)
    for route in routes:
        try:
            from apps.communications.services.dispatch import dispatch
            from apps.accounts.models import Marina
            marina = Marina.objects.get(pk=marina_id)
            dispatch(marina=marina, channel=route.platform, recipient=route.webhook_url, body=body, subject=subject)
        except Exception:
            pass
