from django.apps import AppConfig


class BoatyardConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.boatyard'

    def ready(self):
        import apps.boatyard.signals  # noqa
