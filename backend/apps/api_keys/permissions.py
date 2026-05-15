from rest_framework.permissions import BasePermission


class IsMarinaOwner(BasePermission):
    """
    Only allows access to users with role='owner'.
    Non-owners get 403, not 404, so the UI can hide the card cleanly.
    """
    message = 'Only marina owners can manage API keys.'

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and getattr(request.user, 'role', None) == 'owner'
        )
