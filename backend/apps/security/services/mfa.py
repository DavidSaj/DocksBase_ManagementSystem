"""
MFA service functions for TOTP enrollment, verification, backup codes,
device trust cookies, and challenge token lifecycle.
"""

import hashlib
import hmac
import secrets
import time

import pyotp
from django.conf import settings
from django.core import signing
from django.utils import timezone

from apps.security.models import MFABackupCode, MFAChallenge, UserMFA

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TRUST_COOKIE_TTL = 30 * 24 * 3600  # 30 days in seconds
CHALLENGE_TTL_SECONDS = 5 * 60     # 5 minutes
BRUTE_FORCE_MAX_ATTEMPTS = 5
BACKUP_CODE_COUNT = 10


def _trust_cookie_name(user_id) -> str:
    return f'dbmfa_trust_{user_id}'


# ---------------------------------------------------------------------------
# Enrollment
# ---------------------------------------------------------------------------

def start_enrollment(user):
    """
    Start the MFA enrollment process for *user*. Returns (UserMFA, secret_b32).

    Four pre-existing states are handled per the spec:

    | Existing row state                            | Behaviour                                      |
    |-----------------------------------------------|------------------------------------------------|
    | No row                                        | Create with fresh secret, enrolled_at=None     |
    | Row exists, enrolled_at IS NULL (abandoned)   | Overwrite secret, discard orphan backup codes  |
    | Row exists, is_active (enrolled + not disabled)| Raise ValueError — user must disable first    |
    | Row exists, disabled_at set (was active)      | Overwrite secret, clear enrolled_at+disabled_at|

    Raises ValueError when the user already has active MFA.
    """
    secret = pyotp.random_base32(length=32)

    try:
        mfa = UserMFA.objects.get(user=user)
    except UserMFA.DoesNotExist:
        mfa = UserMFA.objects.create(user=user, secret=secret, enrolled_at=None)
        return mfa, secret

    if mfa.is_active:
        raise ValueError('User already has active MFA. Disable it before re-enrolling.')

    # Abandoned or disabled — overwrite secret and reset state
    MFABackupCode.objects.filter(user=user).delete()
    mfa.secret = secret
    mfa.enrolled_at = None
    mfa.disabled_at = None
    mfa.save(update_fields=['secret', 'enrolled_at', 'disabled_at'])
    return mfa, secret


def complete_enrollment(user, code: str):
    """
    Verify *code* against the user's pending (not-yet-enrolled) TOTP secret.

    On success: sets enrolled_at = now(), generates 10 backup codes, returns
    (UserMFA, [raw_code, ...]).

    Raises ValueError on bad code or if no pending enrollment exists.
    """
    try:
        mfa = UserMFA.objects.get(user=user)
    except UserMFA.DoesNotExist:
        raise ValueError('No enrollment in progress. Call start_enrollment first.')

    if mfa.is_active:
        raise ValueError('MFA is already fully enrolled.')

    totp = pyotp.TOTP(mfa.secret)
    if not totp.verify(code, valid_window=1):
        raise ValueError('Invalid TOTP code.')

    now = timezone.now()
    mfa.enrolled_at = now
    mfa.last_verified_at = now
    mfa.save(update_fields=['enrolled_at', 'last_verified_at'])

    raw_codes = _generate_backup_codes(user)
    return mfa, raw_codes


def disable_mfa(user, password: str):
    """
    Disable MFA for *user* after verifying their *password*.

    Sets disabled_at = now() and deletes all backup codes.
    Raises ValueError on wrong password or if MFA is not active.
    """
    if not user.check_password(password):
        raise ValueError('Incorrect password.')

    try:
        mfa = UserMFA.objects.get(user=user)
    except UserMFA.DoesNotExist:
        raise ValueError('MFA is not enabled for this user.')

    if not mfa.is_active:
        raise ValueError('MFA is not currently active.')

    mfa.disabled_at = timezone.now()
    mfa.save(update_fields=['disabled_at'])
    MFABackupCode.objects.filter(user=user).delete()


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

def verify_totp(user, code: str) -> bool:
    """
    Verify a 6-digit TOTP code against the user's active secret.
    Returns True on match (with ±30s skew tolerance), False otherwise.
    Also updates last_verified_at on success.
    """
    try:
        mfa = UserMFA.objects.get(user=user)
    except UserMFA.DoesNotExist:
        return False

    if not mfa.is_active:
        return False

    totp = pyotp.TOTP(mfa.secret)
    if totp.verify(code, valid_window=1):
        mfa.last_verified_at = timezone.now()
        mfa.save(update_fields=['last_verified_at'])
        return True
    return False


def consume_backup_code(user, raw_code: str) -> bool:
    """
    Attempt to consume a backup code for *user*.

    Checks all unused backup codes via hmac.compare_digest to avoid timing
    attacks. On a match, marks the code used (used_at = now()) and returns
    True. Returns False if no matching unused code is found.
    """
    raw_code = raw_code.strip().upper()
    code_hash = hashlib.sha256(raw_code.encode()).hexdigest()
    unused_codes = MFABackupCode.objects.filter(user=user, used_at__isnull=True)
    for backup in unused_codes:
        if hmac.compare_digest(backup.code_hash, code_hash):
            backup.used_at = timezone.now()
            backup.save(update_fields=['used_at'])
            return True
    return False


