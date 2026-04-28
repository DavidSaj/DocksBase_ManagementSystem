from django.urls import path
from .views import (
    BookingListCreateView, BookingDetailView,
    BookingRequestListCreateView, BookingRequestDetailView,
    ConvertBookingRequestView,
)

urlpatterns = [
    path('bookings/',                              BookingListCreateView.as_view(),        name='booking_list'),
    path('bookings/<int:pk>/',                     BookingDetailView.as_view(),            name='booking_detail'),
    path('booking-requests/',                      BookingRequestListCreateView.as_view(), name='booking_request_list'),
    path('booking-requests/<int:pk>/',             BookingRequestDetailView.as_view(),     name='booking_request_detail'),
    path('booking-requests/<int:pk>/convert/',     ConvertBookingRequestView.as_view(),    name='booking_request_convert'),
]
