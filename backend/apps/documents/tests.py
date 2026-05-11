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


from apps.documents.serializers import DocTemplateSerializer, EnvelopeSerializer, MemberDocumentSerializer


class SerializerTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.vessel = make_vessel(self.marina, self.member)
        self.template = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')

    def test_doctemplate_serializer_fields(self):
        s = DocTemplateSerializer(self.template)
        self.assertIn('id', s.data)
        self.assertIn('dropboxsign_template_id', s.data)
        self.assertIn('file', s.data)

    def test_envelope_serializer_fields(self):
        env = Envelope.objects.create(marina=self.marina, template=self.template, recipient=self.member)
        s = EnvelopeSerializer(env)
        self.assertIn('id', s.data)
        self.assertIn('template_name', s.data)
        self.assertIn('recipient_name', s.data)
        self.assertIn('status', s.data)

    def test_memberdocument_serializer_fields(self):
        doc = MemberDocument.objects.create(marina=self.marina, member=self.member, doc_type='insurance')
        s = MemberDocumentSerializer(doc)
        self.assertIn('id', s.data)
        self.assertIn('member_name', s.data)
        self.assertIn('doc_type', s.data)
        self.assertIn('status', s.data)


from unittest.mock import patch, MagicMock
from apps.documents.services import (
    create_embedded_template_draft,
    send_envelope,
    get_signed_pdf_url,
)


class ServiceLayerTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.template = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')

    @patch('apps.documents.services.dropbox_sign')
    def test_create_embedded_template_draft_returns_edit_url(self, mock_ds):
        mock_api = MagicMock()
        mock_ds.TemplateApi.return_value = mock_api
        mock_api.create_embedded_template_draft.return_value.embedded_template.edit_url = 'https://dsign.example/edit/abc'

        result = create_embedded_template_draft(self.template, file_path='/tmp/test.pdf', api_key='', client_id='')

        self.assertEqual(result, 'https://dsign.example/edit/abc')
        mock_api.create_embedded_template_draft.assert_called_once()

    @patch('apps.documents.services.dropbox_sign')
    def test_send_envelope_returns_request_id(self, mock_ds):
        mock_api = MagicMock()
        mock_ds.SignatureRequestApi.return_value = mock_api
        mock_api.send_with_template.return_value.signature_request.signature_request_id = 'req_abc123'

        tpl = DocTemplate.objects.create(
            marina=self.marina, name='Waiver', category='waiver',
            dropboxsign_template_id='tpl_real_id',
        )
        env = Envelope.objects.create(marina=self.marina, template=tpl, recipient=self.member)
        result = send_envelope(env, api_key='')

        self.assertEqual(result, 'req_abc123')
        mock_api.send_with_template.assert_called_once()

    @patch('apps.documents.services.dropbox_sign')
    def test_get_signed_pdf_url(self, mock_ds):
        mock_api = MagicMock()
        mock_ds.SignatureRequestApi.return_value = mock_api
        mock_api.get.return_value.signature_request.signing_url = 'https://dsign.example/signed.pdf'

        url = get_signed_pdf_url('req_abc123', api_key='')
        self.assertEqual(url, 'https://dsign.example/signed.pdf')


import json
import hmac as hmac_module
import hashlib
import time
from django.urls import reverse
from rest_framework.test import APIClient


def make_user(marina, email='manager@example.com'):
    User = get_user_model()
    return User.objects.create_user(email=email, password='pass', marina=marina)


class DocTemplateViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina, email='manager_tpl@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_list_scoped_to_marina(self):
        DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')
        other = Marina.objects.create(name='Other Marina')
        DocTemplate.objects.create(marina=other, name='Other Lease', category='lease')

        resp = self.client.get('/api/v1/doc-templates/')
        self.assertEqual(resp.status_code, 200)
        data = resp.data.get('results', resp.data)
        self.assertEqual(len(data), 1)

    @patch('apps.documents.views.create_embedded_template_draft')
    def test_prepare_returns_edit_url(self, mock_prepare):
        mock_prepare.return_value = 'https://dsign.example/edit/abc'
        tpl = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')
        # Give it a file path so the view doesn't reject it
        tpl.file = 'doc_templates/fake.pdf'
        tpl.save()
        resp = self.client.post(f'/api/v1/doc-templates/{tpl.pk}/prepare/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['edit_url'], 'https://dsign.example/edit/abc')


class EnvelopeViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.user = make_user(self.marina, email='manager_env@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.template = DocTemplate.objects.create(
            marina=self.marina, name='Lease', category='lease',
            dropboxsign_template_id='tpl_real',
        )

    @patch('apps.documents.views.send_envelope')
    def test_create_envelope_calls_dropboxsign(self, mock_send):
        mock_send.return_value = 'req_abc'
        resp = self.client.post('/api/v1/envelopes/', {
            'template': self.template.pk,
            'recipient': self.member.pk,
        })
        self.assertEqual(resp.status_code, 201)
        env = Envelope.objects.get(pk=resp.data['id'])
        self.assertEqual(env.dropboxsign_request_id, 'req_abc')

    def test_webhook_rejects_invalid_hmac(self):
        resp = self.client.post(
            '/api/v1/documents/webhook/',
            data=json.dumps({'event': {}}),
            content_type='application/json',
            HTTP_X_HELLOSIGN_SIGNATURE='badsig',
            HTTP_X_HELLOSIGN_EVENT_TIME='12345',
        )
        self.assertEqual(resp.status_code, 400)

    def test_webhook_marks_envelope_completed(self):
        env = Envelope.objects.create(
            marina=self.marina, template=self.template,
            recipient=self.member,
            dropboxsign_request_id='req_abc',
        )
        event_time = str(int(time.time()))
        event_type = 'signature_request_all_signed'
        secret = 'test-secret'
        sig = hmac_module.new(secret.encode(), (event_time + event_type).encode(), hashlib.sha256).hexdigest()

        payload = {
            'event': {
                'event_type': event_type,
                'event_time': event_time,
                'signature_request': {
                    'signature_request_id': 'req_abc',
                    'metadata': {
                        'marina_id': str(self.marina.pk),
                        'envelope_pk': str(env.pk),
                    },
                },
            }
        }
        with self.settings(DROPBOX_SIGN_WEBHOOK_SECRET=secret):
            resp = self.client.post(
                '/api/v1/documents/webhook/',
                data=json.dumps(payload),
                content_type='application/json',
                HTTP_X_HELLOSIGN_SIGNATURE=sig,
                HTTP_X_HELLOSIGN_EVENT_TIME=event_time,
            )
        self.assertEqual(resp.status_code, 200)
        env.refresh_from_db()
        self.assertEqual(env.status, 'completed')


class MemberDocumentViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.user = make_user(self.marina, email='manager_mdoc@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_list_scoped_to_marina(self):
        MemberDocument.objects.create(marina=self.marina, member=self.member, doc_type='insurance')
        other = Marina.objects.create(name='Other Marina 2')
        other_member = Member.objects.create(marina=other, name='Bob', email='bob@example.com')
        MemberDocument.objects.create(marina=other, member=other_member, doc_type='registration')

        resp = self.client.get('/api/v1/member-documents/')
        self.assertEqual(resp.status_code, 200)
        data = resp.data.get('results', resp.data)
        self.assertEqual(len(data), 1)

    def test_patch_expiry_date(self):
        doc = MemberDocument.objects.create(marina=self.marina, member=self.member, doc_type='insurance')
        resp = self.client.patch(f'/api/v1/member-documents/{doc.pk}/', {'expiry_date': '2027-01-01', 'status': 'verified'})
        self.assertEqual(resp.status_code, 200)
        doc.refresh_from_db()
        self.assertEqual(str(doc.expiry_date), '2027-01-01')
        self.assertEqual(doc.status, 'verified')


from datetime import date, timedelta
from django.core.management import call_command


class ExpiryCommandTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.template = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')

    def test_verified_doc_past_expiry_becomes_expired(self):
        doc = MemberDocument.objects.create(
            marina=self.marina, member=self.member, doc_type='insurance',
            status='verified', expiry_date=date.today() - timedelta(days=1),
        )
        call_command('check_document_expiry')
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'expired')

    def test_verified_doc_within_30_days_becomes_due_soon(self):
        doc = MemberDocument.objects.create(
            marina=self.marina, member=self.member, doc_type='registration',
            status='verified', expiry_date=date.today() + timedelta(days=15),
        )
        call_command('check_document_expiry')
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'due_soon')

    def test_pending_envelope_past_expiry_becomes_expired(self):
        env = Envelope.objects.create(
            marina=self.marina, template=self.template, recipient=self.member,
            status='pending', expires_at=date.today() - timedelta(days=1),
        )
        call_command('check_document_expiry')
        env.refresh_from_db()
        self.assertEqual(env.status, 'expired')

    def test_completed_envelope_not_touched(self):
        env = Envelope.objects.create(
            marina=self.marina, template=self.template, recipient=self.member,
            status='completed', expires_at=date.today() - timedelta(days=1),
        )
        call_command('check_document_expiry')
        env.refresh_from_db()
        self.assertEqual(env.status, 'completed')
