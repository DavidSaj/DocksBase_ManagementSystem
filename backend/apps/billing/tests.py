import datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.members.models import Member


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_marina(vat_rate='8.10', stripe_account_id='acct_test123'):
    return Marina.objects.create(
        name='Test Marina',
        vat_rate=Decimal(vat_rate),
        stripe_account_id=stripe_account_id,
    )


def make_user(marina, email='staff@test.com'):
    return User.objects.create_user(
        email=email, password='pass', marina=marina, role='manager'
    )


def make_member(marina, email='hans@boat.ch'):
    return Member.objects.create(marina=marina, name='Hans Müller', email=email)


# ── Tests ──────────────────────────────────────────────────────────────────────

class MarinaFieldsTest(TestCase):
    def test_vat_rate_and_stripe_account_id_exist(self):
        marina = Marina.objects.create(
            name='Marina A', vat_rate=Decimal('7.70'), stripe_account_id='acct_abc'
        )
        marina.refresh_from_db()
        self.assertEqual(marina.vat_rate, Decimal('7.70'))
        self.assertEqual(marina.stripe_account_id, 'acct_abc')

    def test_vat_rate_defaults_to_zero(self):
        marina = Marina.objects.create(name='Marina B')
        self.assertEqual(marina.vat_rate, Decimal('0.00'))

    def test_stripe_account_id_defaults_blank(self):
        marina = Marina.objects.create(name='Marina C')
        self.assertEqual(marina.stripe_account_id, '')
