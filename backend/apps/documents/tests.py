from django.test import TestCase
from django.contrib.auth import get_user_model
from apps.accounts.models import Marina
from apps.members.models import Member
from apps.vessels.models import Vessel
from apps.documents.models import DocTemplate, Envelope, MemberDocument

User = get_user_model()


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_member(marina):
    return Member.objects.create(marina=marina, name='Alice Skipper', email='alice@example.com')


def make_vessel(marina, member):
    return Vessel.objects.create(marina=marina, name='Sea Witch', owner=member)


class ModelFieldTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.vessel = make_vessel(self.marina, self.member)

    def test_doctemplate_has_dsign_id_field(self):
        t = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')
        t.dropboxsign_template_id = 'tpl_abc123'
        t.save()
        self.assertEqual(DocTemplate.objects.get(pk=t.pk).dropboxsign_template_id, 'tpl_abc123')

    def test_envelope_has_dsign_request_id(self):
        tpl = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')
        env = Envelope.objects.create(marina=self.marina, template=tpl, recipient=self.member)
        env.dropboxsign_request_id = 'req_xyz789'
        env.save()
        self.assertEqual(Envelope.objects.get(pk=env.pk).dropboxsign_request_id, 'req_xyz789')

    def test_memberdocument_creates(self):
        doc = MemberDocument.objects.create(
            marina=self.marina,
            member=self.member,
            doc_type='insurance',
            status='pending_upload',
        )
        self.assertEqual(doc.marina, self.marina)
        self.assertEqual(doc.doc_type, 'insurance')
