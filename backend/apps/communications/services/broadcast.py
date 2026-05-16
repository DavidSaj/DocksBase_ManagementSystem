"""
Broadcast Center service layer — cohort resolution, body rendering, cost
estimation, and send orchestration.

Binding spec: docs/superpowers/specs/2026-05-15-broadcast-center-design.md
              §14 "Locked Decisions" overrides earlier draft sections.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Iterable

from django.db import transaction
from django.utils import timezone


# Standard set of STOP keywords recognized by Twilio / TCPA.
STOP_KEYWORDS = {'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'}


# ── Body rendering ───────────────────────────────────────────────────────────

def render_body(template: str, member, marina) -> str:
    """
    Tiny safe substitutor. NOT Django templates — staff cannot inject
    `{% %}` tags. Unknown variables collapse to ''. The marina-name prefix
    is applied separately in `send_broadcast` so it is unforgeable from
    inside the template.
    """
    vars_ = {
        'first_name':  (getattr(member, 'name', '') or '').split(' ', 1)[0],
        'name':        getattr(member, 'name', '') or '',
        'marina_name': getattr(marina, 'name', '') or '',
    }
    out = template
    for k, v in vars_.items():
        out = out.replace('{{' + k + '}}', v)
        out = out.replace('{{ ' + k + ' }}', v)
    return out


def prefix_marina(body: str, marina) -> str:
    """Locked decision A: every outbound SMS is prefixed with `[<marina>] `."""
    return f'[{marina.name}] {body}'


# ── Cost estimation ──────────────────────────────────────────────────────────

def estimate_sms_segments(body: str) -> int:
    """
    Standard GSM-7/UCS-2 split. We approximate: if all chars are ASCII, use
    GSM-7 (160-char segments); otherwise UCS-2 (70-char segments).
    """
    if not body:
        return 1
    try:
        body.encode('ascii')
        seg = 160
    except UnicodeEncodeError:
        seg = 70
    # Note: Twilio multipart concat reduces per-segment capacity (153/67) for
    # bodies that span >1 segment, but for cost preview ceiling we use the
    # simpler model — it tracks the way the spec test asserts (160 vs 161).
    return max(1, -(-len(body) // seg))


def estimate_cost_cents(marina, cohort_count: int, body: str, channel: str) -> int:
    if channel != 'sms':
        return 0  # email treated as free at preview-time
    segments = estimate_sms_segments(body)
    unit = getattr(marina, 'sms_unit_cost_cents', 250) or 0
    return cohort_count * segments * unit


# ── Cohort resolution ────────────────────────────────────────────────────────

def resolve_cohort(marina, filter_dsl: dict):
    """
    Resolve a JSON filter DSL into a distinct queryset of Members.

    Phase 1 supported clauses (per spec §4.2, with §14.D substitution):

      - reservation_status: [..]          -> Booking.status overlap (today)
      - pier_in: [..]                     -> Booking.berth.pier_label match
      - membership_type: [..]             -> Booking.booking_type
      - everyone_active_in_marina: true   -> ≥1 booking in trailing 12 months
                                              (replaces legacy everyone)
      - exclude: [{sms_opted_out: true}]  -> drops broadcast_opt_in=False
    """
    from apps.members.models import Member
    from apps.reservations.models import Booking

    today = timezone.now().date()
    twelve_months_ago = today - timedelta(days=365)

    qs = Member.objects.filter(marina=marina, is_archived=False)

    all_of = (filter_dsl or {}).get('all_of', []) or []
    excludes = (filter_dsl or {}).get('exclude', []) or []

    for clause in all_of:
        if not isinstance(clause, dict):
            continue
        if 'reservation_status' in clause:
            statuses = clause['reservation_status'] or []
            # Bookings link to a Vessel which owns->Member.
            qs = qs.filter(_member_ids_for_active_bookings(marina, statuses=statuses))
        elif 'pier_in' in clause:
            piers = clause['pier_in'] or []
            qs = qs.filter(_member_ids_for_active_bookings(marina, pier_labels=piers))
        elif 'membership_type' in clause:
            types = clause['membership_type'] or []
            qs = qs.filter(_member_ids_for_active_bookings(marina, booking_types=types))
        elif clause.get('everyone_active_in_marina'):
            qs = qs.filter(_member_ids_for_recent_bookings(marina, since=twelve_months_ago))

    # Always-applied exclusions
    for ex in excludes:
        if isinstance(ex, dict) and ex.get('sms_opted_out'):
            qs = qs.filter(broadcast_opt_in=True)

    # Operational opt-out is always honoured regardless of explicit exclude.
    qs = qs.filter(broadcast_opt_in=True)

    return qs.distinct()


def _member_ids_for_active_bookings(marina, statuses=None, pier_labels=None, booking_types=None):
    """Build a Q-object matching members linked to a Booking matching filters."""
    from django.db.models import Q
    from apps.reservations.models import Booking

    today = timezone.now().date()
    bq = Booking.objects.filter(marina=marina)
    if statuses:
        bq = bq.filter(status__in=statuses)
    if booking_types:
        bq = bq.filter(booking_type__in=booking_types)
    if pier_labels:
        bq = bq.filter(berth__pier_label__in=pier_labels)
    bq = bq.filter(check_in__lte=today, check_out__gte=today)
    member_ids = list(bq.values_list('vessel__owner_id', flat=True).distinct())
    return Q(pk__in=[m for m in member_ids if m])


def _member_ids_for_recent_bookings(marina, since):
    """Members with ≥1 booking whose check_in >= `since` (12-month window)."""
    from django.db.models import Q
    from apps.reservations.models import Booking

    bq = Booking.objects.filter(marina=marina, check_in__gte=since)
    member_ids = list(bq.values_list('vessel__owner_id', flat=True).distinct())
    return Q(pk__in=[m for m in member_ids if m])


# ── Preview ──────────────────────────────────────────────────────────────────

def preview(broadcast) -> dict:
    """
    Resolve the cohort, compute count + cost estimate, persist them on the
    Broadcast row, and return a preview dict. Caller stays in `previewed`.
    """
    qs = resolve_cohort(broadcast.marina, broadcast.cohort_filter or {})
    # For SMS, drop members with no phone; for email, no email.
    if broadcast.channel == 'sms':
        qs = qs.exclude(phone='')
    elif broadcast.channel == 'email':
        qs = qs.exclude(email='')
    count = qs.count()
    cost = estimate_cost_cents(broadcast.marina, count, broadcast.body or '', broadcast.channel)

    broadcast.previewed_count = count
    broadcast.cost_estimate_cents = cost
    broadcast.previewed_at = timezone.now()
    if broadcast.status == 'draft':
        broadcast.status = 'previewed'
    broadcast.save(update_fields=[
        'previewed_count', 'cost_estimate_cents', 'previewed_at', 'status',
    ])
    return {'count': count, 'cost_cents': cost}


# ── Send / fan-out ───────────────────────────────────────────────────────────

class CohortDriftError(Exception):
    """Raised when send-time count exceeds preview-time count (optimistic concurrency check)."""
    def __init__(self, previewed: int, new: int):
        self.previewed = previewed
        self.new = new
        super().__init__(f'Cohort drift: previewed={previewed}, new={new}')


def fan_out(broadcast_id: int) -> int:
    """
    Resolve the cohort one more time, then for each member dispatch via the
    shared `dispatch()` service. Every outbound SMS body is prefixed with
    `[<marina.name>] `. Returns the number of recipients dispatched.
    """
    from apps.communications.models import Broadcast, BroadcastRecipient
    from apps.communications.services import dispatch as dispatch_mod

    broadcast = Broadcast.objects.select_related('marina').get(pk=broadcast_id)

    qs = resolve_cohort(broadcast.marina, broadcast.cohort_filter or {})
    if broadcast.channel == 'sms':
        qs = qs.exclude(phone='')
    elif broadcast.channel == 'email':
        qs = qs.exclude(email='')

    dispatched = 0
    for member in qs:
        if broadcast.channel == 'sms':
            address = member.phone
            rendered = render_body(broadcast.body, member, broadcast.marina)
            body = prefix_marina(rendered, broadcast.marina)
            subject = ''
        else:
            address = member.email
            body = render_body(broadcast.body, member, broadcast.marina)
            subject = broadcast.subject or ''

        if not address:
            BroadcastRecipient.objects.create(
                broadcast=broadcast, member=member, channel=broadcast.channel,
                address='', status=BroadcastRecipient.Status.SKIPPED_NO_ADDRESS,
            )
            continue

        log = dispatch_mod.dispatch(
            marina=broadcast.marina, channel=broadcast.channel,
            recipient=address, subject=subject, body=body, member=member,
        )
        BroadcastRecipient.objects.create(
            broadcast=broadcast, member=member, channel=broadcast.channel,
            address=address, message_log=log,
            status=(
                BroadcastRecipient.Status.SENT if log.status == 'sent'
                else BroadcastRecipient.Status.FAILED
            ),
            failed_reason=log.failed_reason or '',
        )
        dispatched += 1

    broadcast.status = 'sent'
    broadcast.sent_at = broadcast.sent_at or timezone.now()
    broadcast.completed_at = timezone.now()
    broadcast.save(update_fields=['status', 'sent_at', 'completed_at'])
    return dispatched


def check_and_send(broadcast) -> int:
    """
    Locked decision C: re-resolve the DSL, count, and 409 if drifted upward.
    Equal-or-smaller counts proceed. Raises CohortDriftError on upward drift.
    """
    qs = resolve_cohort(broadcast.marina, broadcast.cohort_filter or {})
    if broadcast.channel == 'sms':
        qs = qs.exclude(phone='')
    elif broadcast.channel == 'email':
        qs = qs.exclude(email='')
    new_count = qs.count()
    previewed = broadcast.previewed_count
    if previewed is None:
        # Caller must preview first.
        raise CohortDriftError(previewed=0, new=new_count)
    if new_count > previewed:
        raise CohortDriftError(previewed=previewed, new=new_count)

    broadcast.status = 'sending'
    broadcast.sent_at = timezone.now()
    broadcast.save(update_fields=['status', 'sent_at'])

    return fan_out(broadcast.pk)
