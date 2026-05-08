from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.loyalty.models import (
    CouponCode,
    CreditTransaction,
    LoyaltyMembership,
    LoyaltyTier,
    MemberCreditAccount,
    PointsLedger,
    ReferralCode,
    ReferralUse,
)
from apps.loyalty.serializers import (
    AdjustPointsSerializer,
    ApplyCouponSerializer,
    CouponCodeSerializer,
    CreditTransactionSerializer,
    EarnPointsSerializer,
    LoyaltyMembershipSerializer,
    LoyaltyTierSerializer,
    MemberCreditAccountSerializer,
    PointsLedgerSerializer,
    RedeemPointsSerializer,
    ReferralCodeSerializer,
    ReferralUseSerializer,
    TopUpCreditSerializer,
)

# ── Tiers ─────────────────────────────────────────────────────────────────────

class LoyaltyTierListCreateView(generics.ListCreateAPIView):
    serializer_class = LoyaltyTierSerializer

    def get_queryset(self):
        return LoyaltyTier.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class LoyaltyTierDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = LoyaltyTierSerializer

    def get_queryset(self):
        return LoyaltyTier.objects.filter(marina=self.request.user.marina)


# ── Memberships ────────────────────────────────────────────────────────────────

class LoyaltyMembershipListView(generics.ListAPIView):
    serializer_class = LoyaltyMembershipSerializer

    def get_queryset(self):
        return (
            LoyaltyMembership.objects
            .filter(marina=self.request.user.marina)
            .select_related('member', 'tier')
            .order_by('-points_balance')
        )


class LoyaltyMembershipDetailView(generics.RetrieveAPIView):
    serializer_class = LoyaltyMembershipSerializer

    def get_queryset(self):
        return LoyaltyMembership.objects.filter(
            marina=self.request.user.marina
        ).select_related('member', 'tier')


# ── Points ledger ──────────────────────────────────────────────────────────────

class MemberPointsLedgerView(generics.ListAPIView):
    serializer_class = PointsLedgerSerializer

    def get_queryset(self):
        member_id = self.kwargs['member_id']
        return PointsLedger.objects.filter(
            membership__marina=self.request.user.marina,
            membership__member_id=member_id,
        ).select_related('invoice', 'created_by', 'membership__member')


class PointsLedgerListView(generics.ListAPIView):
    """
    Marina-wide points ledger — used by the frontend /points-ledger/ endpoint.
    Supports ?entry_type= filtering.
    """
    serializer_class = PointsLedgerSerializer

    def get_queryset(self):
        qs = PointsLedger.objects.filter(
            membership__marina=self.request.user.marina,
        ).select_related('invoice', 'created_by', 'membership__member').order_by('-created_at')
        entry_type = self.request.query_params.get('entry_type')
        if entry_type:
            qs = qs.filter(entry_type=entry_type)
        return qs


# ── Earn points ────────────────────────────────────────────────────────────────

