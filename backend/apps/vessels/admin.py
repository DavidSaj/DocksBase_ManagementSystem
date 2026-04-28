from django.contrib import admin
from .models import Vessel, InsuranceRecord, SafetyEquipment, VesselCertificate


@admin.register(Vessel)
class VesselAdmin(admin.ModelAdmin):
    list_display = ['name', 'reg', 'marina', 'vessel_type', 'owner']
    list_filter = ['marina', 'vessel_type']
    search_fields = ['name', 'reg']


admin.site.register(InsuranceRecord)
admin.site.register(SafetyEquipment)
admin.site.register(VesselCertificate)
