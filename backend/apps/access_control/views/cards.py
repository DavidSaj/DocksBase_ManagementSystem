from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.access_control.models import AccessCard
from apps.access_control.serializers import AccessCardSerializer
from apps.access_control.views.mixins import MarinaFilteredMixin


class AccessCardViewSet(MarinaFilteredMixin, viewsets.ModelViewSet):
    serializer_class = AccessCardSerializer

    def get_queryset(self):
        qs = AccessCard.objects.select_related('member').filter(marina=self.request.user.marina)
        member_id = self.request.query_params.get('member')
        if member_id:
            qs = qs.filter(member_id=member_id)
        return qs

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        """Activate a card and dispatch HAL grant_access."""
        card = self.get_object()
        if card.is_active:
            return Response({'detail': 'Card is already active.'}, status=status.HTTP_200_OK)

        from apps.access_control.services.card_lifecycle import activate_card
        activate_card(card, granted_by=getattr(request.user, 'staff_profile', None))
        return Response({'detail': 'Card activated.', 'is_active': True})

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        """Deactivate a card. reason is required in request body."""
        card   = self.get_object()
        reason = request.data.get('reason', '').strip()
        if not reason:
            return Response({'reason': 'This field is required.'}, status=status.HTTP_400_BAD_REQUEST)

        from apps.access_control.services.card_lifecycle import deactivate_card
        deactivate_card(card, reason=reason)
        return Response({'detail': 'Card deactivated.', 'is_active': False})
