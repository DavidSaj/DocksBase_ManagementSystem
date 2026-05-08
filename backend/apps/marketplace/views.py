from django.db import transaction
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.marketplace.models import BerthListing, BerthListingPhoto, BerthEnquiry, ExchangeListing, ExchangeAgreement
from apps.marketplace.serializers import (
    BerthListingSerializer, PublicBerthListingSerializer, BerthListingPhotoSerializer,
    BerthEnquirySerializer, ExchangeListingSerializer, ExchangeAgreementSerializer,
)


class MarinaMixin:
    def get_marina(self):
        return self.request.user.marina


class BerthListingListCreateView(MarinaMixin, generics.ListCreateAPIView):
    serializer_class = BerthListingSerializer

    def get_queryset(self):
        return BerthListing.objects.filter(marina=self.get_marina()).prefetch_related('photos')

    def perform_create(self, serializer):
        serializer.save(marina=self.get_marina())


class BerthListingDetailView(MarinaMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BerthListingSerializer

    def get_queryset(self):
        return BerthListing.objects.filter(marina=self.get_marina())


class BerthListingPublishView(MarinaMixin, APIView):
    def post(self, request, pk):
        listing = BerthListing.objects.get(pk=pk, marina=self.get_marina())
        if listing.status != 'draft':
            return Response({'error': 'Only draft listings can be published.'}, status=status.HTTP_400_BAD_REQUEST)
        listing.status = 'published'
        listing.published_at = timezone.now()
        listing.save(update_fields=['status', 'published_at'])
        return Response(BerthListingSerializer(listing).data)


class BerthListingMarkSoldView(MarinaMixin, APIView):
    def post(self, request, pk):
        listing = BerthListing.objects.get(pk=pk, marina=self.get_marina())
        sale_price = request.data.get('sale_price')
        sold_to_member_id = request.data.get('sold_to_member')
        transfer_date = request.data.get('transfer_date')

        with transaction.atomic():
            from apps.members.models import Member
            sold_to = Member.objects.get(pk=sold_to_member_id, marina=self.get_marina()) if sold_to_member_id else None
            listing.status = 'sold'
            listing.sale_price = sale_price
            listing.sold_to_member = sold_to
            listing.transfer_date = transfer_date
            listing.save(update_fields=['status', 'sale_price', 'sold_to_member', 'transfer_date'])

            berth = listing.berth
            berth.vessel = None
            berth.save(update_fields=['vessel'])

        return Response(BerthListingSerializer(listing).data)


class BerthListingPhotoListCreateView(MarinaMixin, generics.ListCreateAPIView):
    serializer_class = BerthListingPhotoSerializer

    def get_queryset(self):
        return BerthListingPhoto.objects.filter(marina=self.get_marina(), listing_id=self.kwargs['pk'])

    def perform_create(self, serializer):
        listing = BerthListing.objects.get(pk=self.kwargs['pk'], marina=self.get_marina())
        serializer.save(marina=self.get_marina(), listing=listing)


class BerthEnquiryListCreateView(generics.ListCreateAPIView):
    serializer_class = BerthEnquirySerializer

    def get_permissions(self):
        if self.request.method == 'POST':
            return [AllowAny()]
        return super().get_permissions()

    def get_queryset(self):
        return BerthEnquiry.objects.filter(listing_id=self.kwargs['pk'])

    def perform_create(self, serializer):
        listing = BerthListing.objects.get(pk=self.kwargs['pk'])
        serializer.save(marina=listing.marina, listing=listing)


class BerthEnquiryGlobalListView(MarinaMixin, generics.ListAPIView):
    """GET /marketplace/enquiries/ — global enquiry list across all listings."""
    serializer_class = BerthEnquirySerializer

    def get_queryset(self):
        qs = BerthEnquiry.objects.filter(
            marina=self.get_marina()
        ).select_related('listing').order_by('-created_at')
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs


class BerthEnquiryDetailView(MarinaMixin, generics.RetrieveUpdateDestroyAPIView):
    """PATCH /marketplace/enquiries/<pk>/ — update enquiry status."""
    serializer_class = BerthEnquirySerializer

    def get_queryset(self):
        return BerthEnquiry.objects.filter(marina=self.get_marina())


class ExchangeAgreementGlobalListView(MarinaMixin, generics.ListAPIView):
    """GET /marketplace/exchange/all-agreements/ — global list of exchange agreements."""
    serializer_class = ExchangeAgreementSerializer

    def get_queryset(self):
        return ExchangeAgreement.objects.filter(marina=self.get_marina()).order_by('-created_at')


class PublicBerthListingView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        marina = getattr(request, 'marina', None)
        if not marina:
            return Response([], status=status.HTTP_200_OK)
        listings = BerthListing.objects.filter(
            marina=marina, status='published', publish_to_portal=True
        ).prefetch_related('photos')
        return Response(PublicBerthListingSerializer(listings, many=True).data)


class ExchangeListingListCreateView(MarinaMixin, generics.ListCreateAPIView):
    serializer_class = ExchangeListingSerializer

    def get_queryset(self):
        return ExchangeListing.objects.filter(marina=self.get_marina())

    def perform_create(self, serializer):
        serializer.save(marina=self.get_marina())


class ExchangeListingDetailView(MarinaMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ExchangeListingSerializer

    def get_queryset(self):
        return ExchangeListing.objects.filter(marina=self.get_marina())


class ExchangeAgreementListCreateView(MarinaMixin, generics.ListCreateAPIView):
    serializer_class = ExchangeAgreementSerializer

    def get_queryset(self):
        return ExchangeAgreement.objects.filter(marina=self.get_marina(), listing_a_id=self.kwargs['pk'])

    def perform_create(self, serializer):
        listing_a = ExchangeListing.objects.get(pk=self.kwargs['pk'], marina=self.get_marina())
        serializer.save(marina=self.get_marina(), listing_a=listing_a)


class ExchangeAgreementConfirmView(MarinaMixin, APIView):
    def post(self, request, pk):
        agreement = ExchangeAgreement.objects.select_related(
            'listing_a__berth', 'listing_b__berth'
        ).get(pk=pk, marina=self.get_marina())

        if agreement.status != 'pending':
            return Response({'error': 'Only pending agreements can be confirmed.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            from apps.reservations.models import Booking
            agreement.status = 'agreed'
            agreement.agreed_at = timezone.now()
            agreement.save(update_fields=['status', 'agreed_at'])

            # Create bookings using actual Booking field names:
            # check_in / check_out (not arrival_date / departure_date)
            # booking_source (not source)
            # nights computed from date range
            nights_a = (agreement.party_b_end_date - agreement.party_b_start_date).days or 1
            Booking.objects.create(
                marina=self.get_marina(),
                berth=agreement.listing_a.berth,
                check_in=agreement.party_b_start_date,
                check_out=agreement.party_b_end_date,
                nights=nights_a,
                booking_source='exchange',
                status='pending',
            )
            nights_b = (agreement.party_a_end_date - agreement.party_a_start_date).days or 1
            Booking.objects.create(
                marina=self.get_marina(),
                berth=agreement.listing_b.berth,
                check_in=agreement.party_a_start_date,
                check_out=agreement.party_a_end_date,
                nights=nights_b,
                booking_source='exchange',
                status='pending',
            )

        return Response(ExchangeAgreementSerializer(agreement).data)
