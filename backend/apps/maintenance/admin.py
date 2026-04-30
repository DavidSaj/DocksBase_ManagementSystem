from django.contrib import admin
from .models import Task, Incident, Asset, Defect, MaintenanceTask

admin.site.register(Task)
admin.site.register(Incident)
admin.site.register(Asset)
admin.site.register(Defect)
admin.site.register(MaintenanceTask)
