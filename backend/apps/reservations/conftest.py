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
def berth_factory():
    from apps.berths.models import Berth

    _counter = [0]

    def _make(marina, **kwargs):
        _counter[0] += 1
        n = _counter[0]
        defaults = {
            'marina': marina,
            'code': f'B{n}',
        }
        defaults.update(kwargs)
        return Berth.objects.create(**defaults)

    return _make
