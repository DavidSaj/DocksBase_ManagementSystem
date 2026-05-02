from django.contrib import admin
from .models import Invoice, InvoiceLineItem, Payment, ChargeableItem


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ['id', 'marina', 'invoice_number', 'status', 'total', 'created_at']
    list_filter = ['marina', 'status', 'source_type']


@admin.register(InvoiceLineItem)
class InvoiceLineItemAdmin(admin.ModelAdmin):
    list_display = ['id', 'invoice', 'description', 'quantity', 'unit_price', 'total_price']


@admin.register(ChargeableItem)
class ChargeableItemAdmin(admin.ModelAdmin):
    list_display  = ['name', 'marina', 'category', 'pricing_model', 'unit_price', 'show_in_pos', 'fuel_dock_type', 'is_active']
    list_filter   = ['marina', 'category', 'show_in_pos', 'is_active']
    search_fields = ['name']


admin.site.register(Payment)
