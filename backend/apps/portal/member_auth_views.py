import logging

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.members.models import Member
from apps.reservations.models import Booking

from .checkin_utils import make_portal_token
from .member_auth_utils import (
    decode_member_magic_token,
    decode_refresh_token,
    make_member_magic_token,
    make_member_session_token,
    make_refresh_token,
)

_log = logging.getLogger(__name__)


class MemberMagicRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        marina_slug = request.META.get('HTTP_X_MARINA_SLUG', '')

        if not email or not marina_slug:
            return Response({'detail': 'email and X-Marina-Slug required.'}, status=400)

        members = list(
            Member.objects.filter(email__iexact=email, marina__slug=marina_slug)
            .select_related('marina')
        )

        if len(members) == 0:
            # Deliberate no-op — don't leak whether email exists
            return Response({'detail': 'If that email is on file, a link has been sent.'})

        if len(members) == 1:
            member = members[0]
            token = make_member_magic_token(member_id=member.id, email=member.email)
            magic_url = (
                f"{getattr(settings, 'PORTAL_BASE_URL', 'https://book.docksbase.com')}"
                f"/{member.marina.slug}?member_token={token}"
            )
            send_mail(
                subject=f'Your sign-in link — {member.marina.name}',
                message=(
                    f'Hi {getattr(member, "first_name", None) or member.name or "there"},\n\n'
                    f'Click the link below to sign in to your member portal:\n\n'
                    f'{magic_url}\n\n'
                    f'This link expires in 24 hours.\n\n'
                    f'— {member.marina.name}'
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[member.email],
                fail_silently=True,
            )
            _log.info('MemberMagicRequest: sent link to member_id=%s', member.id)
        else:
            # Multiple members share this email — send a profile-picker email
            _log.info(
                'MemberMagicRequest: %d profiles for email=%s, sending picker',
                len(members), email,
            )
            links = []
            for m in members:
                token = make_member_magic_token(member_id=m.id, email=m.email)
                url = (
                    f"{getattr(settings, 'PORTAL_BASE_URL', 'https://book.docksbase.com')}"
                    f"/{m.marina.slug}?member_token={token}"
                )
                display_name = getattr(m, 'first_name', None) or m.name or m.email
                links.append(f'  • {display_name}: {url}')
            send_mail(
                subject=f'Select your profile — {members[0].marina.name}',
                message=(
                    f'Multiple member profiles are associated with {email}.\n\n'
                    f'Tap your name to sign in:\n\n'
                    + '\n'.join(links)
                    + '\n\nEach link expires in 24 hours.'
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
                fail_silently=True,
            )

        return Response({'detail': 'If that email is on file, a link has been sent.'})


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
        })
