"""Waitlist API views.

Endpoints follow the spec; permissions are deliberately permissive in this
phase 1 implementation to keep the surface area shippable. Tighten via
``ModulePermission`` once the manager-side roles are wired up.
"""
from __future__ import annotations

from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import RefundAction, WaitlistEntry, WaitlistOffer
from .serializers import (
    RefundActionSerializer,
    WaitlistEntrySerializer,
    WaitlistOfferSerializer,
)
from . import services


def _marina_from_request(request):
    """Resolve the active marina from the standard tenant middleware."""
    return getattr(request, 'marina', None)


class WaitlistListCreateView(generics.ListCreateAPIView):
    serializer_class = WaitlistEntrySerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        marina = _marina_from_request(self.request)
        qs = WaitlistEntry.objects.all()
        if marina is not None:
            qs = qs.filter(marina=marina)
        return qs.order_by('priority_score', 'applied_at', 'id')

    def create(self, request, *args, **kwargs):
        marina = _marina_from_request(request) or _resolve_marina_explicit(request)
        if marina is None:
            return Response({'detail': 'No marina context'}, status=400)
        payload = request.data
        entry = services.apply(
            marina=marina,
            applicant_name=payload.get('applicant_name', ''),
            applicant_email=payload.get('applicant_email', ''),
            applicant_phone=payload.get('applicant_phone', ''),
            vessel_type=payload.get('vessel_type', ''),
            vessel_loa_m=payload.get('vessel_loa_m'),
            vessel_beam_m=payload.get('vessel_beam_m'),
            vessel_draft_m=payload.get('vessel_draft_m'),
            pref_min_loa_m=payload.get('pref_min_loa_m'),
            pref_max_loa_m=payload.get('pref_max_loa_m'),
        )
        return Response(WaitlistEntrySerializer(entry).data, status=201)


def _resolve_marina_explicit(request):
    marina_id = request.data.get('marina') if hasattr(request, 'data') else None
    if not marina_id:
        return None
    try:
        from apps.accounts.models import Marina
        return Marina.objects.filter(pk=marina_id).first()
    except Exception:
        return None


class WaitlistDetailView(generics.RetrieveAPIView):
    queryset = WaitlistEntry.objects.all()
    serializer_class = WaitlistEntrySerializer
    permission_classes = [permissions.AllowAny]


class WaitlistPayDepositView(APIView):
    """Returns a Stripe client_secret for the deposit PaymentIntent.

    Phase 1 implementation: best-effort. If Stripe is not configured the call
    returns a stub client_secret string so frontends can integrate.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        try:
            entry = WaitlistEntry.objects.get(pk=pk)
        except WaitlistEntry.DoesNotExist:
            return Response({'detail': 'Not found'}, status=404)
        try:
            from apps.billing.stripe_service import create_payment_intent
            client_secret = create_payment_intent(
                entry.marina, entry.deposit_amount_cents,
                entry.marina.currency,
                metadata={
                    'kind': 'waitlist_deposit',
                    'entry_id': str(entry.id),
                    'waitlist_entry_id': str(entry.id),  # legacy alias
                },
            )
        except Exception as exc:
            client_secret = f'stub_pending_{entry.id}'
            return Response({'client_secret': client_secret, 'stub': True, 'error': str(exc)})
        return Response({'client_secret': client_secret})


class WaitlistOfferTokenView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, token):
        try:
            offer = WaitlistOffer.objects.select_related('entry', 'offered_berth').get(magic_token=token)
        except WaitlistOffer.DoesNotExist:
            return Response({'detail': 'Not found'}, status=404)
        return Response(WaitlistOfferSerializer(offer).data)


class WaitlistOfferRespondView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request, token):
        decision = request.data.get('response') or request.data.get('decision')
        if decision not in ('accept', 'decline'):
            return Response({'detail': 'response must be accept|decline'}, status=400)
        try:
            result = services.respond_to_offer(
                token, decision,
                reason=request.data.get('reason', ''),
            )
        except services.OfferConflict as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(result)


class WaitlistManagerOfferView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        try:
            entry = WaitlistEntry.objects.get(pk=pk)
        except WaitlistEntry.DoesNotExist:
            return Response({'detail': 'Not found'}, status=404)
        berth_id = request.data.get('berth_id')
        if not berth_id:
            return Response({'detail': 'berth_id required'}, status=400)
        from apps.berths.models import Berth
        try:
            berth = Berth.objects.get(pk=berth_id)
        except Berth.DoesNotExist:
            return Response({'detail': 'Berth not found'}, status=404)
        hours = int(request.data.get('expires_in_hours') or 48)
        try:
            offer = services.offer_berth(entry, berth, expires_in_hours=hours)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=400)
        return Response(WaitlistOfferSerializer(offer).data, status=201)


class WaitlistWithdrawView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        try:
            entry = WaitlistEntry.objects.get(pk=pk)
        except WaitlistEntry.DoesNotExist:
            return Response({'detail': 'Not found'}, status=404)
        services.withdraw(entry)
        return Response(WaitlistEntrySerializer(entry).data)


class RefundActionCompleteView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request, pk, action_id):
        try:
            action = RefundAction.objects.get(pk=action_id, entry_id=pk)
        except RefundAction.DoesNotExist:
            return Response({'detail': 'Not found'}, status=404)
        services.complete_refund_action(
            action,
            user=request.user if getattr(request, 'user', None) and request.user.is_authenticated else None,
            note=request.data.get('audit_note', ''),
        )
        return Response(RefundActionSerializer(action).data)
