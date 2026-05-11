import sys
from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Anonymise PII in a restored production DB dump. Refuses to run in production.'

    def handle(self, *args, **options):
        self._check_safety()
        totals = {}
        totals['Users'] = self._sanitize_users()
        totals['Members'] = self._sanitize_members()
        totals['Marinas'] = self._sanitize_marinas()
        totals['Vessels'] = self._sanitize_vessels()

        summary = ', '.join(f'{v} {k}' for k, v in totals.items())
        self.stdout.write(self.style.SUCCESS(f'Sanitized {summary}'))

    def _check_safety(self):
        if not settings.DEBUG:
            self.stderr.write(self.style.ERROR('sanitize_db refuses to run with DEBUG=False.'))
            sys.exit(1)
        db_name = settings.DATABASES.get('default', {}).get('NAME', '')
        if 'prod' in str(db_name).lower():
            self.stderr.write(self.style.ERROR(f'sanitize_db refuses to run against DB: {db_name}'))
            sys.exit(1)

    def _sanitize_users(self):
        from faker import Faker
        from apps.accounts.models import User

        fake = Faker('en_GB')
        qs = User.objects.all()
        total = 0
        batch_size = 500

        for offset in range(0, qs.count(), batch_size):
            batch = list(qs[offset:offset + batch_size])
            for u in batch:
                u.first_name = fake.first_name()
                u.last_name = fake.last_name()
                u.email = fake.unique.email()
                u.set_unusable_password()
            User.objects.bulk_update(batch, ['first_name', 'last_name', 'email', 'password'])
            total += len(batch)

        return total

    def _sanitize_members(self):
        from faker import Faker
        from apps.members.models import Member

        fake = Faker('en_GB')
        qs = Member.objects.all()
        total = 0
        batch_size = 500

        # Determine which PII fields exist on this model
        member_fields = {f.name for f in Member._meta.fields}
        update_fields = []

        for offset in range(0, qs.count(), batch_size):
            batch = list(qs[offset:offset + batch_size])
            for m in batch:
                if 'name' in member_fields:
                    m.name = fake.name()
                if 'email' in member_fields:
                    m.email = fake.unique.email()
                if 'phone' in member_fields and m.phone:
                    m.phone = fake.phone_number()[:30]
                if 'preferred_name' in member_fields and m.preferred_name:
                    m.preferred_name = fake.first_name()
                if 'address' in member_fields and m.address:
                    m.address = fake.address().replace('\n', ', ')
                if 'emergency_name' in member_fields and m.emergency_name:
                    m.emergency_name = fake.name()
                if 'emergency_phone' in member_fields and m.emergency_phone:
                    m.emergency_phone = fake.phone_number()[:30]

            # Build update_fields once from first batch
            if not update_fields:
                for field in ['name', 'email', 'phone', 'preferred_name', 'address', 'emergency_name', 'emergency_phone']:
                    if field in member_fields:
                        update_fields.append(field)

            if update_fields and batch:
                Member.objects.bulk_update(batch, update_fields)
            total += len(batch)

        return total

    def _sanitize_marinas(self):
        return 0

    def _sanitize_vessels(self):
        return 0
