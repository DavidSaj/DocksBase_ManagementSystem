"""
Security app models — Task 1 delivers UserMFA, MFABackupCode, MFAChallenge.
Task 2 will append MarinaIPAllowlist.
Task 4 will append SecurityAuditLog.

Design note: MFAChallenge is extended with a `purpose` field (choices: 'login',
'enrollment') rather than using a separate MFAEnrollment model. This allows the
same brute-force protection, expiry, and single-use semantics to apply for both
the mid-login TOTP challenge (Case B) and the mid-login forced-enrollment token
(Case D). The `purpose` field disambiguates which view may consume the challenge.
"""

from django.conf import settings
from django.db import models


class UserMFA(models.Model):
    """
    One row per user that has started or completed MFA enrollment.

    States:
    - No row: user has never initiated enrollment.
    - enrolled_at IS NULL: enrollment started but not confirmed (abandoned).
    - enrolled_at set, disabled_at NULL: MFA active.
    - disabled_at set: MFA was active, then explicitly disabled.

    The is_active property is the canonical way to check whether a user's
    MFA is currently enforced.
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='mfa',
    )
    secret = models.CharField(max_length=64)  # base32 TOTP secret
    enrolled_at = models.DateTimeField(null=True, blank=True)   # set on first successful verify
    disabled_at = models.DateTimeField(null=True, blank=True)
    last_verified_at = models.DateTimeField(null=True, blank=True)

    @property
    def is_active(self) -> bool:
        return self.enrolled_at is not None and self.disabled_at is None

    def __str__(self):
        state = 'active' if self.is_active else ('abandoned' if self.enrolled_at is None else 'disabled')
        return f'UserMFA({self.user_id}, {state})'


class MFABackupCode(models.Model):
    """
    Single-use backup recovery code for a user's MFA.

    The raw code (`XXXX-XXXX` shape) is never stored; only a SHA-256 hex
    digest is persisted. Verification uses hmac.compare_digest to avoid
    timing attacks.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='mfa_backup_codes',
    )
    code_hash = models.CharField(max_length=64)   # sha256 hex of the raw code
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'MFABackupCode(user={self.user_id}, used={self.used_at is not None})'


class MFAChallenge(models.Model):
    """
    Intermediate token issued after the password step, consumed by the TOTP
    verification step.

    Brute-force protection: failed_attempts is incremented on every wrong code.
    After 5 failures the challenge is invalidated (invalidated_at set) and
    subsequent attempts return 401 even with the correct code. The user must
    start over with email+password.

    Binding: the JWT pair is always minted for challenge.user — the verify
    endpoint never accepts a user_id or email hint in its request body.

    Purpose field: distinguishes a mid-login TOTP challenge ('login') from a
    forced-enrollment token issued when the marina requires MFA but the user
    has none ('enrollment'). Each verify/enroll-complete endpoint validates
    that the challenge purpose matches before consuming it.
    """
    PURPOSE_CHOICES = [
        ('login', 'Login'),
        ('enrollment', 'Enrollment'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='mfa_challenges',
    )
    token = models.CharField(max_length=64, unique=True, db_index=True)  # secrets.token_urlsafe(48)
    purpose = models.CharField(max_length=20, choices=PURPOSE_CHOICES, default='login')
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    invalidated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'MFAChallenge(user={self.user_id}, purpose={self.purpose}, consumed={self.consumed_at is not None})'
