import datetime as _dt
import logging

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.members.models import Member
from apps.reservations.models import Booking

from .boater_session import (
    decode_boater_refresh_token,
    make_boater_refresh_token,
    make_boater_session_token,
)
from .checkin_utils import make_portal_token, make_magic_token, make_reservation_portal_token
from .member_auth_utils import (
    decode_member_magic_token,
    decode_refresh_token,
    make_member_magic_token,
    make_member_session_token,
    make_refresh_token,
)

_log = logging.getLogger(__name__)


class MemberMagicVerifyView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get('token', '')
        if not token:
            return Response({'detail': 'token required.'}, status=400)

        try:
            payload = decode_member_magic_token(token)
        except signing.BadSignature:
            return Response({'detail': 'Invalid or expired link.'}, status=401)

        try:
            member = Member.objects.select_related('marina').get(
                pk=payload['member_id'],
                email=payload['email'],
            )
        except Member.DoesNotExist:
            return Response({'detail': 'Member not found.'}, status=401)

        session_token = make_member_session_token(
            member_id=member.id,
            marina_slug=member.marina.slug,
            email=member.email,
        )
        refresh_token = make_refresh_token(
            member_id=member.id,
            marina_slug=member.marina.slug,
            email=member.email,
        )
        return Response({
            'session_token': session_token,
            'refresh_token': refresh_token,
            'member_id': member.id,
            'marina_slug': member.marina.slug,
            'boater_session_token': make_boater_session_token(member.email),
            'boater_refresh_token': make_boater_refresh_token(member.email),
        })


class MemberMagicRefreshView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get('refresh_token', '')
        if not token:
            return Response({'detail': 'refresh_token required.'}, status=400)

        try:
            payload = decode_refresh_token(token)
        except signing.BadSignature:
            return Response({'detail': 'Refresh token invalid or expired.'}, status=401)

        try:
            member = Member.objects.select_related('marina').get(
                pk=payload['member_id'],
                email=payload['email'],
            )
        except Member.DoesNotExist:
            return Response({'detail': 'Member not found.'}, status=401)

        session_token = make_member_session_token(
            member_id=member.id,
            marina_slug=member.marina.slug,
            email=member.email,
        )
        new_refresh = make_refresh_token(
            member_id=member.id,
            marina_slug=member.marina.slug,
            email=member.email,
        )
        return Response({
            'session_token': session_token,
            'refresh_token': new_refresh,
            'boater_session_token': make_boater_session_token(member.email),
            'boater_refresh_token': make_boater_refresh_token(member.email),
        })


class BoaterRefreshView(APIView):
    """Exchange a long-lived boater refresh token for a fresh session token.

    Frontend calls this when its 1-hour boater session token expires, before
    falling back to the legacy member-refresh flow.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get('refresh_token', '')
        if not token:
            return Response({'detail': 'refresh_token required.'}, status=400)
        try:
            payload = decode_boater_refresh_token(token)
        except signing.BadSignature:
            return Response({'detail': 'Refresh token invalid or expired.'}, status=401)
        email = payload['email']
        return Response({
            'boater_session_token': make_boater_session_token(email),
            'boater_refresh_token': make_boater_refresh_token(email),
        })


class GuestInstantLoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email       = (request.data.get('email') or '').strip().lower()
        ref         = (request.data.get('booking_reference') or '').strip().upper()
        marina_slug = request.META.get('HTTP_X_MARINA_SLUG', '')

        if not email or not ref or not marina_slug:
            return Response(
                {'detail': 'email, booking_reference, and X-Marina-Slug required.'},
                status=400,
            )

        if ref.startswith('RES-'):
            # Reservation cart flow — email + RES-{pk} authenticate into a Reservation
            from apps.reservations.models import Reservation
            try:
                res_pk = int(ref[4:])
            except ValueError:
                return Response({'detail': 'No booking found.'}, status=401)
            try:
                reservation = Reservation.objects.select_related('marina').get(
                    pk=res_pk,
                    guest_email__iexact=email,
                    marina__slug=marina_slug,
                )
            except Reservation.DoesNotExist:
                return Response({'detail': 'No booking found.'}, status=401)
            session_token = make_reservation_portal_token(
                reservation_id=reservation.pk,
                marina_slug=reservation.marina.slug,
                boater_email=reservation.guest_email,
            )
            return Response({
                'token': session_token,
                'reservation_id': reservation.pk,
                'marina_slug': reservation.marina.slug,
                'boater_session_token': make_boater_session_token(reservation.guest_email),
                'boater_refresh_token': make_boater_refresh_token(reservation.guest_email),
            })

        # Legacy BK- reference (existing Booking)
        if ref.startswith('BK-'):
            ref = ref[3:]
        try:
            booking_pk = int(ref)
        except ValueError:
            return Response({'detail': 'No booking found.'}, status=401)

        try:
            booking = Booking.objects.select_related('marina').get(
                pk=booking_pk,
                guest_email__iexact=email,
                marina__slug=marina_slug,
            )
        except Booking.DoesNotExist:
            return Response({'detail': 'No booking found.'}, status=401)

        session_token = make_portal_token(
            booking_id=booking.id,
            marina_slug=booking.marina.slug,
            boater_email=booking.guest_email,
        )
        return Response({
            'token': session_token,
            'booking_id': booking.id,
            'marina_slug': booking.marina.slug,
            'boater_session_token': make_boater_session_token(booking.guest_email),
            'boater_refresh_token': make_boater_refresh_token(booking.guest_email),
        })


class UnifiedRequestLinkView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email       = (request.data.get('email') or '').strip().lower()
        marina_slug = request.META.get('HTTP_X_MARINA_SLUG', '')
        SILENT      = Response({'detail': 'If an account exists, a secure link has been sent.'})

        if not email or not marina_slug:
            return Response({'detail': 'email and X-Marina-Slug required.'}, status=400)

        base  = getattr(settings, 'PORTAL_BASE_URL', 'https://portal.docksbase.com')
        today = _dt.date.today()

        members = list(
            Member.objects.filter(email__iexact=email, marina__slug=marina_slug)
            .select_related('marina')
        )
        bookings = list(
            Booking.objects.filter(
                guest_email__iexact=email,
                marina__slug=marina_slug,
                check_out__gte=today,
            ).select_related('marina').order_by('check_in')
        )

        if not members and not bookings:
            return SILENT

        marina_name  = (members[0].marina if members else bookings[0].marina).name
        member_lines = []
        guest_lines  = []

        for m in members:
            token = make_member_magic_token(member_id=m.id, email=m.email)
            url   = f"{base}/{m.marina.slug}?token=m_{token}"
            label = getattr(m, 'name', None) or m.email
            member_lines.append(f"Member Dashboard ({label}): {url}")

        for bk in bookings:
            token = make_magic_token(bk.id, bk.guest_email)
            url   = f"{base}/{bk.marina.slug}?token=g_{token}"
            guest_lines.append(
                f"BK-{bk.pk} ({bk.check_in} → {bk.check_out}): {url}"
            )

        all_lines = member_lines + guest_lines
        body = (
            f"Secure sign-in links for {email} at {marina_name}:\n\n"
            + '\n'.join(all_lines)
            + "\n\nEach link expires in 72 hours."
        )

        send_mail(
            subject=f'Your sign-in link — {marina_name}',
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            fail_silently=True,
        )
        return SILENT
