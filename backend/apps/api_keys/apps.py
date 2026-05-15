from django.apps import AppConfig


class ApiKeysConfig(AppConfig):
    name = 'apps.api_keys'
    default_auto_field = 'django.db.models.BigAutoField'

    def ready(self):
        from . import signals  # noqa: F401
