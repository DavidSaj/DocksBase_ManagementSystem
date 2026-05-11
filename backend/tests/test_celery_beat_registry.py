import pytest


@pytest.mark.django_db
def test_django_celery_beat_in_installed_apps(settings):
    assert 'django_celery_beat' in settings.INSTALLED_APPS, (
        "django_celery_beat must be in INSTALLED_APPS for the DatabaseScheduler to work"
    )


@pytest.mark.django_db
def test_all_beat_schedule_tasks_registered(settings):
    """Every task name in CELERY_BEAT_SCHEDULE must be registered with Celery."""
    # Import all task modules to trigger @shared_task registration
    import apps.billing.tasks          # noqa: F401
    import apps.reservations.tasks     # noqa: F401
    import apps.sustainability.tasks   # noqa: F401
    import apps.revenue_intelligence.tasks  # noqa: F401
    import apps.communications.tasks   # noqa: F401
    import apps.channels.tasks         # noqa: F401
    import apps.berths.tasks           # noqa: F401
    import apps.accounting.tasks       # noqa: F401
    import apps.notifications.tasks    # noqa: F401

    from celery import current_app

    missing = []
    for key, config in settings.CELERY_BEAT_SCHEDULE.items():
        task_name = config['task']
        if task_name not in current_app.tasks:
            missing.append((key, task_name))

    assert not missing, (
        "Beat schedule entries pointing at unregistered tasks:\n" +
        "\n".join(f"  beat key '{k}' -> task '{t}'" for k, t in missing)
    )
