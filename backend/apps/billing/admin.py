from django.contrib import admin
from .models import Invoice, Payment


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ['id', 'marina', 'vessel', 'amount', 'status', 'due']
    list_filter = ['marina', 'status', 'invoice_type']


admin.site.register(Payment)
