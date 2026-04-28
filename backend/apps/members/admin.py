from django.contrib import admin
from .models import Member, Segment


@admin.register(Member)
class MemberAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'member_type', 'insurance_status', 'docs_status']
    list_filter = ['marina', 'member_type']
    search_fields = ['name', 'email']


@admin.register(Segment)
class SegmentAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'description']
    list_filter = ['marina']
    search_fields = ['name']
