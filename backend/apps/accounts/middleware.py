from django.http import JsonResponse
from apps.accounts.models import Marina


class TenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        slug   = request.META.get('HTTP_X_MARINA_SLUG',   '').strip()
        domain = request.META.get('HTTP_X_MARINA_DOMAIN', '').strip()

        if slug:
            try:
                request.tenant = Marina.objects.get(slug=slug)
            except Marina.DoesNotExist:
                return JsonResponse({'error': 'Marina not found.'}, status=404)
        elif domain:
            try:
                request.tenant = Marina.objects.get(custom_domain=domain)
            except Marina.DoesNotExist:
                return JsonResponse({'error': 'Marina not found.'}, status=404)
        else:
            request.tenant = None

        return self.get_response(request)
