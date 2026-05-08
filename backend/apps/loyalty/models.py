import uuid
from decimal import Decimal
from django.db import models


class LoyaltyTier(models.Model):
    class QualificationBasis(models.TextChoices):
        CUMULATIVE_SPEND    = 'cumulative_spend',    'Cumulative Spend (€)'
        NUMBER_OF_STAYS     = 'number_of_stays',     'Number of Stays'
        YEARS_OF_MEMBERSHIP = 'years_of_membership', 'Years of Membership'

    class RequalificationPolicy(models.TextChoices):
        PERMANENT = 'permanent', 'Held Permanently Once Achieved'
        ANNUAL    = 'annual',    'Must Re-qualify Each Calendar Year'

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='loyalty_tiers')
    name                = models.CharField(max_length=100)
    rank                = models.IntegerField(default=0)
    qualification_basis = models.CharField(max_length=30, choices=QualificationBasis.choices)
    threshold           = models.DecimalField(max_digits=12, decimal_places=2)
    berth_discount_pct  = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    points_multiplier   = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('1.00'))
    priority_berth_allocation = models.BooleanField(default=False)
    complimentary_services    = models.JSONField(default=list, blank=True)
    requalification_policy    = models.CharField(max_length=20, choices=RequalificationPolicy.choices, default='permanent')
    grace_period_days   = models.IntegerField(default=0)
    is_active           = models.BooleanField(default=True)

    class Meta:
        ordering = ['marina', 'rank']
        unique_together = [('marina', 'rank')]

    def __str__(self):
        return f'{self.name} (rank {self.rank})'


class LoyaltyMembership(models.Model):
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='loyalty_memberships')
    member           = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='loyalty_membership')
    tier             = models.ForeignKey(LoyaltyTier, on_delete=models.SET_NULL, null=True, blank=True, related_name='memberships')
    points_balance   = models.IntegerField(default=0)
    lifetime_spend   = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    qualifying_stays = models.IntegerField(default=0)
    tier_achieved_at = models.DateTimeField(null=True, blank=True)
    tier_expires_at  = models.DateTimeField(null=True, blank=True)
    last_activity_at = models.DateTimeField(null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'member')]

    def __str__(self):
        tier_name = self.tier.name if self.tier else 'No Tier'
        return f'{self.member} — {tier_name} ({self.points_balance} pts)'


class PointsLedger(models.Model):
    class EntryType(models.TextChoices):
        EARN     = 'earn',     'Points Earned'
        REDEEM   = 'redeem',   'Points Redeemed'
        EXPIRE   = 'expire',   'Points Expired'
        ADJUST   = 'adjust',   'Manual Adjustment'
        REFERRAL = 'referral', 'Referral Bonus'

    membership    = models.ForeignKey(LoyaltyMembership, on_delete=models.CASCADE, related_name='ledger_entries')
    entry_type    = models.CharField(max_length=20, choices=EntryType.choices)
    points        = models.IntegerField()
    balance_after = models.IntegerField()
    description   = models.CharField(max_length=255, blank=True)
    invoice       = models.ForeignKey('billing.Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='points_entries')
    line_item     = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL, null=True, blank=True, related_name='points_redemption')
    created_at    = models.DateTimeField(auto_now_add=True)
    created_by    = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True, related_name='points_entries')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        sign = '+' if self.points >= 0 else ''
        return f'{sign}{self.points} pts ({self.entry_type})'


class ReferralCode(models.Model):
    marina                 = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='referral_codes')
    member                 = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='referral_code')
    code                   = models.CharField(max_length=20)
    referrer_benefit_type  = models.CharField(max_length=20, default='points')
    referrer_benefit_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    referee_benefit_type   = models.CharField(max_length=20, default='discount')
    referee_benefit_value  = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    is_active              = models.BooleanField(default=True)
    created_at             = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'member'), ('marina', 'code')]

    def __str__(self):
        return f'{self.code} ({self.marina})'


class ReferralUse(models.Model):
    class BenefitStatus(models.TextChoices):
        PENDING  = 'pending',  'Pending First Booking'
        APPLIED  = 'applied',  'Benefit Applied'
        REJECTED = 'rejected', 'Rejected (Ineligible)'

    referral_code               = models.ForeignKey(ReferralCode, on_delete=models.CASCADE, related_name='uses')
    referee_member              = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='referral_uses')
    referee_booking             = models.ForeignKey('reservations.Booking', on_delete=models.SET_NULL, null=True, blank=True, related_name='referral_use')
    benefit_status              = models.CharField(max_length=20, choices=BenefitStatus.choices, default='pending')
    referrer_benefit_applied_at = models.DateTimeField(null=True, blank=True)
    referee_benefit_applied_at  = models.DateTimeField(null=True, blank=True)
    created_at                  = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'ReferralUse {self.pk} — {self.benefit_status}'


# ── Existing models kept verbatim ─────────────────────────────────────────────

class CouponCode(models.Model):
    """Discount coupon redeemable at invoice creation."""
    TYPE_CHOICES = [
        ('percentage', 'Percentage'),
        ('fixed',      'Fixed Amount'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='coupon_codes')
    code = models.CharField(max_length=50)
    description = models.CharField(max_length=200, blank=True)
    discount_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    discount_value = models.DecimalField(max_digits=10, decimal_places=2)
    max_uses = models.IntegerField(null=True, blank=True, help_text='Null = unlimited.')
    uses_count = models.IntegerField(default=0)
    valid_from = models.DateField(null=True, blank=True)
    valid_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    # Restrict to specific ChargableItem categories (empty = all discountable items)
    applicable_categories = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'code')]
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.code} ({self.marina})'

    def is_valid(self):
        from datetime import date
        if not self.is_active:
            return False
        if self.max_uses is not None and self.uses_count >= self.max_uses:
            return False
        today = date.today()
        if self.valid_from and today < self.valid_from:
            return False
        if self.valid_to and today > self.valid_to:
            return False
        return True

    def compute_discount(self, subtotal: Decimal) -> Decimal:
        """Return the discount amount (always positive). Capped at subtotal."""
        if self.discount_type == 'percentage':
            disc = (subtotal * self.discount_value / 100).quantize(Decimal('0.01'))
        else:
            disc = self.discount_value
        return min(disc, subtotal)


class MemberCreditAccount(models.Model):
    """Prepaid credit wallet — separate from loyalty points."""
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='credit_accounts')
    member = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='credit_accounts')
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'member')]

    def __str__(self):
        return f'{self.member} credit — €{self.balance}'


class CreditTransaction(models.Model):
    """Immutable ledger of every credit deposit/deduction."""
    account = models.ForeignKey(MemberCreditAccount, on_delete=models.CASCADE, related_name='transactions')
    delta = models.DecimalField(max_digits=10, decimal_places=2, help_text='Positive = top-up, negative = spend.')
    description = models.CharField(max_length=255, blank=True)
    invoice = models.ForeignKey(
        'billing.Invoice', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='loyalty_credit_transactions',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        sign = '+' if self.delta >= 0 else ''
        return f'{sign}€{self.delta} — {self.account.member}'
