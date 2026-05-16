"""Locked-decision contract tests for the waitlist app.

These map 1:1 onto the test names listed in §17 of the spec.
"""
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from unittest.mock import patch, MagicMock

import pytest
from django.utils import timezone

from apps.waitlist import services
from apps.waitlist.models import RefundAction, WaitlistEntry, WaitlistOffer


pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# 1. test_decline_3rd_strike_triggers_refund
# ---------------------------------------------------------------------------
def test_decline_3rd_strike_triggers_refund(marina, berth, make_entry, make_offer):
    entry = make_entry(deposit_state='paid', name='Three')
    # First decline
    offer1 = make_offer(entry, berth)
    entry.status = 'offered'
    entry.save()
    with patch('apps.waitlist.services._stripe_refund') as refund_mock:
        refund_mock.return_value = 're_x'
        result = services.respond_to_offer(offer1.magic_token, 'decline')
    assert result['decline_count'] == 1
    entry.refresh_from_db()
    assert entry.status == 'pending'

    # Second decline
    offer2 = make_offer(entry, berth)
    entry.status = 'offered'
    entry.save()
    with patch('apps.waitlist.services._stripe_refund') as refund_mock:
        result = services.respond_to_offer(offer2.magic_token, 'decline')
    assert result['decline_count'] == 2
    entry.refresh_from_db()
    assert entry.status == 'pending'

    # Third decline -> removed_max_declines + refund initiated
    offer3 = make_offer(entry, berth)
    entry.status = 'offered'
    entry.save()
    with patch('apps.waitlist.services._stripe_refund') as refund_mock:
        refund_mock.return_value = 're_x'
        result = services.respond_to_offer(offer3.magic_token, 'decline')
    assert result['removed'] is True
    assert result['decline_count'] == 3
    entry.refresh_from_db()
    assert entry.status == 'removed_max_declines'
    assert entry.deposit_state == 'refunded'
    refund_mock.assert_called_once()


# ---------------------------------------------------------------------------
# 2. test_decline_email_copy_contains_strike_count
# ---------------------------------------------------------------------------
def test_decline_email_copy_contains_strike_count(marina, berth, make_entry, make_offer):
    entry = make_entry(deposit_state='paid', name='Copy')
    offer = make_offer(entry, berth)
    entry.status = 'offered'
    entry.save()

    sent = {}

    def fake_dispatch(_marina, recipient, subject, body):
        sent['subject'] = subject
        sent['body'] = body

    with patch('apps.waitlist.services._dispatch', side_effect=fake_dispatch):
        services.respond_to_offer(offer.magic_token, 'decline')

    assert 'You have declined 1 of 3' in sent['body']
    assert 'If you decline 2 more' in sent['body']


# ---------------------------------------------------------------------------
# 3. test_priority_fifo_paid_first_orders_correctly
# ---------------------------------------------------------------------------
def test_priority_fifo_paid_first_orders_correctly(marina, make_entry):
    # A (paid 2024-01-05), B (unpaid 2024-01-01), C (paid 2024-02-01)
    # Expected order: [A, C, B]
    tz = dt_timezone.utc
    a = make_entry(applied_at=datetime(2024, 1, 5, tzinfo=tz), deposit_state='paid', name='A')
    b = make_entry(applied_at=datetime(2024, 1, 1, tzinfo=tz), deposit_state='unpaid', name='B')
    c = make_entry(applied_at=datetime(2024, 2, 1, tzinfo=tz), deposit_state='paid', name='C')

    ordered = services.queue(marina)
    ids = [e.id for e in ordered]
    assert ids == [a.id, c.id, b.id], f'Got {[e.applicant_name for e in ordered]}'


# ---------------------------------------------------------------------------
# 4. test_old_deposit_refund_falls_back_to_manual
# ---------------------------------------------------------------------------
def test_old_deposit_refund_falls_back_to_manual(marina, make_entry):
    entry = make_entry(deposit_state='paid', name='Old')
    import stripe
    err = stripe.error.InvalidRequestError('charge too old', 'charge')

    dispatched = []

    def fake_dispatch(*args, **kwargs):
        dispatched.append((args, kwargs))

    with patch('apps.waitlist.services._stripe_refund', side_effect=err):
        with patch('apps.waitlist.services._dispatch', side_effect=fake_dispatch):
            services.refund_deposit(entry, reason='withdrawn')

    entry.refresh_from_db()
    assert entry.deposit_state == 'manual_refund_required'
    actions = RefundAction.objects.filter(entry=entry)
    assert actions.count() == 1
    assert actions.first().amount_cents == entry.deposit_amount_cents
    # dispatch was called at least once (the marina notification)
    assert len(dispatched) >= 1


