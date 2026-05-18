from django.db import models


class PlatformPayment(models.Model):
    """Monthly SaaS subscription payment from a marina to the platform."""
    STATUS_CHOICES = [
        ('paid', 'Paid'),
        ('due', 'Due'),
        ('overdue', 'Overdue'),
    ]
    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='platform_payments'
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='due')
    method = models.CharField(max_length=50, default='Card')
    period_start = models.DateField()
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.marina.name} — {self.period_start} ({self.status})'


class AuditLog(models.Model):
    """Record of every action performed in the platform admin portal."""
    admin_user = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, related_name='audit_logs'
    )
    action = models.CharField(max_length=100)
    target_marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs'
    )
    detail = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    impersonation_session_id = models.UUIDField(null=True, blank=True, db_index=True)
    impersonator_user_id = models.IntegerField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.admin_user} — {self.action} at {self.created_at}'


class BillingStateChange(models.Model):
    """
    Immutable audit row for every platform billing-gate state transition.
    Cross-writes to AuditLog when triggered by an admin.

    Spec ref: docs/superpowers/specs/2026-05-17-billing-gates-design.md §A.2 / §A.8
    """
    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='billing_state_changes'
    )
    from_state      = models.CharField(max_length=20)
    to_state        = models.CharField(max_length=20)
    reason          = models.CharField(max_length=100)
    stripe_event_id = models.CharField(max_length=128, blank=True, db_index=True)
    actor_user      = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+'
    )
    detail          = models.JSONField(default=dict, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['marina', '-created_at']),
        ]

    def __str__(self):
        return f'{self.marina_id}: {self.from_state} → {self.to_state} ({self.reason})'


class ProcessedStripeEvent(models.Model):
    """
    Idempotency table for Stripe webhook events. The unique constraint on
    event_id is the single source of truth that prevents a replayed webhook
    from re-driving the billing state machine.

    Spec ref: §A.6 (event-id deduplication).
    """
    event_id   = models.CharField(max_length=128, unique=True)
    event_type = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.event_id} ({self.event_type})'


class GlobalFeatureFlag(models.Model):
    """Master on/off switch for a platform feature across all marinas."""
    name = models.CharField(max_length=100, unique=True)
    enabled = models.BooleanField(default=True)
    updated_by = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.name} — {"on" if self.enabled else "off"}'
