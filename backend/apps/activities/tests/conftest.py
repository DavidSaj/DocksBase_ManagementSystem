import pytest


@pytest.fixture
def marina():
    from apps.accounts.models import Marina
    return Marina.objects.create(name='Test Marina')
