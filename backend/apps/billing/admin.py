from django.contrib import admin
from .models import Invoice, InvoiceLineItem, Payment


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ['id', 'marina', 'invoice_number', 'status', 'total', 'created_at']
    list_filter = ['marina', 'status', 'source_type']


@admin.register(InvoiceLineItem)
class InvoiceLineItemAdmin(admin.ModelAdmin):
    list_display = ['id', 'invoice', 'description', 'quantity', 'unit_price', 'total_price']


admin.site.register(Payment)
