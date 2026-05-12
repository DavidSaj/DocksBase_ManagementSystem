from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, MarinaGroup, MarinaGroupMembership, User


def make_admin():
    m = Marina.objects.create(name='Admin Marina', slug='admin-marina')
    u = User.objects.create_user(email='admin@docksbase.com', password='pass', marina=m)
    u.is_platform_admin = True
    u.save()
    return u


class AdminGroupCRUDTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make_admin()
        self.client.force_authenticate(self.admin)

    def test_create_group(self):
        resp = self.client.post('/api/v1/admin/groups/', {
            'name': 'Adriatic Ports',
            'slug': 'adriatic-ports',
            'max_marinas': 3,
            'base_currency': 'EUR',
            'billing_contact_email': 'billing@adriatic.com',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['name'], 'Adriatic Ports')
        self.assertEqual(resp.data['max_marinas'], 3)

    def test_list_groups(self):
        MarinaGroup.objects.create(name='G1', slug='g1')
        MarinaGroup.objects.create(name='G2', slug='g2')
        resp = self.client.get('/api/v1/admin/groups/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 2)

    def test_patch_group(self):
        g = MarinaGroup.objects.create(name='Old Name', slug='old-name', max_marinas=1)
        resp = self.client.patch(f'/api/v1/admin/groups/{g.pk}/', {'max_marinas': 5}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['max_marinas'], 5)

    def test_add_marina_to_group(self):
        g = MarinaGroup.objects.create(name='G', slug='g', max_marinas=2)
        m = Marina.objects.create(name='Port A', slug='port-a')
        resp = self.client.post(f'/api/v1/admin/groups/{g.pk}/add_marina/', {'marina_id': m.pk}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(MarinaGroupMembership.objects.filter(group=g, marina=m).exists())

    def test_add_marina_enforces_limit(self):
        g = MarinaGroup.objects.create(name='G', slug='g', max_marinas=1)
        m1 = Marina.objects.create(name='Port A', slug='port-a')
        m2 = Marina.objects.create(name='Port B', slug='port-b')
        MarinaGroupMembership.objects.create(group=g, marina=m1)
        resp = self.client.post(f'/api/v1/admin/groups/{g.pk}/add_marina/', {'marina_id': m2.pk}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('limit', resp.data['detail'].lower())

    def test_remove_marina_from_group(self):
        g = MarinaGroup.objects.create(name='G', slug='g')
        m = Marina.objects.create(name='Port A', slug='port-a')
        MarinaGroupMembership.objects.create(group=g, marina=m)
        resp = self.client.post(f'/api/v1/admin/groups/{g.pk}/remove_marina/', {'marina_id': m.pk}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(MarinaGroupMembership.objects.filter(group=g, marina=m).exists())

    def test_set_group_admin(self):
        g = MarinaGroup.objects.create(name='G', slug='g')
        u = User.objects.create_user(email='enterprise@owner.com', password='pass')
        resp = self.client.post(f'/api/v1/admin/groups/{g.pk}/set_admin/', {'email': 'enterprise@owner.com'}, format='json')
        self.assertEqual(resp.status_code, 200)
        from apps.accounts.models import MarinaGroupUserRole
        self.assertTrue(MarinaGroupUserRole.objects.filter(group=g, user=u, role='admin').exists())

    def test_unauthorized_access_rejected(self):
        non_admin = User.objects.create_user(email='regular@user.com', password='pass')
        c = APIClient()
        c.force_authenticate(non_admin)
        resp = c.get('/api/v1/admin/groups/')
        self.assertEqual(resp.status_code, 403)
