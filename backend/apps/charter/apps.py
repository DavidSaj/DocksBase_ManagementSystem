from django.apps import AppConfig


class CharterConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.charter'

    def ready(self):
        import apps.charter.signals  # noqa: F401
