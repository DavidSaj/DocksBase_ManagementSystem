from django.apps import AppConfig


class ChannelsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.channels'
    label = 'ota_channels'

    def ready(self):
        import apps.channels.signals  # noqa: F401