class EarnPointsView(APIView):
    """POST /api/v1/loyalty/memberships/<pk>/earn-points/"""
    def post(self, request, pk):
        ser = EarnPointsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        from apps.loyalty.services import earn_points
        from apps.billing.models import Invoice

        invoice = None
        invoice_id = ser.validated_data.get('invoice')
        if invoice_id:
            try:
                invoice = Invoice.objects.get(pk=invoice_id, marina=request.user.marina)
            except Invoice.DoesNotExist:
                return Response({'detail': 'Invoice not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            membership = LoyaltyMembership.objects.get(pk=pk, marina=request.user.marina)
        except LoyaltyMembership.DoesNotExist:
            return Response({'detail': 'Membership not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            entry = earn_points(
                membership_pk=membership.pk,
                invoice=invoice,
                points=ser.validated_data['points'],
                entry_type=ser.validated_data['entry_type'],
                description=ser.validated_data.get('description', ''),
                created_by=getattr(request.user, 'staffmember', None),
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(PointsLedgerSerializer(entry).data, status=status.HTTP_201_CREATED)


# ── Redeem points ──────────────────────────────────────────────────────────────

class RedeemPointsView(APIView):
    """POST /api/v1/loyalty/redeem-points/ — deduct points from a membership."""
    def post(self, request):
        ser = RedeemPointsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        from apps.loyalty.services import redeem_points
        from apps.billing.models import Invoice

        try:
            membership = LoyaltyMembership.objects.get(
                pk=ser.validated_data['membership'],
                marina=request.user.marina,
            )
        except LoyaltyMembership.DoesNotExist:
            return Response({'detail': 'Membership not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            invoice = Invoice.objects.get(
                pk=ser.validated_data['invoice'],
                marina=request.user.marina,
            )
        except Invoice.DoesNotExist:
            return Response({'detail': 'Invoice not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            entry = redeem_points(
                membership_pk=membership.pk,
                points=ser.validated_data['points'],
                invoice=invoice,
                created_by=getattr(request.user, 'staffmember', None),
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(PointsLedgerSerializer(entry).data, status=status.HTTP_201_CREATED)


# ── Adjust points ──────────────────────────────────────────────────────────────

class AdjustPointsView(APIView):
    """POST /api/v1/loyalty/memberships/<pk>/adjust-points/"""
    def post(self, request, pk):
        ser = AdjustPointsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        from apps.loyalty.services import adjust_points_manual

        try:
            membership = LoyaltyMembership.objects.get(pk=pk, marina=request.user.marina)
        except LoyaltyMembership.DoesNotExist:
            return Response({'detail': 'Membership not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            entry = adjust_points_manual(
                membership_pk=membership.pk,
                points=ser.validated_data['points'],
                description=ser.validated_data['description'],
                created_by=getattr(request.user, 'staffmember', None),
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(PointsLedgerSerializer(entry).data, status=status.HTTP_201_CREATED)


# ── Referral codes ─────────────────────────────────────────────────────────────

class ReferralCodeListCreateView(generics.ListCreateAPIView):
    serializer_class = ReferralCodeSerializer

    def get_queryset(self):
        return ReferralCode.objects.filter(marina=self.request.user.marina).select_related('member')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class ReferralCodeDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ReferralCodeSerializer

    def get_queryset(self):
        return ReferralCode.objects.filter(marina=self.request.user.marina)


class ReferralUseListView(generics.ListAPIView):
    serializer_class = ReferralUseSerializer

    def get_queryset(self):
        return ReferralUse.objects.filter(
            referral_code__marina=self.request.user.marina
        ).select_related('referral_code', 'referee_member', 'referee_booking')


# ── Coupons ────────────────────────────────────────────────────────────────────

class CouponCodeListCreateView(generics.ListCreateAPIView):
    serializer_class = CouponCodeSerializer

    def get_queryset(self):
        return CouponCode.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class CouponCodeDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CouponCodeSerializer

    def get_queryset(self):
        return CouponCode.objects.filter(marina=self.request.user.marina)


class ApplyCouponView(APIView):
    """POST /api/v1/loyalty/apply-coupon/ — apply a coupon code to an existing draft invoice."""
    def post(self, request):
        ser = ApplyCouponSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        from apps.billing.models import Invoice
        from apps.loyalty.services import apply_coupon

        try:
            invoice = Invoice.objects.get(
                pk=ser.validated_data['invoice'],
                marina=request.user.marina,
                status='draft',
            )
        except Invoice.DoesNotExist:
            return Response({'detail': 'Draft invoice not found.'}, status=status.HTTP_404_NOT_FOUND)

        discount = apply_coupon(
            code_str=ser.validated_data['code'],
            invoice=invoice,
            marina=request.user.marina,
        )

        if discount == 0:
            return Response({'detail': 'Coupon invalid or not applicable.'}, status=status.HTTP_400_BAD_REQUEST)

        return Response({'discount_applied': str(discount)})


# ── Credit account ─────────────────────────────────────────────────────────────

class MemberCreditAccountView(generics.RetrieveAPIView):
    serializer_class = MemberCreditAccountSerializer

    def get_object(self):
        from apps.loyalty.services import get_or_create_credit_account
        from apps.members.models import Member

        member = Member.objects.get(pk=self.kwargs['member_id'], marina=self.request.user.marina)
        return get_or_create_credit_account(member, self.request.user.marina)


class MemberCreditTransactionsView(generics.ListAPIView):
    serializer_class = CreditTransactionSerializer

    def get_queryset(self):
        return CreditTransaction.objects.filter(
            account__marina=self.request.user.marina,
            account__member_id=self.kwargs['member_id'],
        )


class TopUpCreditView(APIView):
    """POST /api/v1/loyalty/top-up-credit/ — add credit to member wallet."""
    def post(self, request):
        ser = TopUpCreditSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        from apps.members.models import Member
        from apps.loyalty.services import get_or_create_credit_account, top_up_credit

        try:
            member = Member.objects.get(pk=ser.validated_data['member'], marina=request.user.marina)
        except Member.DoesNotExist:
            return Response({'detail': 'Member not found.'}, status=status.HTTP_404_NOT_FOUND)

        get_or_create_credit_account(member, request.user.marina)
        tx = top_up_credit(
            member=member,
            marina=request.user.marina,
            amount=ser.validated_data['amount'],
            description=ser.validated_data.get('description', ''),
        )
        return Response(CreditTransactionSerializer(tx).data, status=status.HTTP_201_CREATED)
