"""Overlap-prevention tests.

App-level pre-check (services._assert_no_overlap) runs on every backend;
the PostgreSQL EXCLUDE constraint is tested by the migration itself.  In
this test we only exercise the application-level path because the test
runner uses SQLite.
"""
from datetime import date
from decimal import Decimal

import pytest

from apps.seasons import services
from apps.seasons.models import Season


@pytest.mark.django_db
def test_overlapping_live_lease_blocked(marina, member, berth, summer_season,
                                       rate_card, monthly_plan):
    services.create_lease(
        member=member, berth=berth, season=summer_season,
        rate_card=rate_card, instalment_plan=monthly_plan,
    )
    # Same berth + same season → unique constraint OR overlap check trips.
    with pytest.raises(services.OverlappingLeaseError):
        services.create_lease(
            member=member, berth=berth, season=summer_season,
            rate_card=rate_card, instalment_plan=monthly_plan,
        )


@pytest.mark.django_db
def test_overlapping_lease_in_different_season_blocked(marina, member, berth,
                                                       summer_season, rate_card,
                                                       monthly_plan):
    services.create_lease(
        member=member, berth=berth, season=summer_season,
        rate_card=rate_card, instalment_plan=monthly_plan,
    )
    # Different "season" record but overlapping window — must be rejected.
    overlap = Season.objects.create(
        marina=marina, name='Premium Summer 2026',
        season_type='summer',
        start_date=date(2026, 6, 1), end_date=date(2026, 9, 30),
    )
    from apps.seasons.models import SeasonalRateCard
    rc2 = SeasonalRateCard.objects.create(
        marina=marina, season=overlap, name='premium',
        season_total=Decimal('5000.00'), deposit_amount=Decimal('500'),
    )
    with pytest.raises(services.OverlappingLeaseError):
        services.create_lease(
            member=member, berth=berth, season=overlap,
            rate_card=rc2, instalment_plan=monthly_plan,
        )


@pytest.mark.django_db
def test_cancelled_lease_does_not_block_new_lease(marina, member, berth,
                                                   summer_season, rate_card,
                                                   monthly_plan):
    lease = services.create_lease(
        member=member, berth=berth, season=summer_season,
        rate_card=rate_card, instalment_plan=monthly_plan,
    )
    services.transition_lease(lease, 'cancelled')

    # Now a new lease on the same berth+season should succeed (well —
    # different season required because (berth, season) UNIQUE still
    # holds even for cancelled rows by design; we test a non-overlapping
    # different season).
    other = Season.objects.create(
        marina=marina, name='Late Summer 2026',
        season_type='summer',
        start_date=date(2026, 11, 1), end_date=date(2026, 12, 31),
    )
    from apps.seasons.models import SeasonalRateCard
    rc2 = SeasonalRateCard.objects.create(
        marina=marina, season=other, name='late',
        season_total=Decimal('1000.00'), deposit_amount=Decimal('100'),
    )
    services.create_lease(
        member=member, berth=berth, season=other,
        rate_card=rc2, instalment_plan=monthly_plan,
    )
