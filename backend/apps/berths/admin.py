from django.contrib import admin
from .models import Pier, Berth, MarinaMapConfig, Amenity


@admin.register(Pier)
class PierAdmin(admin.ModelAdmin):
    list_display = ['code', 'marina', 'label']
    list_filter = ['marina']


@admin.register(Berth)
class BerthAdmin(admin.ModelAdmin):
    list_display = ['code', 'pier', 'marina', 'status', 'vessel']
    list_filter = ['marina', 'status']


@admin.register(Amenity)
class AmenityAdmin(admin.ModelAdmin):
    list_display = ['type', 'label', 'marina']
    list_filter = ['marina', 'type']


@admin.register(MarinaMapConfig)
class MarinaMapConfigAdmin(admin.ModelAdmin):
    list_display = ['marina', 'updated_at']
