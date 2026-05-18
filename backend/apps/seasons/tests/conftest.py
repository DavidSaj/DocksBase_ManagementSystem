"""Fixtures for the seasons app tests."""
from datetime import date
from decimal import Decimal

import pytest


@pytest.fixture
def marina(db):
    from apps.accounts.models import Marina
    return Marina.objects.create(name='Test Marina', currency='EUR')


@pytest.fixture
def member(db, marina):
    from apps.members.models import Member
    return Member.objects.create(
        marina=marina, name='Alice Skipper', email='alice@example.com',
        member_type='seasonal',
    )


@pytest.fixture
def berth(db, marina):
    from apps.berths.models import Berth
    return Berth.objects.create(
        marina=marina, code='A1', length_m=Decimal('12.0'),
        max_beam_m=Decimal('4.0'), max_draft_m=Decimal('2.0'),
    )


@pytest.fixture
def summer_season(db, marina):
    from apps.seasons.models import Season
    return Season.objects.create(
        marina=marina, name='Summer 2026', season_type='summer',
        start_date=date(2026, 5, 1), end_date=date(2026, 10, 31),
    )


@pytest.fixture
def rate_card(db, marina, summer_season):
    from apps.seasons.models import SeasonalRateCard
    return SeasonalRateCard.objects.create(
        marina=marina, season=summer_season,
        name='Summer 2026 — 10–12m', min_length_m=Decimal('10'),
        max_length_m=Decimal('12'),
        season_total=Decimal('4500.00'),
        deposit_amount=Decimal('500.00'),
    )


@pytest.fixture
def monthly_plan(db, marina):
    from apps.seasons.models import InstalmentPlan
    return InstalmentPlan.objects.create(
        marina=marina, name='Monthly × 6', frequency='monthly',
        instalment_count=6, first_due_offset_days=0, deposit_first=True,
    )


@pytest.fixture
def make_lease(db, marina, member, berth, summer_season, rate_card, monthly_plan):
    from apps.seasons import services

    def _make(**overrides):
        kwargs = dict(
            member=member, berth=berth, season=summer_season,
            rate_card=rate_card, instalment_plan=monthly_plan,
        )
        kwargs.update(overrides)
        return services.create_lease(**kwargs)
    return _make
