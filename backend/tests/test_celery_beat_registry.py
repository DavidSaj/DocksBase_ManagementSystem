import pytest


@pytest.mark.django_db
def test_django_celery_beat_in_installed_apps(settings):
    assert 'django_celery_beat' in settings.INSTALLED_APPS, (
        "django_celery_beat must be in INSTALLED_APPS for the DatabaseScheduler to work"
    )
