from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.access_control.models import BiometricEnrolment
from apps.access_control.serializers import BiometricEnrolmentSerializer
from apps.access_control.views.mixins import MarinaFilteredMixin


class BiometricFeatureGuardMixin:
    """Returns 403 if marina.features['biometric_enabled'] is not True."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not request.user.marina.features.get('biometric_enabled', False):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Biometric module not enabled for this marina.")


class BiometricEnrolmentViewSet(BiometricFeatureGuardMixin, MarinaFilteredMixin, viewsets.ModelViewSet):
    """
    Biometric enrolment management.

    DELETE implements GDPR Art. 17 async deletion:
      1. Sets pending_deletion=True, pending_deletion_since=now(). Saves.
      2. Returns 202 Accepted immediately.
      3. Dispatches revoke_biometric_enrolment task.
    The enrolment is now invisible to all UI (default manager hides it).
    """
    serializer_class   = BiometricEnrolmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # Default manager already excludes pending_deletion=True
        return BiometricEnrolment.objects.filter(marina=self.request.user.marina)

    def destroy(self, request, *args, **kwargs):
        enrolment = self.get_object()

        # Mark for async deletion immediately (GDPR Art. 17 — must respond promptly)
        enrolment.pending_deletion       = True
        enrolment.pending_deletion_since = timezone.now()
        enrolment.save(update_fields=['pending_deletion', 'pending_deletion_since'])

        # Dispatch hardware wipe task
        from apps.access_control.tasks import revoke_biometric_enrolment
        # revoke_biometric_enrolment.apply_async(args=[enrolment.pk])  # when Celery wired
        from django.db import transaction
        transaction.on_commit(lambda: revoke_biometric_enrolment(enrolment_pk=enrolment.pk))

        return Response(
            {'detail': 'Biometric deletion initiated. Terminal wipe queued (GDPR Art. 17).'},
            status=status.HTTP_202_ACCEPTED,
        )
