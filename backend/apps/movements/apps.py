from django.apps import AppConfig


class MovementsConfig(AppConfig):
    name = 'apps.movements'
    label = 'movements'
    default_auto_field = 'django.db.models.BigAutoField'

    def ready(self):
        import apps.movements.signals  # noqa: F401
