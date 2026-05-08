"""
Members service layer — Track 3: duplicate detection and member merging.
"""
import difflib
import re

from django.db import transaction
from django.utils import timezone


def _normalize_phone(phone: str) -> str:
    """Strip all non-digit characters for comparison."""
    return re.sub(r'\D', '', phone)


def check_for_duplicates(marina, new_member, name: str, email: str, phone: str, vessel_name: str) -> list:
    """
    Run three duplicate-detection rules and create DuplicateFlag records for any matches.

    Rules:
      1. EMAIL   — case-insensitive exact match on email (ignoring blank).
      2. PHONE   — digit-normalized phone match (ignoring blank).
      3. VESSEL_NAME — vessel name provided AND member name similarity >= 0.85
                       via difflib.SequenceMatcher.

    Returns a list of created DuplicateFlag instances.
    """
    from apps.members.models import Member, DuplicateFlag

    created_flags = []

    candidates = Member.objects.filter(
        marina=marina, is_archived=False
    ).exclude(pk=new_member.pk)

    # Rule 1: Email match
    if email:
        email_matches = candidates.filter(email__iexact=email)
        for match in email_matches:
            flag = _create_flag(marina, new_member, match, DuplicateFlag.MatchRule.EMAIL)
            if flag:
                created_flags.append(flag)

    # Rule 2: Normalized phone match
    if phone:
        norm_phone = _normalize_phone(phone)
        if norm_phone:
            for candidate in candidates.exclude(phone=''):
                if _normalize_phone(candidate.phone) == norm_phone:
                    flag = _create_flag(marina, new_member, candidate, DuplicateFlag.MatchRule.PHONE)
                    if flag:
                        created_flags.append(flag)

    # Rule 3: Vessel name + member name similarity
    if vessel_name:
        for candidate in candidates:
            ratio = difflib.SequenceMatcher(
                None,
                name.lower().strip(),
                candidate.name.lower().strip(),
            ).ratio()
            if ratio >= 0.85:
                flag = _create_flag(marina, new_member, candidate, DuplicateFlag.MatchRule.VESSEL_NAME)
                if flag:
                    created_flags.append(flag)

    return created_flags


def _create_flag(marina, member_a, member_b, match_rule):
    """
    Create a DuplicateFlag ensuring member_a.pk < member_b.pk for uniqueness consistency.
    Returns None if the flag already exists.
    """
    from apps.members.models import DuplicateFlag

    # Enforce canonical ordering to satisfy unique_together
    if member_a.pk > member_b.pk:
        member_a, member_b = member_b, member_a

    try:
        flag, created = DuplicateFlag.objects.get_or_create(
            member_a=member_a,
            member_b=member_b,
            defaults={
                'marina': marina,
                'match_rule': match_rule,
                'status': DuplicateFlag.Status.PENDING,
            },
        )
        return flag if created else None
    except Exception:
        return None


def merge_members(flag_id: int, keep_member_id: int, resolved_by) -> 'Member':
    """
    Merge the two members identified by flag_id.
    keep_member_id determines which member record is kept; the other is archived.

    Reassigns:
      - reservations.Booking
      - billing.Invoice
      - billing.DunningLetter
      - loyalty.LoyaltyMembership (merges points into keep member's membership)

    Marks the discard member as archived, sets merged_into = keep_member,
    and updates the DuplicateFlag to MERGED.

    All changes run inside a single atomic transaction.
    """
    from apps.members.models import Member, DuplicateFlag
    from apps.loyalty.models import LoyaltyMembership

    with transaction.atomic():
        flag = DuplicateFlag.objects.select_for_update().get(pk=flag_id)

        if flag.member_a_id == keep_member_id:
            keep = flag.member_a
            discard = flag.member_b
        elif flag.member_b_id == keep_member_id:
            keep = flag.member_b
            discard = flag.member_a
        else:
            raise ValueError(
                f'keep_member_id {keep_member_id} is not part of flag {flag_id}'
            )

        # Reassign Bookings
        try:
            from apps.reservations.models import Booking
            Booking.objects.filter(member=discard).update(member=keep)
        except ImportError:
            pass

        # Reassign Invoices
        try:
            from apps.billing.models import Invoice
            Invoice.objects.filter(member=discard).update(member=keep)
        except ImportError:
            pass

        # Reassign DunningLetters
        try:
            from apps.billing.models import DunningLetter
            DunningLetter.objects.filter(member=discard).update(member=keep)
        except ImportError:
            pass

        # Merge LoyaltyMembership — carry over points and lifetime_spend
        try:
            discard_membership = LoyaltyMembership.objects.filter(
                marina=keep.marina, member=discard
            ).first()
            if discard_membership:
                keep_membership, _ = LoyaltyMembership.objects.get_or_create(
                    marina=keep.marina, member=keep,
                    defaults={'points_balance': 0, 'lifetime_spend': 0, 'qualifying_stays': 0},
                )
                keep_membership.points_balance += discard_membership.points_balance
                keep_membership.lifetime_spend += discard_membership.lifetime_spend
                keep_membership.qualifying_stays += discard_membership.qualifying_stays
                keep_membership.save(update_fields=['points_balance', 'lifetime_spend', 'qualifying_stays'])
                # Re-point ledger entries to keep_membership
                discard_membership.ledger_entries.update(membership=keep_membership)
                discard_membership.delete()
        except Exception:
            pass

        # Archive the discard member
        discard.is_archived = True
        discard.merged_into = keep
        discard.save(update_fields=['is_archived', 'merged_into'])

        # Mark flag as merged
        flag.status = DuplicateFlag.Status.MERGED
        flag.reviewed_by = resolved_by
        flag.reviewed_at = timezone.now()
        flag.save(update_fields=['status', 'reviewed_by', 'reviewed_at'])

    return keep
