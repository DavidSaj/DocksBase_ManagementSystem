from django.test import TestCase, RequestFactory
from django.http import JsonResponse
from apps.accounts.models import Marina
from apps.accounts.middleware import TenantMiddleware


class TenantMiddlewareTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina', slug='test-marina')
        self.factory = RequestFactory()

        def dummy_view(request):
            return JsonResponse({'ok': True})

        self.middleware = TenantMiddleware(dummy_view)

    def test_attaches_tenant_when_slug_header_present(self):
        request = self.factory.get('/api/v1/public/marina/', HTTP_X_MARINA_SLUG='test-marina')
        self.middleware(request)
        self.assertEqual(request.tenant, self.marina)

    def test_sets_tenant_none_when_no_header(self):
        request = self.factory.get('/api/v1/public/marina/')
        self.middleware(request)
        self.assertIsNone(request.tenant)

    def test_returns_404_json_for_unknown_slug(self):
        request = self.factory.get('/api/v1/public/marina/', HTTP_X_MARINA_SLUG='nonexistent')
        response = self.middleware(request)
        self.assertEqual(response.status_code, 404)
        self.assertIn('error', response.json())

    def test_empty_slug_header_sets_tenant_none(self):
        request = self.factory.get('/api/v1/public/marina/', HTTP_X_MARINA_SLUG='')
        self.middleware(request)
        self.assertIsNone(request.tenant)
