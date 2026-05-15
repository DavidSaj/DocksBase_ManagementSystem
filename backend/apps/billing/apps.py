from django.apps import AppConfig


class BillingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.billing'

    def ready(self):
        # Connects post_save(Invoice) and invoice_paid receivers for
        # payment_invoice_issued / payment_received notification rules.
        from . import receivers  # noqa: F401
