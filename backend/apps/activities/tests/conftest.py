import pytest


@pytest.fixture
def marina():
    from apps.accounts.models import Marina
    return Marina.objects.create(name='Test Marina')


@pytest.fixture
def manager_user(marina):
    from apps.accounts.models import User
    return User.objects.create_user(
        email='manager@testmarina.com',
        password='testpass123',
        marina=marina,
        role='manager',
    )
