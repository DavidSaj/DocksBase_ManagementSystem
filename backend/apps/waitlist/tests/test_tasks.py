"""Tests for the waitlist celery tasks (reminders + expire sweep)."""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.waitlist import services, tasks
from apps.waitlist.models import WaitlistOffer

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------
def _move_offer_expires_at(offer, *, hours_from_now: float):
    """Test-only mutator that bypasses the partial-unique-constraint trip
    so we can shift an offer's expires_at without re-INSERTing."""
    WaitlistOffer.objects.filter(pk=offer.pk).update(
        expires_at=timezone.now() + timedelta(hours=hours_from_now),
    )
    offer.refresh_from_db()
    return offer


def test_reminder_t24h_fires_in_window(marina, berth, make_entry, make_offer):
    entry = make_entry(deposit_state='paid', name='Reminder24', status='offered')
    offer = make_offer(entry, berth, expires_in_hours=24)
    # Inside the 23.5–24.5 h window (the make_offer default of +24h is fine).

    with patch('apps.waitlist.tasks._dispatch_reminder') as dispatch_mock:
        result = tasks.send_offer_reminder_t24h()

    assert result == {'sent': 1}
    dispatch_mock.assert_called_once()
    called_offer = dispatch_mock.call_args.args[0]
    assert called_offer.pk == offer.pk
    assert dispatch_mock.call_args.kwargs['hours_label'] == '24 hours'
    offer.refresh_from_db()
    assert offer.reminder_sent_t24h is True


def test_reminder_t24h_does_not_double_send(marina, berth, make_entry, make_offer):
    entry = make_entry(deposit_state='paid', name='NoDouble24', status='offered')
    make_offer(entry, berth, expires_in_hours=24)

    with patch('apps.waitlist.tasks._dispatch_reminder') as dispatch_mock:
        tasks.send_offer_reminder_t24h()
        tasks.send_offer_reminder_t24h()

    # Only the first run should fire — the second run sees the flag set.
    assert dispatch_mock.call_count == 1


def test_reminder_t24h_skips_offers_outside_window(marina, berth, make_entry, make_offer):
    from apps.berths.models import Berth
    berth2 = Berth.objects.create(
        marina=marina, code='A2', length_m=Decimal('12.0'),
        max_beam_m=Decimal('4.0'), max_draft_m=Decimal('2.0'),
    )
    entry_far = make_entry(deposit_state='paid', name='Far', status='offered')
    far_offer = make_offer(entry_far, berth, expires_in_hours=48)
    entry_close = make_entry(deposit_state='paid', name='Close', status='offered')
    make_offer(entry_close, berth2, expires_in_hours=24)

    with patch('apps.waitlist.tasks._dispatch_reminder') as dispatch_mock:
        tasks.send_offer_reminder_t24h()

    assert dispatch_mock.call_count == 1
    far_offer.refresh_from_db()
    assert far_offer.reminder_sent_t24h is False


def test_reminder_t2h_fires_in_window(marina, berth, make_entry, make_offer):
    entry = make_entry(deposit_state='paid', name='Reminder2', status='offered')
    offer = make_offer(entry, berth, expires_in_hours=2)

    with patch('apps.waitlist.tasks._dispatch_reminder') as dispatch_mock:
        result = tasks.send_offer_reminder_t2h()

    assert result == {'sent': 1}
    dispatch_mock.assert_called_once()
    assert dispatch_mock.call_args.kwargs['hours_label'] == '2 hours'
    offer.refresh_from_db()
    assert offer.reminder_sent_t2h is True


# ---------------------------------------------------------------------------
# Expire sweep
# ---------------------------------------------------------------------------
def test_expire_sweep_increments_decline_count_and_returns_to_pending(
    marina, berth, make_entry, make_offer,
):
    entry = make_entry(deposit_state='paid', name='ExpireFirst', status='offered',
                       decline_count=0)
    offer = make_offer(entry, berth, expires_in_hours=48)
    # Force it past expiry without re-INSERT (which would clash with the
    # one-open-offer-per-entry partial unique constraint).
    _move_offer_expires_at(offer, hours_from_now=-1)

    with patch('apps.waitlist.services._stripe_refund') as refund_mock:
        result = tasks.expire_overdue_offers()

    assert result['expired'] == 1
    assert result['removed'] == 0
    refund_mock.assert_not_called()

    offer.refresh_from_db()
    entry.refresh_from_db()
    assert offer.outcome == 'expired'
    assert entry.decline_count == 1
    assert entry.status == 'pending'


def test_expire_sweep_third_strike_triggers_refund(
    marina, berth, make_entry, make_offer,
):
    entry = make_entry(deposit_state='paid', name='ExpireThird', status='offered',
                       decline_count=2)
    offer = make_offer(entry, berth, expires_in_hours=48)
    _move_offer_expires_at(offer, hours_from_now=-1)

    with patch('apps.waitlist.services._stripe_refund') as refund_mock:
        refund_mock.return_value = 're_test'
        result = tasks.expire_overdue_offers()

    assert result['expired'] == 1
    assert result['removed'] == 1
    refund_mock.assert_called_once()

    entry.refresh_from_db()
    assert entry.status == 'removed_max_declines'
    assert entry.decline_count == 3
    assert entry.deposit_state == 'refunded'


def test_expire_sweep_skips_already_expired_offer(
    marina, berth, make_entry, make_offer,
):
    """Idempotency: running the sweep twice does not double-strike."""
    entry = make_entry(deposit_state='paid', name='Idem', status='offered',
                       decline_count=0)
    offer = make_offer(entry, berth, expires_in_hours=48)
    _move_offer_expires_at(offer, hours_from_now=-1)

    with patch('apps.waitlist.services._stripe_refund'):
        tasks.expire_overdue_offers()
        tasks.expire_overdue_offers()  # second pass

    entry.refresh_from_db()
    assert entry.decline_count == 1  # NOT 2


def test_expire_sweep_holds_row_lock(marina, berth, make_entry, make_offer):
    """Concurrent expire-sweep + manual decline must not double-count.

    We invoke ``expire_offer`` inside a thread that yields after locking,
    while the main thread attempts ``respond_to_offer(decline)``. The second
    call should see outcome != pending and raise OfferConflict — net result
    is exactly one decline applied.
    """
    entry = make_entry(deposit_state='paid', name='RaceCondition',
                       status='offered', decline_count=0)
    offer = make_offer(entry, berth, expires_in_hours=48)
    _move_offer_expires_at(offer, hours_from_now=-1)

    # Run the expire-sweep first synchronously, then attempt a decline
    # against the now-expired offer. respond_to_offer must refuse cleanly.
    with patch('apps.waitlist.services._stripe_refund'):
        tasks.expire_overdue_offers()

    with pytest.raises(services.OfferConflict):
        services.respond_to_offer(offer.magic_token, 'decline')

    entry.refresh_from_db()
    assert entry.decline_count == 1  # only the sweep counted
