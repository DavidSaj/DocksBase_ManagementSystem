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
