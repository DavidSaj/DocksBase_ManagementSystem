from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, MarinaGroup, MarinaGroupMembership, MarinaGroupUserRole, User


def make_setup():
    g = MarinaGroup.objects.create(name='G', slug='g', max_marinas=2)
    m = Marina.objects.create(name='Port A', slug='port-a')
    MarinaGroupMembership.objects.create(group=g, marina=m)
    u = User.objects.create_user(email='boss@group.com', password='pass')
    MarinaGroupUserRole.objects.create(group=g, user=u, role=MarinaGroupUserRole.Role.ADMIN)
    # A marina-level manager for staff tests
    staff = User.objects.create_user(email='mgr@port-a.com', password='pass',
                                     marina=m, role='manager', first_name='Jack', last_name='Smith')
    return g, m, u, staff


class ExchangeTokenTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.m, self.user, self.staff = make_setup()
        self.client.force_authenticate(self.user)

    def test_exchange_token_returns_access_token(self):
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/exchange_token/',
            {'marina_id': self.m.pk}, format='json'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn('access', resp.data)
        self.assertIn('marina_slug', resp.data)

    def test_exchange_token_rejects_non_member_marina(self):
        other_marina = Marina.objects.create(name='Other', slug='other')
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/exchange_token/',
            {'marina_id': other_marina.pk}, format='json'
        )
        self.assertEqual(resp.status_code, 400)

    def test_exchange_token_requires_group_admin(self):
        outsider = User.objects.create_user(email='x@x.com', password='pass')
        c = APIClient()
        c.force_authenticate(outsider)
        resp = c.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/exchange_token/',
            {'marina_id': self.m.pk}, format='json'
        )
        self.assertEqual(resp.status_code, 403)

    def test_exchange_token_missing_marina_id_returns_400(self):
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/exchange_token/',
            {}, format='json'
        )
        self.assertEqual(resp.status_code, 400)


class StaffViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.m, self.user, self.staff = make_setup()
        self.client.force_authenticate(self.user)

    def test_staff_lists_marina_managers(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/staff/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]['email'], 'mgr@port-a.com')
        self.assertIn('marina_name', resp.data[0])
