from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, MarinaGroup, MarinaGroupMembership, MarinaGroupUserRole, User


def make_setup():
    g = MarinaGroup.objects.create(name='Group', slug='group', base_currency='EUR')
    m = Marina.objects.create(name='Port A', slug='port-a', total_berths=50, status='active', currency='EUR')
    MarinaGroupMembership.objects.create(group=g, marina=m)
    admin = User.objects.create_user(email='admin@test.com', password='pass')
    MarinaGroupUserRole.objects.create(group=g, user=admin, role=MarinaGroupUserRole.Role.ADMIN)
    return g, m, admin


class StaffInviteTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.m, self.admin = make_setup()
        self.client.force_authenticate(self.admin)

    def test_invite_creates_new_user(self):
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/invite/',
            {'email': 'new@marina.com', 'marina_id': self.m.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        u = User.objects.get(email='new@marina.com')
        self.assertEqual(u.marina_id, self.m.id)
        self.assertEqual(u.role, 'manager')
        self.assertTrue(u.is_active)

    def test_invite_reactivates_inactive_user(self):
        existing = User.objects.create_user(email='old@marina.com', password='pass', is_active=False)
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/invite/',
            {'email': 'old@marina.com', 'marina_id': self.m.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        existing.refresh_from_db()
        self.assertTrue(existing.is_active)

    def test_invite_marina_not_in_group_returns_400(self):
        other = Marina.objects.create(name='Other', slug='other', status='active', currency='EUR')
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/invite/',
            {'email': 'x@x.com', 'marina_id': other.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_invite_missing_fields_returns_400(self):
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/invite/',
            {'email': 'x@x.com'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_invite_non_admin_rejected(self):
        other = User.objects.create_user(email='other@test.com', password='pass')
        c = APIClient()
        c.force_authenticate(other)
        resp = c.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/invite/',
            {'email': 'x@x.com', 'marina_id': self.m.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)


class StaffRemoveTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.m, self.admin = make_setup()
        self.client.force_authenticate(self.admin)
        self.staff_user = User.objects.create_user(
            email='staff@marina.com', password='pass', role='manager', is_active=True
        )
        self.staff_user.marina = self.m
        self.staff_user.save()

    def test_remove_deactivates_user(self):
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/{self.staff_user.pk}/remove/',
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.staff_user.refresh_from_db()
        self.assertFalse(self.staff_user.is_active)

    def test_remove_user_not_in_group_returns_400(self):
        outsider = User.objects.create_user(email='out@test.com', password='pass', is_active=True)
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/{outsider.pk}/remove/',
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_remove_non_admin_rejected(self):
        other = User.objects.create_user(email='other@test.com', password='pass')
        c = APIClient()
        c.force_authenticate(other)
        resp = c.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/{self.staff_user.pk}/remove/',
            format='json',
        )
        self.assertEqual(resp.status_code, 403)
