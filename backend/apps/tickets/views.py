import uuid
import requests
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status


class TicketView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        title = (request.data.get('title') or '').strip()
        description = (request.data.get('description') or '').strip()
        context = request.data.get('context') or {}

        if not title:
            return Response({'detail': 'title is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(title) > 120:
            return Response({'detail': 'title must be 120 characters or fewer.'}, status=status.HTTP_400_BAD_REQUEST)
        if not description:
            return Response({'detail': 'description is required.'}, status=status.HTTP_400_BAD_REQUEST)

        ticket_id = str(uuid.uuid4())
        payload = {
            'id': ticket_id,
            'title': title,
            'description': description,
            'error': None,
            'context': context,
        }

        try:
            resp = requests.post(
                'https://tickets.sajosi.com/tickets',
                json=payload,
                headers={'X-Webhook-Secret': settings.INGRESS_WEBHOOK_SECRET},
                timeout=10,
            )
        except requests.RequestException:
            return Response({'detail': 'Ticket service unavailable.'}, status=status.HTTP_502_BAD_GATEWAY)

        if not resp.ok:
            return Response({'detail': 'Ticket service unavailable.'}, status=status.HTTP_502_BAD_GATEWAY)

        return Response({'ticket_id': ticket_id}, status=status.HTTP_200_OK)
