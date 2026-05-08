from django.apps import AppConfig


class RevenueConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.revenue'
    verbose_name = 'Revenue Intelligence'

    def ready(self):
        import apps.revenue.signals  # noqa: F401
