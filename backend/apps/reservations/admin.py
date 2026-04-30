from django.contrib import admin
from .models import Booking


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ['id', 'vessel', 'berth', 'marina', 'check_in', 'check_out', 'status', 'paid']
    list_filter = ['marina', 'status', 'booking_type', 'paid']
    search_fields = ['vessel__name', 'berth__code']