# ---------------------------------------------------------------------------
# Device trust cookie
# ---------------------------------------------------------------------------

def is_device_trusted(request, user) -> bool:
    """Return True if the request carries a valid 30-day trust cookie for *user*."""
    name = _trust_cookie_name(user.id)
    raw = request.COOKIES.get(name)
    if not raw:
        return False
    try:
        payload = signing.loads(raw, salt='mfa-trust', max_age=TRUST_COOKIE_TTL)
    except signing.BadSignature:
        return False
    return payload.get('user_id') == user.id


def mark_device_trusted(response, user):
    """Set a signed HttpOnly trust cookie on *response* for *user*."""
    raw = signing.dumps(
        {'user_id': user.id, 'trusted_at': time.time()},
        salt='mfa-trust',
    )
    response.set_cookie(
        _trust_cookie_name(user.id),
        raw,
        max_age=TRUST_COOKIE_TTL,
        httponly=True,
        secure=not settings.DEBUG,
        samesite='Lax',
    )


# ---------------------------------------------------------------------------
# Challenge tokens
# ---------------------------------------------------------------------------

def issue_challenge(user, purpose: str = 'login') -> MFAChallenge:
    """
    Issue a new MFAChallenge for *user* with the given *purpose*.
    Returns the saved MFAChallenge instance (use .token for the opaque string).
    """
    token = secrets.token_urlsafe(48)
    expires_at = timezone.now() + timezone.timedelta(seconds=CHALLENGE_TTL_SECONDS)
    return MFAChallenge.objects.create(
        user=user,
        token=token,
        purpose=purpose,
        expires_at=expires_at,
    )


def consume_challenge(token: str, purpose: str = 'login'):
    """
    Look up the challenge by *token*, check its validity, and return the bound
    User or None.

    Validity checks (any failure returns None):
    - Token exists.
    - Purpose matches.
    - Not expired (expires_at > now).
    - Not already consumed (consumed_at IS NULL).
    - Not invalidated (invalidated_at IS NULL).
    - failed_attempts < BRUTE_FORCE_MAX_ATTEMPTS (guard is checked before
      code verification — callers should call this then verify TOTP).

    NOTE: this function does NOT verify the TOTP code itself.  Callers are
    responsible for TOTP / backup-code verification after obtaining the user.
    On a bad code the caller must call record_failed_attempt(challenge).

    Returns MFAChallenge (not yet consumed) on valid token, or None.
    """
    now = timezone.now()
    try:
        challenge = MFAChallenge.objects.select_related('user').get(token=token)
    except MFAChallenge.DoesNotExist:
        return None

    if (
        challenge.purpose != purpose
        or challenge.expires_at <= now
        or challenge.consumed_at is not None
        or challenge.invalidated_at is not None
        or challenge.failed_attempts >= BRUTE_FORCE_MAX_ATTEMPTS
    ):
        return None

    return challenge


def record_failed_attempt(challenge: MFAChallenge):
    """
    Increment failed_attempts on *challenge*. If this reaches the cap,
    set invalidated_at = now().
    """
    challenge.failed_attempts += 1
    if challenge.failed_attempts >= BRUTE_FORCE_MAX_ATTEMPTS:
        challenge.invalidated_at = timezone.now()
    challenge.save(update_fields=['failed_attempts', 'invalidated_at'])


def mark_challenge_consumed(challenge: MFAChallenge):
    """Mark the challenge as consumed. Call this after successful verification."""
    challenge.consumed_at = timezone.now()
    challenge.save(update_fields=['consumed_at'])


# ---------------------------------------------------------------------------
# Provisioning URI (for QR code display)
# ---------------------------------------------------------------------------

def build_totp_uri(user, secret: str) -> str:
    """Return an otpauth:// URI suitable for display as a QR code."""
    return pyotp.totp.TOTP(secret).provisioning_uri(
        name=user.email,
        issuer_name='DocksBase',
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _generate_backup_codes(user) -> list:
    """
    Generate BACKUP_CODE_COUNT single-use backup codes for *user*.
    Deletes any existing codes first.
    Returns a list of raw code strings (shown to user once).
    """
    MFABackupCode.objects.filter(user=user).delete()
    raw_codes = []
    bulk = []
    for _ in range(BACKUP_CODE_COUNT):
        raw = _format_backup_code(secrets.token_hex(4))
        raw_codes.append(raw)
        code_hash = hashlib.sha256(raw.encode()).hexdigest()
        bulk.append(MFABackupCode(user=user, code_hash=code_hash))
    MFABackupCode.objects.bulk_create(bulk)
    return raw_codes


def _format_backup_code(hex8: str) -> str:
    """Format 8 hex chars as XXXX-XXXX (uppercase)."""
    upper = hex8.upper()
    return f'{upper[:4]}-{upper[4:]}'
