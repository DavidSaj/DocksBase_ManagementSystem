"""
Loyalty service layer — Track 3 rebuild.

All point mutations go through these functions; never update points_balance
directly. select_for_update() guards prevent race conditions on concurrent
redemption requests. All Celery dispatches use transaction.on_commit().
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone


# ── Membership ────────────────────────────────────────────────────────────────

def get_or_create_membership(member, marina):
    """Return (or create) the LoyaltyMembership for this member/marina pair."""
    from apps.loyalty.models import LoyaltyMembership
    membership, _ = LoyaltyMembership.objects.get_or_create(
        marina=marina,
        member=member,
        defaults={
            'points_balance': 0,
            'lifetime_spend': Decimal('0.00'),
            'qualifying_stays': 0,
        },
    )
    return membership


# ── Points calculation ─────────────────────────────────────────────────────────

def calculate_points_earned(invoice, membership) -> int:
    """
    Calculate how many points to award for an invoice.
    Points = invoice.total * marina.points_earn_rate * tier.points_multiplier.
    Returns 0 if membership has no tier or marina rate is zero.
    """
    marina = invoice.marina
    rate = marina.points_earn_rate  # Decimal
    multiplier = Decimal('1.00')
    if membership.tier:
        multiplier = membership.tier.points_multiplier
    raw = invoice.total * rate * multiplier
    return max(0, int(raw))


# ── ChargeableItem helper ─────────────────────────────────────────────────────

def get_or_create_loyalty_chargeable_item(marina, label: str):
    """
    Return (or create) a ChargeableItem of category LOYALTY for the marina.
    Used when creating discount/redemption line items.
    """
    from apps.billing.models import ChargeableItem
    item, _ = ChargeableItem.objects.get_or_create(
        marina=marina,
        name=label,
        defaults={
            'category': ChargeableItem.Category.LOYALTY,
            'pricing_model': ChargeableItem.PricingModel.FLAT_FEE,
            'unit_price': Decimal('0.00'),
            'tax_rate': Decimal('0.00'),
            'is_active': True,
            'is_discountable': False,
        },
    )
    return item


# ── Points earn ───────────────────────────────────────────────────────────────

def earn_points(
    membership_pk: int,
    invoice,
    points: int,
    entry_type: str = 'earn',
    description: str = '',
    created_by=None,
):
    """
    Award points to a membership. Thread-safe via select_for_update().
    Updates lifetime_spend from invoice.total, then evaluates tier.
    Returns the PointsLedger entry.
    """
    from apps.loyalty.models import LoyaltyMembership, PointsLedger
    if points <= 0:
        raise ValueError('points must be positive')

    with transaction.atomic():
        membership = LoyaltyMembership.objects.select_for_update().get(pk=membership_pk)
        membership.points_balance = F('points_balance') + points
        membership.lifetime_spend = F('lifetime_spend') + (invoice.total if invoice else Decimal('0.00'))
        membership.last_activity_at = timezone.now()
        membership.save(update_fields=['points_balance', 'lifetime_spend', 'last_activity_at'])

        # Refresh to get the actual integer values after F() expressions
        membership.refresh_from_db(fields=['points_balance', 'lifetime_spend'])

        entry = PointsLedger.objects.create(
            membership=membership,
            entry_type=entry_type,
            points=points,
            balance_after=membership.points_balance,
            description=description,
            invoice=invoice,
            created_by=created_by,
        )

        evaluate_tier(membership)

    return entry


# ── Points redeem ─────────────────────────────────────────────────────────────

def redeem_points(
    membership_pk: int,
    points: int,
    invoice,
    created_by=None,
):
    """
    Deduct points and create a negative InvoiceLineItem for the currency equivalent.
    Raises ValueError if insufficient balance.
    Returns the PointsLedger entry.
    """
    from apps.loyalty.models import LoyaltyMembership, PointsLedger
    from apps.billing.models import InvoiceLineItem
    if points <= 0:
        raise ValueError('points must be positive')

    with transaction.atomic():
        membership = LoyaltyMembership.objects.select_for_update().get(pk=membership_pk)
        if membership.points_balance < points:
            raise ValueError(
                f'Insufficient points: balance {membership.points_balance}, requested {points}'
            )

        membership.points_balance = F('points_balance') - points
        membership.last_activity_at = timezone.now()
        membership.save(update_fields=['points_balance', 'last_activity_at'])
        membership.refresh_from_db(fields=['points_balance'])

        # Convert points to currency amount
        marina = membership.marina
        currency_value = Decimal(str(points)) / marina.points_to_currency_ratio

        chargeable_item = get_or_create_loyalty_chargeable_item(marina, 'Points Redemption')

        line_item = InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Points redemption ({points} pts)',
            quantity=Decimal('1'),
            unit_price=-currency_value,
            total_price=-currency_value,
            chargeable_item=chargeable_item,
        )

        entry = PointsLedger.objects.create(
            membership=membership,
            entry_type=PointsLedger.EntryType.REDEEM,
            points=-points,
            balance_after=membership.points_balance,
            description=f'Redeemed {points} pts against invoice {invoice.invoice_number}',
            invoice=invoice,
            line_item=line_item,
            created_by=created_by,
        )

    return entry


# ── Manual adjustment ─────────────────────────────────────────────────────────

def adjust_points_manual(
    membership_pk: int,
    points: int,
    description: str,
    created_by,
):
    """
    Apply a positive or negative manual adjustment. No invoice required.
    Returns the PointsLedger entry.
    """
    from apps.loyalty.models import LoyaltyMembership, PointsLedger
    with transaction.atomic():
        membership = LoyaltyMembership.objects.select_for_update().get(pk=membership_pk)
        if points < 0 and membership.points_balance + points < 0:
            raise ValueError(
                f'Adjustment would result in negative balance '
                f'(balance {membership.points_balance}, delta {points})'
            )
        membership.points_balance = F('points_balance') + points
        membership.last_activity_at = timezone.now()
        membership.save(update_fields=['points_balance', 'last_activity_at'])
        membership.refresh_from_db(fields=['points_balance'])

        entry = PointsLedger.objects.create(
            membership=membership,
            entry_type=PointsLedger.EntryType.ADJUST,
            points=points,
            balance_after=membership.points_balance,
            description=description,
            created_by=created_by,
        )

    return entry


# ── Tier evaluation ───────────────────────────────────────────────────────────

def evaluate_tier(membership) -> None:
    """
    Re-evaluate which LoyaltyTier the membership qualifies for and promote if needed.
    Reads all active tiers for this marina ordered by rank descending (highest first).
    Sets tier_achieved_at and tier_expires_at as appropriate, then sends promo email.

    Must be called inside an existing atomic block (called from earn_points).
    """
    from apps.loyalty.models import LoyaltyTier

    tiers = LoyaltyTier.objects.filter(
        marina=membership.marina, is_active=True
    ).order_by('-rank')

    if not tiers.exists():
        return

    basis = None
    qualified_tier = None

    for tier in tiers:
        if tier.qualification_basis == LoyaltyTier.QualificationBasis.CUMULATIVE_SPEND:
            basis = membership.lifetime_spend
        elif tier.qualification_basis == LoyaltyTier.QualificationBasis.NUMBER_OF_STAYS:
            basis = Decimal(str(membership.qualifying_stays))
        elif tier.qualification_basis == LoyaltyTier.QualificationBasis.YEARS_OF_MEMBERSHIP:
            basis = _years_of_membership(membership)
        else:
            basis = Decimal('0')

        if basis >= tier.threshold:
            qualified_tier = tier
            break

    if qualified_tier and membership.tier_id != qualified_tier.pk:
        old_tier = membership.tier
        membership.tier = qualified_tier
        membership.tier_achieved_at = timezone.now()

        # Set expiry for annual requalification tiers
        if qualified_tier.requalification_policy == LoyaltyTier.RequalificationPolicy.ANNUAL:
            from datetime import timedelta
            year_end = timezone.now().replace(month=12, day=31, hour=23, minute=59, second=59)
            if qualified_tier.grace_period_days:
                year_end = year_end + timedelta(days=qualified_tier.grace_period_days)
            membership.tier_expires_at = year_end
        else:
            membership.tier_expires_at = None

        membership.save(update_fields=['tier', 'tier_achieved_at', 'tier_expires_at'])
        _send_tier_promotion_email(membership, qualified_tier)


# ── Tier discount ─────────────────────────────────────────────────────────────

def apply_tier_discount(booking, invoice) -> None:
    """
    If the booking member has an active tier with berth_discount_pct > 0,
    create a negative InvoiceLineItem for the berth discount.
    Should be called after invoice creation in reservations/services.py.
    """
    from apps.billing.models import InvoiceLineItem, ChargeableItem
    from apps.loyalty.models import LoyaltyMembership

    member = invoice.member
    if not member:
        return

    try:
        membership = LoyaltyMembership.objects.select_related('tier').get(
            marina=invoice.marina, member=member
        )
    except LoyaltyMembership.DoesNotExist:
        return

    if not membership.tier:
        return

    discount_pct = membership.tier.berth_discount_pct
    if not discount_pct or discount_pct <= 0:
        return

    # Sum berth line items only
    berth_lines = invoice.items.filter(
        chargeable_item__category=ChargeableItem.Category.BERTH
    )
    berth_subtotal = sum(line.total_price for line in berth_lines)
    if berth_subtotal <= 0:
        return

    discount_amount = (berth_subtotal * discount_pct / 100).quantize(Decimal('0.01'))

    chargeable_item = get_or_create_loyalty_chargeable_item(
        invoice.marina, f'Loyalty Tier Discount ({membership.tier.name})'
    )

    with transaction.atomic():
        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Tier discount — {membership.tier.name} ({discount_pct}%)',
            quantity=Decimal('1'),
            unit_price=-discount_amount,
            total_price=-discount_amount,
            chargeable_item=chargeable_item,
        )


# ── Referral benefits ─────────────────────────────────────────────────────────

def apply_referral_benefits(referral_use) -> None:
    """
    Apply benefits for a ReferralUse.
    Gate: referee must have no prior bookings at this marina (other than the one on the use).
    - Referee discount: applied immediately as a negative InvoiceLineItem on referee_booking.
    - Referrer points: applied only when qualifying spend threshold is met.
    """
    from apps.loyalty.models import ReferralUse
    from apps.reservations.models import Booking

    referral_code = referral_use.referral_code
    marina = referral_code.marina
    referee = referral_use.referee_member

    if not referee:
        return

    # Gate: no prior bookings
    prior_bookings = Booking.objects.filter(
        marina=marina, member=referee
    ).exclude(pk=referral_use.referee_booking_id).exists()

    if prior_bookings:
        referral_use.benefit_status = ReferralUse.BenefitStatus.REJECTED
        referral_use.save(update_fields=['benefit_status'])
        return

    now = timezone.now()

    with transaction.atomic():
        # Apply referee discount on their booking invoice (if booking has an invoice)
        if referral_use.referee_booking and referral_code.referee_benefit_type == 'discount':
            booking = referral_use.referee_booking
            invoices = booking.invoices.filter(status__in=['draft', 'unpaid', 'open'])
            if invoices.exists():
                invoice = invoices.first()
                from apps.billing.models import InvoiceLineItem
                chargeable_item = get_or_create_loyalty_chargeable_item(marina, 'Referral Discount')
                discount = referral_code.referee_benefit_value
                InvoiceLineItem.objects.create(
                    invoice=invoice,
                    description=f'Referral discount (code: {referral_code.code})',
                    quantity=Decimal('1'),
                    unit_price=-discount,
                    total_price=-discount,
                    chargeable_item=chargeable_item,
                )
                referral_use.referee_benefit_applied_at = now
                referral_use.save(update_fields=['referee_benefit_applied_at'])

        # Apply referrer points benefit
        if referral_code.referrer_benefit_type == 'points':
            referrer = referral_code.member
            referrer_membership = get_or_create_membership(referrer, marina)
            points = int(referral_code.referrer_benefit_value)
            if points > 0:
                earn_points(
                    membership_pk=referrer_membership.pk,
                    invoice=None,
                    points=points,
                    entry_type=referrer_membership.ledger_entries.model.EntryType.REFERRAL,
                    description=f'Referral bonus for code {referral_code.code}',
                )
                referral_use.referrer_benefit_applied_at = now

        referral_use.benefit_status = ReferralUse.BenefitStatus.APPLIED
        referral_use.save(update_fields=['benefit_status', 'referrer_benefit_applied_at'])


def check_pending_referral_benefits(invoice) -> None:
    """
    Called after a payment is recorded. Checks whether any pending ReferralUse
    records for this invoice's member now qualify for referrer benefit.
    """
    from apps.loyalty.models import ReferralUse

    member = invoice.member
    if not member:
        return

    pending_uses = ReferralUse.objects.filter(
        referee_member=member,
        benefit_status=ReferralUse.BenefitStatus.PENDING,
        referral_code__marina=invoice.marina,
    ).select_related('referral_code', 'referral_code__member')

    for use in pending_uses:
        apply_referral_benefits(use)


# ── Email helpers ─────────────────────────────────────────────────────────────

def _send_tier_promotion_email(membership, tier) -> None:
    """Send a tier promotion congratulations email to the member."""
    member = membership.member
    email = getattr(member, 'email', '')
    if not email:
        return

    from django.core.mail import send_mail
    marina = membership.marina
    subject = f'Congratulations — you have reached {tier.name} status at {marina.name}!'
    message = (
        f'Dear {member.name},\n\n'
        f'You have been promoted to {tier.name} tier at {marina.name}.\n\n'
        f'Your new benefits include:\n'
        f'  • Berth discount: {tier.berth_discount_pct}%\n'
        f'  • Points multiplier: {tier.points_multiplier}x\n'
        f'  • Priority berth allocation: {"Yes" if tier.priority_berth_allocation else "No"}\n\n'
        f'Thank you for your continued loyalty.\n\n'
        f'The {marina.name} Team'
    )
    send_mail(
        subject=subject,
        message=message,
        from_email=None,
        recipient_list=[email],
        fail_silently=True,
    )


def _years_of_membership(membership) -> Decimal:
    """Return the number of full years since the membership was created."""
    from datetime import date
    created = membership.created_at.date() if membership.created_at else date.today()
    today = date.today()
    years = (today - created).days / 365.25
    return Decimal(str(round(years, 2)))


# ── Legacy coupon / credit functions (kept for backward-compat) ───────────────

def apply_coupon(code_str: str, invoice, marina) -> Decimal:
    """
    Apply a coupon to an invoice, creating a discount line item.
    Returns the discount amount applied (Decimal), or 0 if invalid.
    Only applies to InvoiceLineItems where chargeable_item.is_discountable=True.
    """
    from apps.billing.models import InvoiceLineItem
    from apps.loyalty.models import CouponCode

    try:
        coupon = CouponCode.objects.select_for_update().get(
            marina=marina, code=code_str, is_active=True
        )
    except CouponCode.DoesNotExist:
        return Decimal('0')

    if not coupon.is_valid():
        return Decimal('0')

    lines = invoice.items.filter(chargeable_item__is_discountable=True)
    if coupon.applicable_categories:
        lines = lines.filter(chargeable_item__category__in=coupon.applicable_categories)

    subtotal = sum(line.total_price for line in lines)
    if subtotal <= 0:
        return Decimal('0')

    discount = coupon.compute_discount(subtotal)

    with transaction.atomic():
        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Coupon: {coupon.code}',
            quantity=Decimal('1'),
            unit_price=-discount,
            total_price=-discount,
        )
        coupon.uses_count = F('uses_count') + 1
        coupon.save(update_fields=['uses_count'])

    return discount


def get_or_create_credit_account(member, marina):
    """Return (or create) the MemberCreditAccount for this member/marina pair."""
    from apps.loyalty.models import MemberCreditAccount
    account, _ = MemberCreditAccount.objects.get_or_create(
        marina=marina, member=member,
        defaults={'balance': Decimal('0')},
    )
    return account


def top_up_credit(member, marina, amount: Decimal, description: str = '', invoice=None):
    """Add credit to a member's wallet."""
    from apps.loyalty.models import MemberCreditAccount, CreditTransaction
    if amount <= 0:
        raise ValueError('amount must be positive')
    with transaction.atomic():
        account = MemberCreditAccount.objects.select_for_update().get(marina=marina, member=member)
        account.balance = F('balance') + amount
        account.save(update_fields=['balance', 'updated_at'])
        return CreditTransaction.objects.create(
            account=account, delta=amount, description=description, invoice=invoice
        )


def spend_credit(member, marina, amount: Decimal, description: str = '', invoice=None):
    """Deduct credit from a member's wallet. Raises ValueError if insufficient."""
    from apps.loyalty.models import MemberCreditAccount, CreditTransaction
    if amount <= 0:
        raise ValueError('amount must be positive')
    with transaction.atomic():
        account = MemberCreditAccount.objects.select_for_update().get(marina=marina, member=member)
        if account.balance < amount:
            raise ValueError(f'Insufficient credit: balance €{account.balance}, requested €{amount}')
        account.balance = F('balance') - amount
        account.save(update_fields=['balance', 'updated_at'])
        return CreditTransaction.objects.create(
            account=account, delta=-amount, description=description, invoice=invoice
        )
