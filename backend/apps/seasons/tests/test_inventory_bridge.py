"""Phase-3 inventory bridge tests — spec §4.2.

Covers ``apps.berths.availability.berth_lease_inventory_filter`` and its
wiring into ``compatible_available_berths`` and ``SmartBerthScorer``.

Predicate (per spec):

    berth is available for transient on [ci, co) IF
        (no active lease overlaps [ci, co))
      OR (active lease overlaps AND a sublet-enabled TemporaryDeparture
          fully contains [ci, co))
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from apps.berths.availability import berth_lease_inventory_filter
from apps.berths.models import Berth, TemporaryDeparture


def _set_status(lease, status):
    lease.status = status
    lease.save(update_fields=['status'])
    return lease


@pytest.mark.django_db
def test_unleased_berth_passes_through(marina, berth):
    qs = Berth.objects.filter(marina=marina)
    result = berth_lease_inventory_filter(qs, date(2026, 7, 1), date(2026, 7, 5))
    assert berth in list(result)


@pytest.mark.django_db
def test_active_lease_excludes_berth(marina, berth, make_lease):
    _set_status(make_lease(), 'active')

    qs = Berth.objects.filter(marina=marina)
    result = berth_lease_inventory_filter(qs, date(2026, 7, 1), date(2026, 7, 5))
    assert berth not in list(result)


@pytest.mark.django_db
@pytest.mark.parametrize('live_status', ['offered', 'accepted', 'deposit_paid', 'active', 'ending'])
def test_live_statuses_all_exclude_berth(marina, berth, make_lease, live_status):
    _set_status(make_lease(), live_status)

    qs = Berth.objects.filter(marina=marina)
    result = berth_lease_inventory_filter(qs, date(2026, 7, 1), date(2026, 7, 5))
    assert berth not in list(result)


@pytest.mark.django_db
@pytest.mark.parametrize('terminal_status', ['ended', 'renewed', 'cancelled', 'defaulted'])
def test_terminal_lease_statuses_do_not_exclude(marina, berth, make_lease, terminal_status):
    _set_status(make_lease(), terminal_status)

    qs = Berth.objects.filter(marina=marina)
    result = berth_lease_inventory_filter(qs, date(2026, 7, 1), date(2026, 7, 5))
    assert berth in list(result)


@pytest.mark.django_db
def test_lease_outside_window_does_not_exclude(marina, berth, make_lease):
    """Active lease for Summer 2026; we ask about a Winter 2026 window."""
    _set_status(make_lease(), 'active')

    qs = Berth.objects.filter(marina=marina)
    result = berth_lease_inventory_filter(qs, date(2026, 12, 1), date(2026, 12, 5))
    assert berth in list(result)


@pytest.mark.django_db
def test_sublet_window_fully_containing_request_re_opens_berth(marina, berth, member, make_lease):
    """Active lease blocks the berth, but a sublet-enabled TemporaryDeparture
    that fully contains the requested dates puts it back into transient supply.
    """
    _set_status(make_lease(), 'active')

    from apps.vessels.models import Vessel
    vessel = Vessel.objects.create(marina=marina, name='Holder Boat', owner=member)
    TemporaryDeparture.objects.create(
        marina=marina, berth=berth, vessel=vessel, member=member,
        depart_date=date(2026, 6, 25), expected_return=date(2026, 7, 10),
        status='scheduled', sublet_enabled=True,
    )

    qs = Berth.objects.filter(marina=marina)
    result = berth_lease_inventory_filter(qs, date(2026, 7, 1), date(2026, 7, 5))
    assert berth in list(result)


@pytest.mark.django_db
def test_sublet_window_only_partially_containing_does_not_re_open(marina, berth, member, make_lease):
    """The spec requires the departure to *fully* contain the requested window."""
    _set_status(make_lease(), 'active')

    from apps.vessels.models import Vessel
    vessel = Vessel.objects.create(marina=marina, name='Holder Boat', owner=member)
    TemporaryDeparture.objects.create(
        marina=marina, berth=berth, vessel=vessel, member=member,
        depart_date=date(2026, 7, 2),  # starts AFTER ci
        expected_return=date(2026, 7, 10),
        status='scheduled', sublet_enabled=True,
    )

    qs = Berth.objects.filter(marina=marina)
    result = berth_lease_inventory_filter(qs, date(2026, 7, 1), date(2026, 7, 5))
    assert berth not in list(result)


@pytest.mark.django_db
def test_sublet_window_without_enable_flag_does_not_re_open(marina, berth, member, make_lease):
    _set_status(make_lease(), 'active')

    from apps.vessels.models import Vessel
    vessel = Vessel.objects.create(marina=marina, name='Holder Boat', owner=member)
    TemporaryDeparture.objects.create(
        marina=marina, berth=berth, vessel=vessel, member=member,
        depart_date=date(2026, 6, 25), expected_return=date(2026, 7, 10),
        status='scheduled', sublet_enabled=False,
    )

    qs = Berth.objects.filter(marina=marina)
    result = berth_lease_inventory_filter(qs, date(2026, 7, 1), date(2026, 7, 5))
    assert berth not in list(result)


@pytest.mark.django_db
@pytest.mark.parametrize('td_status', ['returned', 'cancelled'])
def test_sublet_in_terminal_status_does_not_re_open(marina, berth, member, make_lease, td_status):
    _set_status(make_lease(), 'active')

    from apps.vessels.models import Vessel
    vessel = Vessel.objects.create(marina=marina, name='Holder Boat', owner=member)
    TemporaryDeparture.objects.create(
        marina=marina, berth=berth, vessel=vessel, member=member,
        depart_date=date(2026, 6, 25), expected_return=date(2026, 7, 10),
        status=td_status, sublet_enabled=True,
    )

    qs = Berth.objects.filter(marina=marina)
    result = berth_lease_inventory_filter(qs, date(2026, 7, 1), date(2026, 7, 5))
    assert berth not in list(result)


@pytest.mark.django_db
def test_compatible_available_berths_uses_filter(marina, berth, make_lease):
    """End-to-end through the legacy allocator: a leased berth is gone from
    the candidate set returned by ``compatible_available_berths``.
    """
    from apps.reservations.booking_engine import compatible_available_berths

    _set_status(make_lease(), 'active')

    result = compatible_available_berths(
        marina, date(2026, 7, 1), date(2026, 7, 5),
        boat_loa=Decimal('10'), boat_beam=Decimal('3.5'),
    )
    assert berth not in list(result)


@pytest.mark.django_db
def test_smart_scorer_uses_filter(marina, berth, make_lease):
    """End-to-end through SmartBerthScorer: same exclusion behaviour."""
    from apps.berths.scorer import SmartBerthScorer

    _set_status(make_lease(), 'active')

    scorer = SmartBerthScorer(
        marina=marina,
        check_in=date(2026, 7, 1),
        check_out=date(2026, 7, 5),
        vessel_params={'loa': Decimal('10'), 'beam': Decimal('3.5'), 'draft': Decimal('1.5')},
    )
    assert berth not in list(scorer.get_available_berths())
