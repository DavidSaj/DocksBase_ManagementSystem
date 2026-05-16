"""Shared fixtures for waitlist tests."""
from decimal import Decimal
from datetime import timedelta

import pytest
from django.utils import timezone


@pytest.fixture
def marina(db):
    from apps.accounts.models import Marina
    return Marina.objects.create(
        name='Test Marina',
        currency='EUR',
        waitlist_enabled=True,
        waitlist_deposit_cents=7500,
        max_waitlist_declines=3,
    )


@pytest.fixture
def berth(db, marina):
    from apps.berths.models import Berth
    return Berth.objects.create(
        marina=marina, code='A1', length_m=Decimal('12.0'),
        max_beam_m=Decimal('4.0'), max_draft_m=Decimal('2.0'),
    )


@pytest.fixture
def make_entry(db, marina):
    from apps.waitlist.models import WaitlistEntry

    def _make(applied_at=None, deposit_state='unpaid', email=None, name='Test',
              decline_count=0, status='pending', **kwargs):
        applied_at = applied_at or timezone.now()
        entry = WaitlistEntry(
            marina=marina,
            applicant_name=name,
            applicant_email=email or f'{name.lower()}@example.com',
            vessel_loa_m=Decimal('11.0'),
            vessel_beam_m=Decimal('3.5'),
            vessel_draft_m=Decimal('1.5'),
            pref_min_loa_m=Decimal('10.0'),
            pref_max_loa_m=Decimal('13.0'),
            deposit_amount_cents=7500,
            deposit_state=deposit_state,
            deposit_payment_intent_id='pi_test_' + name,
            decline_count=decline_count,
            status=status,
            applied_at=applied_at,
            status_changed_at=applied_at,
            **kwargs,
        )
        entry.refresh_priority()
        entry.save()
        return entry

    return _make


@pytest.fixture
def make_offer(db):
    from apps.waitlist.models import WaitlistOffer

    def _make(entry, berth, expires_in_hours=48, outcome='pending'):
        return WaitlistOffer.objects.create(
            entry=entry, offered_berth=berth,
            expires_at=timezone.now() + timedelta(hours=expires_in_hours),
            outcome=outcome,
        )

    return _make
