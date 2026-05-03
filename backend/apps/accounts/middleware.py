import json
from django.http import JsonResponse
from apps.accounts.models import Marina


class _JsonResponse(JsonResponse):
    """JsonResponse subclass that exposes a .json() helper for direct middleware testing."""

    def json(self):
        return json.loads(self.content.decode(self.charset))


class TenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        slug = request.META.get('HTTP_X_MARINA_SLUG', '').strip()
        if not slug:
            request.tenant = None
            return self.get_response(request)

        try:
            request.tenant = Marina.objects.get(slug=slug)
        except Marina.DoesNotExist:
            return _JsonResponse({'error': f"Marina '{slug}' not found."}, status=404)

        return self.get_response(request)
