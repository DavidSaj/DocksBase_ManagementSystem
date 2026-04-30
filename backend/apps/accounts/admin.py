from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import Marina, User


@admin.register(Marina)
class MarinaAdmin(admin.ModelAdmin):
    list_display = ['name', 'plan', 'created_at']


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ['email', 'marina', 'role', 'is_active']
    list_filter = ['role', 'is_active']
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Info', {'fields': ('first_name', 'last_name', 'marina', 'role')}),
        ('Permissions', {'fields': ('is_active', 'is_staff', 'is_superuser')}),
    )
    add_fieldsets = (
        (None, {'fields': ('email', 'password1', 'password2', 'marina', 'role')}),
    )
    ordering = ['email']
    search_fields = ['email']
    filter_horizontal = []
