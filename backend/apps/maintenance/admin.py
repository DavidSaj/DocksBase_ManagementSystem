from django.contrib import admin
from .models import Task, Incident, Asset, Defect, MaintenanceTask


@admin.register(Defect)
class DefectAdmin(admin.ModelAdmin):
    list_display = ['id', 'marina', 'severity', 'status', 'reporter', 'reported_at']
    list_filter = ['severity', 'status', 'marina']
    search_fields = ['description', 'reporter']


@admin.register(MaintenanceTask)
class MaintenanceTaskAdmin(admin.ModelAdmin):
    list_display = ['id', 'marina', 'title', 'priority', 'status', 'assigned_to', 'due_date']
    list_filter = ['priority', 'status', 'marina']
    search_fields = ['title', 'description', 'assigned_to']


admin.site.register(Task)
admin.site.register(Incident)
admin.site.register(Asset)
