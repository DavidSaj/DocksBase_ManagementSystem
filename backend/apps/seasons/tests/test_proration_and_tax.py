"""Pro-ration and tax-exempt inheritance tests (locked decisions §9.6, §9.12)."""
from datetime import date
from decimal import Decimal

import pytest

from apps.seasons import services
from apps.seasons.models import Season


@pytest.mark.django_db
def test_mid_start_prorates_by_remaining_days(marina, summer_season, rate_card):
    # Lease 1 Aug–31 Oct (92 days) of a 184-day season → 92/184 = 0.5.
    totals = services.prorate_for_mid_start(
        rate_card=rate_card, season=summer_season,
        lease_start=date(2026, 8, 1), lease_end=date(2026, 10, 31),
        charge_full_season_on_mid_start=False,
    )
    assert totals.season_total == Decimal('2250.00')
    # Deposit is never pro-rated.
    assert totals.deposit_amount == Decimal('500.00')


@pytest.mark.django_db
def test_full_season_flag_overrides_proration(marina, summer_season, rate_card):
    totals = services.prorate_for_mid_start(
        rate_card=rate_card, season=summer_season,
        lease_start=date(2026, 8, 1), lease_end=date(2026, 10, 31),
        charge_full_season_on_mid_start=True,
    )
    assert totals.season_total == Decimal('4500.00')


@pytest.mark.django_db
def test_marina_flag_controls_proration_in_create_lease(marina, member, berth,
                                                         summer_season, rate_card,
                                                         monthly_plan):
    marina.charge_full_season_on_mid_start = True
    marina.save()
    lease = services.create_lease(
        member=member, berth=berth, season=summer_season,
        rate_card=rate_card, instalment_plan=monthly_plan,
        start_date=date(2026, 8, 1), end_date=date(2026, 10, 31),
    )
    assert lease.season_total == Decimal('4500.00')


@pytest.mark.django_db
def test_tax_exempt_inheritance_from_season(marina, member, berth, monthly_plan):
    s = Season.objects.create(
        marina=marina, name='Annual 2026', season_type='annual',
        start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        is_tax_exempt_default=True,
    )
    from apps.seasons.models import SeasonalRateCard
    rc = SeasonalRateCard.objects.create(
        marina=marina, season=s, name='annual',
        season_total=Decimal('9000.00'), deposit_amount=Decimal('1000'),
    )
    lease = services.create_lease(
        member=member, berth=berth, season=s, rate_card=rc,
        instalment_plan=monthly_plan,
    )
    assert lease.tax_exempt_override is True


@pytest.mark.django_db
def test_explicit_override_beats_season_default(marina, member, berth, monthly_plan):
    s = Season.objects.create(
        marina=marina, name='Annual 2026 mixed', season_type='annual',
        start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        is_tax_exempt_default=True,
    )
    from apps.seasons.models import SeasonalRateCard
    rc = SeasonalRateCard.objects.create(
        marina=marina, season=s, name='annual',
        season_total=Decimal('9000.00'), deposit_amount=Decimal('1000'),
    )
    lease = services.create_lease(
        member=member, berth=berth, season=s, rate_card=rc,
        instalment_plan=monthly_plan,
        tax_exempt_override=False,
    )
    assert lease.tax_exempt_override is False
