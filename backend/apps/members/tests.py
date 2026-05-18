from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from .models import Member, Segment


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_user(marina):
    return User.objects.create_user(
        email='staff@test.com', password='pass', marina=marina, role='manager'
    )


class MemberCRUDTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_basic_member(self):
        resp = self.client.post('/api/v1/members/', {
            'name': 'Alice Smith',
            'email': 'alice@example.com',
            'member_type': 'seasonal',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['name'], 'Alice Smith')

    def test_create_member_with_contact_fields(self):
        resp = self.client.post('/api/v1/members/', {
            'name': 'Bob Jones',
            'preferred_name': 'Bobby',
            'nationality': 'Irish',
            'address': '12 Harbour Row\nKinsale',
            'address_country': 'Ireland',
            'emergency_name': 'Carol Jones',
            'emergency_relationship': 'Spouse',
            'emergency_phone': '+353 87 999 0000',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['preferred_name'], 'Bobby')
        self.assertEqual(data['emergency_name'], 'Carol Jones')
        self.assertEqual(data['address_country'], 'Ireland')

    def test_patch_contact_fields(self):
        m = Member.objects.create(marina=self.marina, name='Charlie')
        resp = self.client.patch(f'/api/v1/members/{m.id}/', {
            'address': '5 Pier Street',
            'address_country': 'Ireland',
            'emergency_name': 'Dana',
            'emergency_phone': '+353 1 234 5678',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['address_country'], 'Ireland')
        self.assertEqual(data['emergency_name'], 'Dana')

    def test_list_scoped_to_marina(self):
        other = Marina.objects.create(name='Other Marina')
        Member.objects.create(marina=other, name='Outsider')
        Member.objects.create(marina=self.marina, name='Insider')
        resp = self.client.get('/api/v1/members/')
        data = resp.json().get('results', resp.json())
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['name'], 'Insider')


class MemberFilterTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        Member.objects.create(marina=self.marina, name='Seasonal Sam', member_type='seasonal')
        Member.objects.create(
            marina=self.marina, name='Transient Tara',
            member_type='transient', email='tara@sea.ie',
        )

    def test_filter_by_member_type(self):
        resp = self.client.get('/api/v1/members/?member_type=seasonal')
        data = resp.json().get('results', resp.json())
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['name'], 'Seasonal Sam')

    def test_search_by_name(self):
        resp = self.client.get('/api/v1/members/?search=tara')
        data = resp.json().get('results', resp.json())
        self.assertEqual(len(data), 1)

    def test_search_by_email(self):
        resp = self.client.get('/api/v1/members/?search=tara@sea.ie')
        data = resp.json().get('results', resp.json())
        self.assertEqual(len(data), 1)


class SegmentTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_segment(self):
        resp = self.client.post('/api/v1/segments/', {
            'name': 'Seasonal Holders',
            'description': 'member_type=seasonal',
            'filter_params': {'member_type': 'seasonal'},
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['name'], 'Seasonal Holders')

    def test_count_is_live(self):
        Member.objects.create(marina=self.marina, name='A', member_type='seasonal')
        Member.objects.create(marina=self.marina, name='B', member_type='transient')
        seg = Segment.objects.create(
            marina=self.marina, name='Seasonal',
            filter_params={'member_type': 'seasonal'},
        )
        resp = self.client.get(f'/api/v1/segments/{seg.id}/')
        self.assertEqual(resp.json()['count'], 1)

    def test_count_updates_when_member_added(self):
        seg = Segment.objects.create(
            marina=self.marina, name='Seasonal',
            filter_params={'member_type': 'seasonal'},
        )
        self.assertEqual(self.client.get(f'/api/v1/segments/{seg.id}/').json()['count'], 0)
        Member.objects.create(marina=self.marina, name='New', member_type='seasonal')
        self.assertEqual(self.client.get(f'/api/v1/segments/{seg.id}/').json()['count'], 1)

    def test_invalid_filter_key_rejected_on_create(self):
        resp = self.client.post('/api/v1/segments/', {
            'name': 'Bad Segment',
            'filter_params': {'member_typo': 'seasonal'},
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('filter_params', resp.json())

    def test_invalid_filter_key_rejected_on_update(self):
        seg = Segment.objects.create(
            marina=self.marina, name='Good Segment',
            filter_params={'member_type': 'seasonal'},
        )
        resp = self.client.put(f'/api/v1/segments/{seg.id}/', {
            'name': 'Good Segment',
            'filter_params': {'bad_key': 'value'},
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('filter_params', resp.json())

    def test_segment_scoped_to_marina(self):
        other = Marina.objects.create(name='Other Marina')
        Segment.objects.create(marina=other, name='Outsider', filter_params={})
        Segment.objects.create(marina=self.marina, name='Insider', filter_params={})
        resp = self.client.get('/api/v1/segments/')
        data = resp.json().get('results', resp.json())
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['name'], 'Insider')


# ──────────────────────────────────────────────────────────────────────────────
# recalculate_lead_scores — vessel_loa_match rule now sources its cap from the
# marina's longest berth (was Marina.max_loa, which was dropped).
# ──────────────────────────────────────────────────────────────────────────────
from decimal import Decimal
from io import StringIO
from django.core.management import call_command
from apps.berths.models import Berth
from apps.vessels.models import Vessel
from apps.members.models import LeadScore


class RecalculateLeadScoresLOATest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='LOA Test Marina')

    def _make_member_with_vessel(self, vessel_loa, name='M'):
        member = Member.objects.create(marina=self.marina, name=name)
        if vessel_loa is not None:
            Vessel.objects.create(
                marina=self.marina, name=f'{name}-boat', owner=member,
                loa=Decimal(str(vessel_loa)),
            )
        return member

    def _make_berth(self, code, length_m):
        return Berth.objects.create(
            marina=self.marina, code=code, length_m=Decimal(str(length_m)),
        )

    def _vessel_loa_match_for(self, member):
        return LeadScore.objects.get(member=member).vessel_loa_match

    def test_vessel_loa_match_uses_longest_berth(self):
        # Two berths; the longest is 15.0 m.
        self._make_berth('A1', 10.0)
        self._make_berth('A2', 15.0)
        fits   = self._make_member_with_vessel(12.0, name='fits')
        toobig = self._make_member_with_vessel(20.0, name='toobig')

        call_command('recalculate_lead_scores', stdout=StringIO())

        self.assertTrue(self._vessel_loa_match_for(fits))
        self.assertFalse(self._vessel_loa_match_for(toobig))
        self.assertEqual(
            LeadScore.objects.get(member=fits).score, 15,
        )
        self.assertEqual(
            LeadScore.objects.get(member=toobig).score, 0,
        )

    def test_no_berths_means_no_loa_match(self):
        member = self._make_member_with_vessel(8.0, name='nomarinaberth')
        call_command('recalculate_lead_scores', stdout=StringIO())
        self.assertFalse(self._vessel_loa_match_for(member))
        self.assertEqual(LeadScore.objects.get(member=member).score, 0)
