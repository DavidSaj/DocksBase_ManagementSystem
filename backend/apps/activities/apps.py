from django.apps import AppConfig


class ActivitiesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.activities'

    def ready(self):
        import apps.activities.signals  # noqa: F401
        # Staff shift signals — connect explicitly to avoid import ordering issues
        from django.db.models.signals import post_save, post_delete
        from apps.staff.models import Shift
        from apps.activities.signals import on_shift_modified
        post_save.connect(on_shift_modified, sender=Shift, dispatch_uid='activities.on_shift_save')
        post_delete.connect(on_shift_modified, sender=Shift, dispatch_uid='activities.on_shift_delete')
