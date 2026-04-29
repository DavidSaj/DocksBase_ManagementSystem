from django.contrib import admin
from .models import HaulOut, WorkOrder, Part, Tool, StorageSlot, LaunchRequest, Contractor

admin.site.register(HaulOut)
admin.site.register(WorkOrder)
admin.site.register(Part)
admin.site.register(Tool)
admin.site.register(StorageSlot)
admin.site.register(LaunchRequest)
admin.site.register(Contractor)
