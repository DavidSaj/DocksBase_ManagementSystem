from django.contrib import admin
from .models import RestTable, MenuItem, Order, OrderItem

admin.site.register(RestTable)
admin.site.register(MenuItem)
admin.site.register(Order)
admin.site.register(OrderItem)
