from django.http import JsonResponse
from apps.accounts.models import Marina


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
            return JsonResponse({'error': 'Marina not found.'}, status=404)

        return self.get_response(request)
