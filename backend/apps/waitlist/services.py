"""Waitlist business-logic services.

All transitions are funneled through these functions so signals / refunds /
notifications cannot drift between the API layer and tests.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from .models import RefundAction, WaitlistEntry, WaitlistOffer

DECLINE_EMAIL_TEMPLATE = (
    'You have declined {n} of {max} offers. If you decline {remaining} more, '
    'you will be removed from the waitlist and your deposit will be refunded.'
)


# ---------------------------------------------------------------------------
# Notifications wrapper. We import lazily so unit tests can monkeypatch.
# ---------------------------------------------------------------------------
def _dispatch(marina, recipient, subject, body):
    try:
        from apps.communications.services.dispatch import dispatch
        from apps.communications.models import MessageLog
    except Exception:  # pragma: no cover - communications missing
        return None
    return dispatch(
        marina=marina,
        channel=MessageLog.Channel.EMAIL,
        recipient=recipient,
        subject=subject,
        body=body,
    )


# ---------------------------------------------------------------------------
# Apply / pay-deposit
# ---------------------------------------------------------------------------
def apply(*, marina, applicant_name, applicant_email, applicant_phone='',
          vessel_type='', vessel_loa_m, vessel_beam_m, vessel_draft_m,
          pref_min_loa_m, pref_max_loa_m, pref_pier=None,
          applicant_member=None) -> WaitlistEntry:
    entry = WaitlistEntry(
        marina=marina,
        applicant_member=applicant_member,
        applicant_name=applicant_name,
        applicant_email=applicant_email,
        applicant_phone=applicant_phone,
        vessel_type=vessel_type,
        vessel_loa_m=vessel_loa_m,
        vessel_beam_m=vessel_beam_m,
        vessel_draft_m=vessel_draft_m,
        pref_min_loa_m=pref_min_loa_m,
        pref_max_loa_m=pref_max_loa_m,
        pref_pier=pref_pier,
        deposit_amount_cents=getattr(marina, 'waitlist_deposit_cents', 7500) or 7500,
        deposit_state='unpaid',
        status='pending',
        applied_at=timezone.now(),
        status_changed_at=timezone.now(),
    )
    entry.refresh_priority()
    entry.save()
    _dispatch(marina, applicant_email, 'Waitlist application received',
              'Your waitlist application has been received.')
    return entry


def pay_deposit(entry: WaitlistEntry, *, payment_intent_id: str = '') -> WaitlistEntry:
    """Marks the deposit paid. Called from Stripe webhook OR test."""
    entry.deposit_state = 'paid'
    entry.deposit_payment_intent_id = payment_intent_id or entry.deposit_payment_intent_id
    entry.deposit_paid_at = timezone.now()
    entry.refresh_priority()
    entry.save(update_fields=['deposit_state', 'deposit_payment_intent_id',
                              'deposit_paid_at', 'priority_score', 'updated_at'])
    _dispatch(entry.marina, entry.applicant_email,
              'Waitlist deposit received',
              'Thanks - your deposit has been received and you are now active on the waitlist.')
    return entry


# ---------------------------------------------------------------------------
# Priority queue listing
# ---------------------------------------------------------------------------
def queue(marina) -> list[WaitlistEntry]:
    """Returns pending entries in offer order: paid first (by applied_at asc),
    then unpaid (by applied_at asc)."""
    qs = WaitlistEntry.objects.filter(marina=marina, status='pending')
    return list(qs.order_by('priority_score', 'applied_at', 'id'))


# ---------------------------------------------------------------------------
# Offer
# ---------------------------------------------------------------------------
def offer_berth(entry: WaitlistEntry, berth, *, expires_in_hours: int = 48) -> WaitlistOffer:
    if entry.status != 'pending':
        raise ValueError(f'Entry not pending (status={entry.status})')
    with transaction.atomic():
        offer = WaitlistOffer.objects.create(
            entry=entry,
            offered_berth=berth,
            expires_at=timezone.now() + timedelta(hours=expires_in_hours),
            outcome='pending',
        )
        entry.status = 'offered'
        entry.status_changed_at = timezone.now()
        entry.save(update_fields=['status', 'status_changed_at', 'updated_at'])
    _dispatch(
        entry.marina, entry.applicant_email,
        'A berth has been offered to you',
        f'A berth ({berth.code}) has been offered. Respond within {expires_in_hours} hours.\n'
        f'Magic token: {offer.magic_token}',
    )
    return offer


# ---------------------------------------------------------------------------
# Respond to offer  (magic-link race-condition safe)
# ---------------------------------------------------------------------------
class OfferConflict(Exception):
    """Raised when an offer is no longer in a respondable state. Mapped to 409."""


def respond_to_offer(token, response: str, *, reason: str = '') -> dict:
    """Atomic, row-locked offer response. Returns dict with new entry/offer state.

    On any inconsistency (already accepted/declined, cancelled, expired) raises
    ``OfferConflict`` which the view layer translates into HTTP 409.
    """
    if response not in ('accept', 'decline'):
        raise ValueError('response must be accept|decline')

    with transaction.atomic():
        try:
            offer = (
                WaitlistOffer.objects
                .select_for_update()
                .select_related('entry', 'entry__marina', 'offered_berth')
                .get(magic_token=token)
            )
        except WaitlistOffer.DoesNotExist as exc:
            raise OfferConflict('Offer not found') from exc

        # The locked-decision spec: assert outcome=='pending' AND expires_at>now()
        if offer.outcome != 'pending':
            raise OfferConflict(f'Offer outcome is {offer.outcome}, not pending')
        if offer.expires_at <= timezone.now():
            # mark expired in passing
            offer.outcome = 'expired'
            offer.responded_at = timezone.now()
            offer.save(update_fields=['outcome', 'responded_at'])
            raise OfferConflict('Offer has expired')

        entry = offer.entry
        now = timezone.now()

        if response == 'accept':
            offer.outcome = 'accepted'
            offer.responded_at = now
            offer.save(update_fields=['outcome', 'responded_at'])
            entry.status = 'accepted'
            entry.status_changed_at = now
            entry.save(update_fields=['status', 'status_changed_at', 'updated_at'])
            _dispatch(entry.marina, entry.applicant_email,
                      'Offer accepted',
                      'Thank you for accepting. Your invoice will follow shortly.')
            return {'outcome': 'accepted', 'entry_id': entry.id, 'offer_id': offer.id}

        # decline path -------------------------------------------------------
        offer.outcome = 'declined'
        offer.responded_at = now
        offer.decline_reason = reason
        offer.save(update_fields=['outcome', 'responded_at', 'decline_reason'])

        entry.decline_count = (entry.decline_count or 0) + 1
        max_declines = int(getattr(entry.marina, 'max_waitlist_declines', 3) or 3)

        if entry.decline_count >= max_declines:
            entry.status = 'removed_max_declines'
            entry.status_changed_at = now
            entry.save(update_fields=['decline_count', 'status', 'status_changed_at', 'updated_at'])
            # Send 'final' decline email (still must contain strike-count copy)
            n = entry.decline_count
            remaining = 0
            body = DECLINE_EMAIL_TEMPLATE.format(n=n, max=max_declines, remaining=remaining)
            body += '\n\nYou have been removed from the waitlist after reaching the maximum decline count.'
            _dispatch(entry.marina, entry.applicant_email, 'Offer declined - removed from waitlist', body)
            # Initiate refund
            refund_deposit(entry, reason='removed_max_declines')
            return {
                'outcome': 'declined', 'entry_id': entry.id, 'offer_id': offer.id,
                'removed': True, 'decline_count': entry.decline_count,
            }

        # Below the limit -> stay in queue
        entry.status = 'pending'
        entry.status_changed_at = now
        entry.save(update_fields=['decline_count', 'status', 'status_changed_at', 'updated_at'])
        n = entry.decline_count
        remaining = max_declines - n
        body = DECLINE_EMAIL_TEMPLATE.format(n=n, max=max_declines, remaining=remaining)
        _dispatch(entry.marina, entry.applicant_email, 'Offer declined', body)
        return {
            'outcome': 'declined', 'entry_id': entry.id, 'offer_id': offer.id,
            'removed': False, 'decline_count': entry.decline_count,
        }


# ---------------------------------------------------------------------------
# Withdraw
# ---------------------------------------------------------------------------
def withdraw(entry: WaitlistEntry) -> WaitlistEntry:
    entry.status = 'withdrawn'
    entry.status_changed_at = timezone.now()
    entry.save(update_fields=['status', 'status_changed_at', 'updated_at'])
    refund_deposit(entry, reason='withdrawn')
    _dispatch(entry.marina, entry.applicant_email,
              'Waitlist withdrawal confirmed',
              'You have been removed from the waitlist. A refund has been initiated.')
    return entry


# ---------------------------------------------------------------------------
# Refund (with Stripe 180-day fallback)
# ---------------------------------------------------------------------------
def _stripe_refund(marina, intent_id, amount_cents):
    """Thin wrapper around Stripe so tests can mock it.

    Returns the refund id (str) on success. Raises whatever Stripe raises on
    failure.
    """
    import stripe
    return stripe.Refund.create(
        payment_intent=intent_id,
        amount=amount_cents,
        stripe_account=getattr(marina, 'stripe_account_id', None) or None,
    )


def refund_deposit(entry: WaitlistEntry, *, reason: str = '') -> WaitlistEntry:
    """Issue a Stripe refund; on Stripe.InvalidRequestError (e.g. >180d)
    fall back to a ``RefundAction`` row + marina notification."""
    if entry.deposit_state != 'paid':
        # Nothing to refund (or already handled)
        return entry
    try:
        import stripe  # noqa: F401
        InvalidRequestError = stripe.error.InvalidRequestError  # type: ignore[attr-defined]
    except Exception:  # pragma: no cover
        InvalidRequestError = Exception

    try:
        _stripe_refund(entry.marina, entry.deposit_payment_intent_id, entry.deposit_amount_cents)
        entry.deposit_state = 'refunded'
        entry.save(update_fields=['deposit_state', 'updated_at'])
    except InvalidRequestError:
        entry.deposit_state = 'manual_refund_required'
        entry.save(update_fields=['deposit_state', 'updated_at'])
        RefundAction.objects.create(
            entry=entry,
            amount_cents=entry.deposit_amount_cents,
            reason=reason or 'stripe_refused',
        )
        _dispatch(
            entry.marina,
            getattr(entry.marina, 'contact_email', '') or 'manager@example.com',
            'Manual refund required',
            f'Stripe refused to refund waitlist entry #{entry.id} (over 180 days). '
            'Please process this refund manually.',
        )
    return entry


def complete_refund_action(action: RefundAction, *, user=None, note: str = '') -> RefundAction:
    action.completed_at = timezone.now()
    action.completed_by = user
    action.audit_note = note
    action.save(update_fields=['completed_at', 'completed_by', 'audit_note'])
    # Move entry state to refunded
    entry = action.entry
    if entry.deposit_state == 'manual_refund_required':
        entry.deposit_state = 'refunded'
        entry.save(update_fields=['deposit_state', 'updated_at'])
    return action


# ---------------------------------------------------------------------------
# Convert
# ---------------------------------------------------------------------------
def convert(entry: WaitlistEntry, berth) -> dict:
    """Convert an accepted entry into a seasonal Member + Berth.owner + invoice.

    Reuses an existing Member by (marina, email) if available, else creates one.
    """
    from apps.members.models import Member

    with transaction.atomic():
        member = (
            Member.objects
            .filter(marina=entry.marina, email__iexact=entry.applicant_email)
            .first()
        )
        if member is None:
            member = Member.objects.create(
                marina=entry.marina,
                name=entry.applicant_name,
                email=entry.applicant_email,
                phone=entry.applicant_phone,
                member_type='seasonal',
                joined_at=timezone.now().date(),
            )
        else:
            if member.member_type != 'seasonal':
                member.member_type = 'seasonal'
                member.save(update_fields=['member_type'])

        # Assign the berth
        berth.owner = member
        update_fields = ['owner']
        # lease_expiry default = +1 year
        try:
            berth.lease_expiry = (timezone.now() + timedelta(days=365)).date()
            update_fields.append('lease_expiry')
        except Exception:
            pass
        berth.save(update_fields=update_fields)

        # Create first invoice (credit the deposit)
        invoice = _create_conversion_invoice(entry, member, berth)

        entry.applicant_member = member
        entry.status = 'converted'
        entry.status_changed_at = timezone.now()
        if entry.deposit_state == 'paid':
            entry.deposit_state = 'applied_to_lease'
        entry.save(update_fields=['applicant_member', 'status', 'status_changed_at',
                                  'deposit_state', 'updated_at'])

    _dispatch(entry.marina, entry.applicant_email,
              'Welcome - lease invoice attached',
              'Welcome to the marina. Your first invoice has been generated.')
    return {'entry': entry, 'member': member, 'berth': berth, 'invoice': invoice}


def _create_conversion_invoice(entry, member, berth):
    """Create a minimal invoice with a deposit-credit line item."""
    from apps.billing.models import Invoice, InvoiceLineItem as InvoiceItem
    inv = Invoice.objects.create(
        marina=entry.marina,
        member=member,
        invoice_number=f'WL-{entry.id}-{int(timezone.now().timestamp())}',
        status='draft',
        source_type='waitlist',
        source_id=str(entry.id),
        subtotal=Decimal('0.00'),
        tax_total=Decimal('0.00'),
        total=Decimal('0.00'),
    )
    # Positive line: full season fee (placeholder if no pricing tier)
    season_price = Decimal('0.00')
    if berth.pricing_tier_id:
        season_price = Decimal('5000.00')
    InvoiceItem.objects.create(
        invoice=inv,
        description=f'Seasonal lease - Berth {berth.code}',
        quantity=Decimal('1'),
        unit_price=season_price,
        total_price=season_price,
    )
    # Negative deposit-credit line
    if entry.deposit_amount_cents:
        credit = Decimal(entry.deposit_amount_cents) / Decimal('100')
        InvoiceItem.objects.create(
            invoice=inv,
            description='Waitlist deposit credit',
            quantity=Decimal('1'),
            unit_price=-credit,
            total_price=-credit,
        )
    total = season_price - (Decimal(entry.deposit_amount_cents) / Decimal('100'))
    inv.subtotal = total
    inv.total = total
    inv.save(update_fields=['subtotal', 'total'])
    return inv