# ---------------------------------------------------------------------------
# 5. test_offer_respond_409_on_concurrent_state
# ---------------------------------------------------------------------------
def test_offer_respond_409_on_concurrent_state(marina, berth, make_entry, make_offer):
    entry = make_entry(deposit_state='paid', name='Race')
    offer = make_offer(entry, berth)
    entry.status = 'offered'
    entry.save()

    # Simulate a concurrent flip: another worker already marked it declined.
    WaitlistOffer.objects.filter(pk=offer.pk).update(outcome='declined')

    with pytest.raises(services.OfferConflict):
        services.respond_to_offer(offer.magic_token, 'accept')


# ---------------------------------------------------------------------------
# 6. test_offer_respond_holds_row_lock
# ---------------------------------------------------------------------------
def test_offer_respond_holds_row_lock(marina, berth, make_entry, make_offer):
    """Two clients race accept+decline; exactly one wins.

    We simulate by calling respond_to_offer twice sequentially within the same
    test - the SELECT FOR UPDATE inside the second call will see the new state
    (because the first txn committed) and raise OfferConflict.
    """
    entry = make_entry(deposit_state='paid', name='Lock')
    offer = make_offer(entry, berth)
    entry.status = 'offered'
    entry.save()

    with patch('apps.waitlist.services._stripe_refund', return_value='re_x'):
        first = services.respond_to_offer(offer.magic_token, 'accept')
        with pytest.raises(services.OfferConflict):
            services.respond_to_offer(offer.magic_token, 'decline')

    assert first['outcome'] == 'accepted'


# ---------------------------------------------------------------------------
# 7. test_convert_sets_berth_owner_and_member_seasonal
# ---------------------------------------------------------------------------
def test_convert_sets_berth_owner_and_member_seasonal(marina, berth, make_entry, make_offer):
    entry = make_entry(deposit_state='paid', name='Convert',
                       email='convert@example.com')
    offer = make_offer(entry, berth)
    entry.status = 'offered'
    entry.save()
    services.respond_to_offer(offer.magic_token, 'accept')
    entry.refresh_from_db()
    assert entry.status == 'accepted'

    result = services.convert(entry, berth)
    entry.refresh_from_db()
    berth.refresh_from_db()

    assert entry.status == 'converted'
    assert berth.owner_id is not None
    assert berth.owner.member_type == 'seasonal'
    assert berth.owner.email == 'convert@example.com'
    assert entry.deposit_state == 'applied_to_lease'
    # Invoice created with deposit-credit line
    inv = result['invoice']
    assert inv.items.filter(description='Waitlist deposit credit').exists()


# ---------------------------------------------------------------------------
# 8. test_withdraw_refunds_deposit
# ---------------------------------------------------------------------------
def test_withdraw_refunds_deposit(marina, make_entry):
    entry = make_entry(deposit_state='paid', name='Withdraw')
    with patch('apps.waitlist.services._stripe_refund', return_value='re_w') as m:
        services.withdraw(entry)
    entry.refresh_from_db()
    assert entry.status == 'withdrawn'
    assert entry.deposit_state == 'refunded'
    m.assert_called_once()


# ---------------------------------------------------------------------------
# Additional: API-level 409 contract for the magic-link respond endpoint
# ---------------------------------------------------------------------------
def test_api_respond_returns_409_on_conflict(client, marina, berth, make_entry, make_offer):
    entry = make_entry(deposit_state='paid', name='Api')
    offer = make_offer(entry, berth)
    entry.status = 'offered'
    entry.save()
    WaitlistOffer.objects.filter(pk=offer.pk).update(outcome='cancelled')

    resp = client.post(
        f'/api/v1/waitlist/offers/{offer.magic_token}/respond/',
        data={'response': 'accept'},
        content_type='application/json',
    )
    assert resp.status_code == 409, resp.content
