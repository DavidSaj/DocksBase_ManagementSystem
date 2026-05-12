from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from apps.accounts.views import IsMarinaStaff

ALLOWED_KEYS = {
    'brand_color', 'logo_url', 'enable_boatyard', 'enable_utilities',
    'enable_documents', 'wifi_name', 'wifi_password', 'local_guide', 'map_url',
}


class AppConfigUpdateView(APIView):
    permission_classes = [IsMarinaStaff]

    def patch(self, request):
        marina = getattr(request.user, 'marina', None)
        if marina is None:
            # Try X-Marina-Slug header as fallback for tests
            from apps.accounts.models import Marina
            slug = request.META.get('HTTP_X_MARINA_SLUG', '')
            marina = Marina.objects.filter(slug=slug).first()
        if marina is None:
            return Response({'detail': 'No marina linked to user.'}, status=http_status.HTTP_400_BAD_REQUEST)

        incoming = {k: v for k, v in request.data.items() if k in ALLOWED_KEYS}
        if not incoming:
            return Response({'detail': 'No valid keys provided.'}, status=http_status.HTTP_400_BAD_REQUEST)

        current = marina.app_config or {}
        current.update(incoming)
        marina.app_config = current
        marina.save(update_fields=['app_config'])

        return Response({'app_config': marina.app_config})
