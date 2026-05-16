"""Waitlist models.

Implements the locked-decision spec at docs/superpowers/specs/2026-05-15-waitlist-management-design.md §17:

- ``fifo_paid_first`` priority (paid deposits rank ahead of unpaid; within each
  tier, oldest ``applied_at`` first).
- 3-strikes decline policy: numeric ``decline_count`` + marina-level
  ``max_waitlist_declines``.
- Refundable escrow deposit. New ``RefundAction`` row backs the
  Stripe-180-day manual-refund fallback.
"""
from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone


class WaitlistEntry(models.Model):
    """A seasonal-slip waitlist application."""

    DEPOSIT_STATES = [
        ('unpaid', 'Unpaid'),
        ('paid', 'Paid'),
        ('refunded', 'Refunded'),
        ('manual_refund_required', 'Manual Refund Required'),
        ('applied_to_lease', 'Applied to Lease'),
    ]
    STATUSES = [
        ('pending', 'Pending'),
        ('offered', 'Offered'),
        ('accepted', 'Accepted'),
        ('converted', 'Converted'),
        ('withdrawn', 'Withdrawn'),
        ('removed_max_declines', 'Removed - Max Declines'),
        ('expired', 'Expired'),
    ]

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='seasonal_waitlist_entries'
    )
    applicant_member = models.ForeignKey(
        'members.Member', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='seasonal_waitlist_entries',
    )

    applicant_name = models.CharField(max_length=200)
    applicant_email = models.EmailField()
    applicant_phone = models.CharField(max_length=30, blank=True)

    vessel_type = models.CharField(max_length=40, blank=True)
    vessel_loa_m = models.DecimalField(max_digits=6, decimal_places=1)
    vessel_beam_m = models.DecimalField(max_digits=5, decimal_places=2)
    vessel_draft_m = models.DecimalField(max_digits=5, decimal_places=2)

    pref_min_loa_m = models.DecimalField(max_digits=6, decimal_places=1)
    pref_max_loa_m = models.DecimalField(max_digits=6, decimal_places=1)
    pref_pier = models.ForeignKey(
        'berths.Pier', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='+',
    )

    priority_score = models.DecimalField(max_digits=20, decimal_places=4, default=0)

    deposit_amount_cents = models.IntegerField(default=0)
    deposit_state = models.CharField(max_length=30, choices=DEPOSIT_STATES, default='unpaid')
    deposit_payment_intent_id = models.CharField(max_length=120, blank=True)
    deposit_paid_at = models.DateTimeField(null=True, blank=True)

    decline_count = models.IntegerField(default=0)
    status = models.CharField(max_length=30, choices=STATUSES, default='pending')

    applied_at = models.DateTimeField(default=timezone.now, db_index=True)
    status_changed_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['priority_score', 'applied_at', 'id']
        indexes = [
            models.Index(fields=['marina', 'status', 'priority_score']),
            models.Index(fields=['marina', 'applicant_email']),
        ]

    def __str__(self):
        return f'Waitlist#{self.pk} {self.applicant_name} @ {self.marina_id}'

    # Priority --------------------------------------------------------------
    UNPAID_OFFSET_SECONDS = 60 * 60 * 24 * 365 * 10  # ten years

    def compute_priority_score(self):
        """fifo_paid_first: unpaid entries are pushed 10y to the back.

        Lower score = higher priority.
        """
        base = self.applied_at.timestamp() if self.applied_at else timezone.now().timestamp()
        if self.deposit_state != 'paid':
            base += self.UNPAID_OFFSET_SECONDS
        return base

    def refresh_priority(self):
        from decimal import Decimal
        self.priority_score = Decimal(str(self.compute_priority_score()))


class WaitlistOffer(models.Model):
    OUTCOMES = [
        ('pending', 'Pending'),
        ('accepted', 'Accepted'),
        ('declined', 'Declined'),
        ('expired', 'Expired'),
        ('cancelled', 'Cancelled'),
    ]

    entry = models.ForeignKey(
        WaitlistEntry, on_delete=models.PROTECT, related_name='offers',
    )
    offered_berth = models.ForeignKey(
        'berths.Berth', on_delete=models.PROTECT, related_name='seasonal_waitlist_offers',
    )
    magic_token = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    offered_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    outcome = models.CharField(max_length=20, choices=OUTCOMES, default='pending')
    responded_at = models.DateTimeField(null=True, blank=True)
    decline_reason = models.CharField(max_length=400, blank=True)
    reminder_sent_t24h = models.BooleanField(default=False)
    reminder_sent_t2h = models.BooleanField(default=False)

    class Meta:
        ordering = ['-offered_at']
        constraints = [
            models.UniqueConstraint(
                fields=['entry'],
                condition=models.Q(outcome='pending'),
                name='waitlist_one_open_offer_per_entry',
            ),
            models.UniqueConstraint(
                fields=['offered_berth'],
                condition=models.Q(outcome='pending'),
                name='waitlist_one_open_offer_per_berth',
            ),
        ]

    def __str__(self):
        return f'Offer#{self.pk} entry={self.entry_id} outcome={self.outcome}'

    @property
    def is_expired(self):
        return self.expires_at <= timezone.now()


class RefundAction(models.Model):
    """A manual-refund TODO created when Stripe refuses a refund (180-day trap)."""

    entry = models.ForeignKey(
        WaitlistEntry, on_delete=models.CASCADE, related_name='refund_actions',
    )
    amount_cents = models.IntegerField()
    reason = models.CharField(max_length=200, blank=True)
    audit_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        'accounts.User', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='+',
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        status = 'done' if self.completed_at else 'pending'
        return f'RefundAction#{self.pk} entry={self.entry_id} {status}'
