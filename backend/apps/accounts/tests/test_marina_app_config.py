from django.test import TestCase
from apps.accounts.models import Marina


class MarinaAppConfigTest(TestCase):
    def test_app_config_defaults_to_empty_dict(self):
        marina = Marina.objects.create(
            name='Test Marina',
            slug='test-marina',
        )
        self.assertEqual(marina.app_config, {})

    def test_app_config_stores_and_retrieves_toggles(self):
        marina = Marina.objects.create(
            name='Test Marina 2',
            slug='test-marina-2',
            app_config={
                'enable_boatyard': True,
                'enable_utilities': False,
                'enable_documents': True,
                'brand_color': '#ff5500',
                'wifi_name': 'HarbourNet',
                'wifi_password': 'anchor99',
                'local_guide': 'Best pizza: Joe\'s +1 555 0100',
            },
        )
        marina.refresh_from_db()
        self.assertFalse(marina.app_config['enable_utilities'])
        self.assertEqual(marina.app_config['brand_color'], '#ff5500')
