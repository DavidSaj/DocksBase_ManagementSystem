import pytest
from apps.accounts.models import Marina, User


@pytest.fixture
def marina(db):
    return Marina.objects.create(name='Test Marina')


@pytest.fixture
def owner_user(marina):
    return User.objects.create_user(
        email='owner@test.com',
        password='x',
        first_name='O',
        marina=marina,
        role='owner',
    )


@pytest.fixture
def manager_user(marina):
    return User.objects.create_user(
        email='manager@test.com',
        password='x',
        first_name='M',
        marina=marina,
        role='manager',
    )


@pytest.fixture
def staff_user(marina):
    return User.objects.create_user(
        email='staff@test.com',
        password='x',
        first_name='S',
        marina=marina,
        role='staff',
    )
