"""Per-view context resolvers that bridge boater and legacy auth.

The portal views that existed before the boater-token migration all looked up
records via `request.user.marina_slug` + `request.user.member_id` (or
`.booking_id`). Those attributes only exist on the legacy `PortalMemberUser` /
`PortalUser`. A boater-scoped session token authenticates as a `BoaterUser`
which carries only `.email` — it has no marina or member claim.

These helpers normalise the lookup. Each view calls one of them and gets back
either a fully-resolved domain object (Member, Booking) or `None`, regardless
of which token shape arrived. Marina is sourced from the `X-Marina-Slug`
header when the user is a `BoaterUser`; per-marina access is gated by
`resolve_marina_for_boater`.
"""
from apps.members.models import Member
from apps.reservations.models import Booking

from .boater_access import resolve_marina_for_boater
from .boater_session import BoaterUser


def _marina_for_request(request):
    user = request.user
    if isinstance(user, BoaterUser):
        slug = request.META.get('HTTP_X_MARINA_SLUG', '')
        return resolve_marina_for_boater(user, slug)
    slug = getattr(user, 'marina_slug', None)
    if not slug:
        return None
    from apps.accounts.models import Marina
    return Marina.objects.filter(slug=slug).first()


def resolve_portal_member(request):
    """Return the Member row for this request's (user, marina) pair, or None.

    Works for both legacy `PortalMemberUser` (uses token's `member_id` +
    `marina_slug`) and `BoaterUser` (uses `email` + `X-Marina-Slug` header).
    `BoaterUser` requests are gated by `resolve_marina_for_boater` first.
    """
    user = request.user
    if isinstance(user, BoaterUser):
        marina = _marina_for_request(request)
        if marina is None:
            return None
        return (
            Member.objects
            .filter(email__iexact=user.email, marina=marina)
            .select_related('marina')
            .first()
        )

    member_id = getattr(user, 'member_id', None)
    marina_slug = getattr(user, 'marina_slug', None)
    if not member_id or not marina_slug:
        return None
    return (
        Member.objects
        .filter(id=member_id, marina__slug=marina_slug)
        .select_related('marina')
        .first()
    )


def resolve_portal_booking(request, booking_pk):
    """Return the Booking iff this request's user is authorised for it.

    Legacy `PortalUser` requires `request.user.booking_id == booking_pk`.
    `BoaterUser` requires a Booking with the user's email at the marina from
    `X-Marina-Slug` (which itself must pass `resolve_marina_for_boater`).
    """
    user = request.user
    if isinstance(user, BoaterUser):
        marina = _marina_for_request(request)
        if marina is None:
            return None
        return (
            Booking.objects
            .filter(pk=booking_pk, guest_email__iexact=user.email, marina=marina)
            .select_related('marina')
            .first()
        )

    booking_id = getattr(user, 'booking_id', None)
    if booking_id != booking_pk:
        return None
    return Booking.objects.select_related('marina').filter(pk=booking_pk).first()
