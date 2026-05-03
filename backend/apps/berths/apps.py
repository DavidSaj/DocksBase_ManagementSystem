from django.apps import AppConfig


class BerthsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.berths'

    def ready(self):
        import apps.berths.signals  # noqa: F401 — connects post_save signal
