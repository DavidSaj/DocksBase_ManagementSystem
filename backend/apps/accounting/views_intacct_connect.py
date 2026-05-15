"""
Sage Intacct connection management.

Sage Intacct does not support OAuth — connection uses a credential form.
The frontend POSTs the required fields here; we test the credentials
against the Intacct XML gateway and, on success, persist them in the
AccountingIntegrationConfig.

Endpoints:
  GET  /sage-intacct/status/    — returns current connection state
  POST /sage-intacct/connect/   — body: { company_id, user_id, user_password, location_id? }
  POST /sage-intacct/disconnect/
"""

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounting.models import AccountingIntegrationConfig
from apps.accounting.integrations.sage_intacct import SageIntacctAdapter
from apps.accounting.integrations.base import AdapterError


class IntacctStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        try:
            config = AccountingIntegrationConfig.objects.get(marina=marina, platform='sage_intacct')
        except AccountingIntegrationConfig.DoesNotExist:
            return Response({'connected': False})
        return Response({
            'connected':      bool(config.is_active),
            'company_id':     config.company_id,
            'base_url':       config.base_url,
            'last_synced_at': config.last_synced_at,
        })


class IntacctConnectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)

        company_id    = request.data.get('company_id', '').strip()
        user_id       = request.data.get('user_id', '').strip()
        user_password = request.data.get('user_password', '').strip()
        location_id   = request.data.get('location_id', '').strip()

        missing = [
            name for name, value in (
                ('company_id', company_id),
                ('user_id', user_id),
                ('user_password', user_password),
            ) if not value
        ]
        if missing:
            return Response(
                {'detail': f'Missing required field(s): {", ".join(missing)}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Build a transient config object to verify credentials before persisting.
        config = AccountingIntegrationConfig(
            marina=marina,
            platform='sage_intacct',
            company_id=company_id,
            base_url=f'Sage Intacct ({company_id})',
            is_active=True,
            credentials={
                'user_id':       user_id,
                'user_password': user_password,
                'location_id':   location_id,
            },
        )
        adapter = SageIntacctAdapter(config)
        try:
            adapter.test_connection()
        except AdapterError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # Test passed — persist (upsert).
        config_obj, _ = AccountingIntegrationConfig.objects.update_or_create(
            marina=marina,
            platform='sage_intacct',
            defaults={
                'company_id': company_id,
                'base_url':   f'Sage Intacct ({company_id})',
                'is_active':  True,
                'credentials': {
                    'user_id':       user_id,
                    'user_password': user_password,
                    'location_id':   location_id,
                },
            },
        )
        return Response({'detail': 'Connected.', 'id': config_obj.id})


class IntacctDisconnectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            config = AccountingIntegrationConfig.objects.get(marina=marina, platform='sage_intacct')
        except AccountingIntegrationConfig.DoesNotExist:
            return Response({'detail': 'Not connected.'}, status=status.HTTP_404_NOT_FOUND)
        config.credentials = {}
        config.is_active = False
        config.save(update_fields=['credentials', 'is_active'])
        return Response({'detail': 'Disconnected.'})
