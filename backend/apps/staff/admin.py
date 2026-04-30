from django.contrib import admin
from .models import StaffMember, Shift, Certification

admin.site.register(StaffMember)
admin.site.register(Shift)
admin.site.register(Certification)
