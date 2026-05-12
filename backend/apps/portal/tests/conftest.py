import pytest
import datetime as _dt


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


@pytest.fixture
def invoice_factory():
    from apps.billing.models import Invoice

    _counter = [0]

    def make(member, marina, status='unpaid', due_date=None, total='100.00'):
        _counter[0] += 1
        n = _counter[0]
        return Invoice.objects.create(
            member=member,
            marina=marina,
            status=status,
            due_date=due_date or (_dt.date.today() + _dt.timedelta(days=30)),
            total=total,
            subtotal=total,
            tax_total='0.00',
            invoice_number=f'INV-TEST-{n:04d}',
        )
    return make


@pytest.fixture
def vessel_factory():
    from apps.vessels.models import Vessel

    _counter = [0]

    def _make(member, **kwargs):
        _counter[0] += 1
        n = _counter[0]
        defaults = {
            'marina': member.marina,
            'name': f'Test Vessel {n}',
            'owner': member,
        }
        defaults.update(kwargs)
        return Vessel.objects.create(**defaults)

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


@pytest.fixture
def booking_factory(vessel_factory, berth_factory):
    from apps.reservations.models import Booking
    import datetime as _dt

    def _make(member, **kwargs):
        vessel = kwargs.pop('vessel', vessel_factory(member))
        berth  = kwargs.pop('berth', berth_factory(member.marina))
        today  = _dt.date.today()
        defaults = {
            'marina':    member.marina,
            'vessel':    vessel,
            'berth':     berth,
            'check_in':  today - _dt.timedelta(days=2),
            'check_out': today + _dt.timedelta(days=5),
            'status':    'checked_in',
        }
        defaults.update(kwargs)
        return Booking.objects.create(**defaults)

    return _make


@pytest.fixture
def guest_booking_factory():
    from apps.reservations.models import Booking
    import datetime as _dt

    _counter = [0]

    def _make(marina, **kwargs):
        _counter[0] += 1
        n = _counter[0]
        today = _dt.date.today()
        defaults = {
            'marina':      marina,
            'check_in':    today,
            'check_out':   today + _dt.timedelta(days=3),
            'status':      'confirmed',
            'guest_name':  f'Guest {n}',
            'guest_email': f'guest{n}@test.com',
        }
        defaults.update(kwargs)
        return Booking.objects.create(**defaults)

    return _make
