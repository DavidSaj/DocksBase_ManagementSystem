import pytest


@pytest.fixture
def marina_factory():
    """Return a callable that creates a Marina with sensible defaults."""
    from apps.accounts.models import Marina

    _counter = [0]

    def _make(**kwargs):
        _counter[0] += 1
        n = _counter[0]
        defaults = {
            'name': f'Test Marina {n}',
            'slug': f'test-marina-{n}',
        }
        defaults.update(kwargs)
        return Marina.objects.create(**defaults)

    return _make


@pytest.fixture
def member_factory(marina_factory):
    """Return a callable that creates a Member with sensible defaults."""
    from apps.members.models import Member

    _counter = [0]

    def _make(**kwargs):
        _counter[0] += 1
        n = _counter[0]
        if 'marina' not in kwargs:
            kwargs['marina'] = marina_factory()
        defaults = {
            'name': f'Test Member {n}',
            'email': f'member{n}@test.com',
        }
        defaults.update(kwargs)
        return Member.objects.create(**defaults)

    return _make
