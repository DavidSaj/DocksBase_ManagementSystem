# backend/apps/reservations/urls.py
from django.urls import path
from .views import (
    BookingListCreateView, BookingDetailView,
    BookingRequestListCreateView, BookingRequestDetailView,
    ConvertBookingRequestView,
    AvailableBerthsView,
    BookingEngineRequestView,
    AssignBerthView,
    ApproveBookingView,
    RejectBookingView,
)

urlpatterns = [
    # Booking engine (must precede <int:pk> patterns to avoid any routing ambiguity)
    path('bookings/available-berths/',              AvailableBerthsView.as_view(),          name='available_berths'),
    path('bookings/engine-request/',                BookingEngineRequestView.as_view(),     name='booking_engine_request'),
    # Existing CRUD
    path('bookings/',                               BookingListCreateView.as_view(),        name='booking_list'),
    path('bookings/<int:pk>/',                      BookingDetailView.as_view(),            name='booking_detail'),
    path('bookings/<int:pk>/assign-berth/',         AssignBerthView.as_view(),              name='assign_berth'),
    path('bookings/<int:pk>/approve/',              ApproveBookingView.as_view(),           name='approve_booking'),
    path('bookings/<int:pk>/reject/',               RejectBookingView.as_view(),            name='reject_booking'),
    path('booking-requests/',                       BookingRequestListCreateView.as_view(), name='booking_request_list'),
    path('booking-requests/<int:pk>/',              BookingRequestDetailView.as_view(),     name='booking_request_detail'),
    path('booking-requests/<int:pk>/convert/',      ConvertBookingRequestView.as_view(),    name='booking_request_convert'),
]
