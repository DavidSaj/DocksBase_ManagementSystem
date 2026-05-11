from django.apps import AppConfig


class SustainabilityConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.sustainability'
    verbose_name = 'Sustainability & ESG'

    def ready(self):
        import apps.sustainability.signals  # noqa: F401
