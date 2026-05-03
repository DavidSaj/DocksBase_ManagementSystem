from django.test import TestCase
from apps.accounts.models import Marina


class MarinaSlugTest(TestCase):
    def test_slug_auto_populated_from_name(self):
        marina = Marina.objects.create(name='Frau Zanger Marina')
        self.assertEqual(marina.slug, 'frau-zanger-marina')

    def test_slug_unique_collision_gets_suffix(self):
        Marina.objects.create(name='Blue Cove')
        duplicate = Marina.objects.create(name='Blue Cove')
        self.assertEqual(duplicate.slug, 'blue-cove-1')

    def test_existing_slug_not_overwritten_on_save(self):
        marina = Marina.objects.create(name='Old Name', slug='my-custom-slug')
        marina.name = 'New Name'
        marina.save()
        marina.refresh_from_db()
        self.assertEqual(marina.slug, 'my-custom-slug')

    def test_slug_field_is_unique(self):
        from django.db import IntegrityError
        Marina.objects.create(name='Alpha', slug='alpha')
        with self.assertRaises(IntegrityError):
            Marina.objects.create(name='Beta', slug='alpha')

    def test_empty_name_gets_uuid_slug(self):
        marina = Marina.objects.create(name='')
        self.assertTrue(len(marina.slug) > 0)
        self.assertNotEqual(marina.slug, '')

    def test_long_name_slug_fits_max_length(self):
        long_name = 'A' * 200
        marina = Marina.objects.create(name=long_name)
        self.assertLessEqual(len(marina.slug), 100)
