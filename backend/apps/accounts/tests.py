from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from apps.accounts.models import Marina

User = get_user_model()


class OperationsPausedTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='mgr@example.com', password='pass', marina=self.marina
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_operations_paused_default_false(self):
        self.assertFalse(self.marina.operations_paused)

    def test_patch_operations_paused_persists(self):
        resp = self.client.patch(
            '/api/v1/marina/profile/', {'operations_paused': True}, format='json'
        )
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertTrue(self.marina.operations_paused)

    def test_patch_operations_paused_clears(self):
        self.marina.operations_paused = True
        self.marina.save()
        resp = self.client.patch(
            '/api/v1/marina/profile/', {'operations_paused': False}, format='json'
        )
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertFalse(self.marina.operations_paused)
