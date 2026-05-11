from django.apps import AppConfig


class RevenueIntelligenceConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.revenue_intelligence'
    verbose_name = 'Revenue Intelligence'

    def ready(self):
        import apps.revenue_intelligence.signals  # noqa
