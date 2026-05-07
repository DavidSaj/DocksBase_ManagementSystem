import json
from decimal import Decimal
from unittest.mock import patch, MagicMock
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.billing.models import Invoice


def _setup():
    marina = Marina.objects.create(
        name='Test Marina',
        stripe_account_id='acct_test123',
        currency='CHF',
    )
    user = User.objects.create_user(
        email='boater@test.com',
        password='pass',
        role='boater',
        marina=marina,
    )
    member = Member.objects.create(
        marina=marina,
        name='Test Boater',
        boater_user=user,
    )
    invoice = Invoice.objects.create(
        marina=marina,
        member=member,
        invoice_number='INV-2026-0001',
        status='open',
        total=Decimal('150.00'),
    )
    return marina, user, member, invoice


class PortalInvoicePayViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina, self.user, self.member, self.invoice = _setup()
        self.client.force_authenticate(user=self.user)
        self.url = f'/api/v1/portal/invoices/{self.invoice.pk}/pay/'

    @patch('apps.billing.stripe_service.stripe')
    def test_creates_payment_intent_and_returns_client_secret(self, mock_stripe):
        mock_stripe.PaymentIntent.create.return_value = {
            'id': 'pi_new',
            'client_secret': 'pi_new_secret_test',
        }
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 201)
        data = json.loads(resp.content)
        self.assertEqual(data['client_secret'], 'pi_new_secret_test')
        self.assertEqual(data['stripe_account_id'], 'acct_test123')
        self.assertEqual(data['currency'], 'chf')
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.stripe_payment_intent_id, 'pi_new')

    @patch('apps.billing.stripe_service.stripe')
    def test_reuses_existing_intent_when_still_open(self, mock_stripe):
        self.invoice.stripe_payment_intent_id = 'pi_existing'
        self.invoice.save(update_fields=['stripe_payment_intent_id'])
        mock_stripe.PaymentIntent.retrieve.return_value = {
            'id': 'pi_existing',
            'client_secret': 'pi_existing_secret',
            'status': 'requires_payment_method',
            'amount': 15000,
        }
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data['client_secret'], 'pi_existing_secret')
        mock_stripe.PaymentIntent.create.assert_not_called()

    @patch('apps.billing.stripe_service.stripe')
    def test_updates_intent_amount_when_invoice_was_edited(self, mock_stripe):
        self.invoice.stripe_payment_intent_id = 'pi_stale'
        self.invoice.total = Decimal('200.00')
        self.invoice.save(update_fields=['stripe_payment_intent_id', 'total'])
        mock_stripe.PaymentIntent.retrieve.return_value = {
            'id': 'pi_stale',
            'client_secret': 'pi_stale_secret',
            'status': 'requires_payment_method',
            'amount': 15000,  # old amount: CHF 150.00
        }
        mock_stripe.PaymentIntent.modify.return_value = {
            'id': 'pi_stale',
            'client_secret': 'pi_modified_secret',
            'amount': 20000,
        }
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 200)
        mock_stripe.PaymentIntent.modify.assert_called_once_with(
            'pi_stale',
            amount=20000,
            stripe_account='acct_test123',
        )

    @patch('apps.billing.stripe_service.stripe')
    def test_creates_payment_intent_for_unpaid_invoice(self, mock_stripe):
        self.invoice.status = 'unpaid'
        self.invoice.save(update_fields=['status'])
        mock_stripe.PaymentIntent.create.return_value = {
            'id': 'pi_new2',
            'client_secret': 'pi_new2_secret_test',
        }
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 201)

    def test_returns_404_for_paid_invoice(self):
        self.invoice.status = 'paid'
        self.invoice.save(update_fields=['status'])
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 404)

    def test_returns_402_when_marina_has_no_stripe_account(self):
        self.marina.stripe_account_id = ''
        self.marina.save(update_fields=['stripe_account_id'])
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 402)

    def test_returns_403_for_non_boater(self):
        staff_user = User.objects.create_user(
            email='staff@test.com', password='pass', role='staff',
            marina=self.marina,
        )
        self.client.force_authenticate(user=staff_user)
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 403)
