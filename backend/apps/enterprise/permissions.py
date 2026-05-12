from rest_framework.permissions import BasePermission
from apps.accounts.models import MarinaGroupUserRole


class IsGroupAdmin(BasePermission):
    """
    Request must include `pk` URL kwarg (the group ID).
    User must have MarinaGroupUserRole.admin for that group.
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        group_pk = view.kwargs.get('group_pk') or view.kwargs.get('pk')
        return MarinaGroupUserRole.objects.filter(
            user=request.user,
            group_id=group_pk,
            role=MarinaGroupUserRole.Role.ADMIN,
        ).exists()
