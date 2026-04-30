from django.apps import AppConfig


class ReservationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.reservations'

    def ready(self):
        from apps.billing.signals import invoice_paid
        from .receivers import on_invoice_paid
        invoice_paid.connect(on_invoice_paid)
