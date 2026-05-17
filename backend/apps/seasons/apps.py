from django.apps import AppConfig


class SeasonsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.seasons'
    verbose_name = 'Seasonal Berths'

    def ready(self):
        # Wire signal receivers for access-control side effects.
        from . import receivers  # noqa: F401
