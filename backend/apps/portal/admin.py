from django.contrib import admin
from .models import AbsenceReport, CraneRequest


@admin.register(CraneRequest)
class CraneRequestAdmin(admin.ModelAdmin):
    list_display = ('member', 'service_type', 'requested_date', 'status', 'created_at')
    list_filter  = ('status', 'service_type')


@admin.register(AbsenceReport)
class AbsenceReportAdmin(admin.ModelAdmin):
    list_display = ('member', 'absence_type', 'departure', 'return_date', 'created_at')
    list_filter  = ('absence_type',)
