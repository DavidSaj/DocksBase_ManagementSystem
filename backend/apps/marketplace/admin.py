from django.contrib import admin
from apps.marketplace.models import BerthListing, BerthListingPhoto, BerthEnquiry, ExchangeListing, ExchangeAgreement


@admin.register(BerthListing)
class BerthListingAdmin(admin.ModelAdmin):
    list_display = ['berth', 'marina', 'headline', 'asking_price', 'show_asking_price', 'status', 'published_at']
    list_filter = ['marina', 'status', 'listing_party']
    search_fields = ['headline']


@admin.register(BerthEnquiry)
class BerthEnquiryAdmin(admin.ModelAdmin):
    list_display = ['listing', 'enquirer_name', 'enquirer_email', 'status', 'created_at']
    list_filter = ['status']


@admin.register(ExchangeListing)
class ExchangeListingAdmin(admin.ModelAdmin):
    list_display = ['berth', 'member', 'marina', 'status', 'available_from', 'available_to']
    list_filter = ['marina', 'status']


@admin.register(ExchangeAgreement)
class ExchangeAgreementAdmin(admin.ModelAdmin):
    list_display = ['listing_a', 'listing_b', 'status', 'agreed_at']
    list_filter = ['status']
