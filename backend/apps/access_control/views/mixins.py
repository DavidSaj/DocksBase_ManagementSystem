"""
Shared ViewSet mixin for all access_control views.

MarinaFilteredViewSet:
  - Filters get_queryset() to marina=request.user.marina
  - Injects marina on perform_create()
  - Returns 409 on ProtectedError (e.g. DELETE a zone that has readers)
"""

from django.db.models import ProtectedError
from rest_framework import status
from rest_framework.response import Response


class MarinaFilteredMixin:
    """
    Mixin that scopes all queries to the requesting user's marina and
    automatically injects marina on create.
    """

    def get_queryset(self):
        qs = super().get_queryset()
        return qs.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError as exc:
            related = [str(obj) for obj in list(exc.protected_objects)[:5]]
            return Response(
                {'detail': f"Cannot delete — referenced by: {', '.join(related)}"},
                status=status.HTTP_409_CONFLICT,
            )
