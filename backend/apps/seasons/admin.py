from django.contrib import admin

from .models import (
    BerthLease,
    InstalmentPlan,
    LeaseInstalment,
    LeaseVesselChangeEvent,
    Season,
    SeasonalRateCard,
)


@admin.register(Season)
class SeasonAdmin(admin.ModelAdmin):
    list_display = ('name', 'marina', 'season_type', 'start_date', 'end_date',
                    'is_default_for_new_leases', 'is_tax_exempt_default',
                    'is_archived')
    list_filter = ('marina', 'season_type', 'is_archived')
    search_fields = ('name',)


@admin.register(SeasonalRateCard)
class SeasonalRateCardAdmin(admin.ModelAdmin):
    list_display = ('name', 'marina', 'season', 'season_total',
                    'deposit_amount', 'is_active')
    list_filter = ('marina', 'season', 'is_active')


@admin.register(InstalmentPlan)
class InstalmentPlanAdmin(admin.ModelAdmin):
    list_display = ('name', 'marina', 'frequency', 'instalment_count',
                    'deposit_first', 'is_active')
    list_filter = ('marina', 'frequency', 'is_active')


class LeaseInstalmentInline(admin.TabularInline):
    model = LeaseInstalment
    extra = 0
    readonly_fields = ('issued_at', 'paid_at', 'invoice')


@admin.register(BerthLease)
class BerthLeaseAdmin(admin.ModelAdmin):
    list_display = ('id', 'berth', 'member', 'season', 'status',
                    'start_date', 'end_date', 'season_total',
                    'deposit_forfeited', 'at_risk')
    list_filter = ('marina', 'status', 'season')
    search_fields = ('member__name', 'berth__code', 'notes')
    readonly_fields = ('status_changed_at', 'deposit_paid_at',
                       'deposit_forfeited', 'created_at', 'updated_at')
    inlines = [LeaseInstalmentInline]


@admin.register(LeaseInstalment)
class LeaseInstalmentAdmin(admin.ModelAdmin):
    list_display = ('id', 'lease', 'sequence', 'due_date',
                    'amount', 'status', 'invoice')
    list_filter = ('status',)


@admin.register(LeaseVesselChangeEvent)
class LeaseVesselChangeEventAdmin(admin.ModelAdmin):
    list_display = ('id', 'lease', 'from_vessel', 'to_vessel',
                    'changed_at', 'changed_by')
