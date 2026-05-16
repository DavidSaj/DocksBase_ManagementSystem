import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def marina(db):
    from apps.accounts.models import Marina
    return Marina.objects.create(name='Test Marina')


@pytest.fixture
def owner_user(marina):
    from apps.accounts.models import User
    return User.objects.create_user(
        email='owner@test.com',
        password='ownerpass123',
        marina=marina,
        role='owner',
    )


@pytest.fixture
def manager_user(marina):
    from apps.accounts.models import User
    return User.objects.create_user(
        email='manager@test.com',
        password='managerpass123',
        marina=marina,
        role='manager',
    )


@pytest.fixture
def boater_user(marina):
    from apps.accounts.models import User
    return User.objects.create_user(
        email='boater@test.com',
        password='boaterpass123',
        marina=marina,
        role='boater',
    )
