from django.apps import AppConfig


class ReservationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.reservations'

    def ready(self):
        from apps.billing.signals import invoice_paid
        from .receivers import on_invoice_paid, on_booking_save  # noqa: F401
        invoice_paid.connect(on_invoice_paid, dispatch_uid='reservations.on_invoice_paid')
        # on_booking_save is connected via @receiver decorator — importing it registers it
        import apps.notifications.signals  # noqa: F401
