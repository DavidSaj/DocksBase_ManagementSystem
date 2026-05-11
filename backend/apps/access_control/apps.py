from django.apps import AppConfig


class AccessControlConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.access_control'
    verbose_name = 'Security & Access Control'

    def ready(self):
        import apps.access_control.signals  # noqa: F401
