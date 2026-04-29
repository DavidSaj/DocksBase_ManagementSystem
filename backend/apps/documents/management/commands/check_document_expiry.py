from datetime import date, timedelta
from django.core.management.base import BaseCommand
from apps.documents.models import MemberDocument, Envelope


class Command(BaseCommand):
    help = 'Mark expired and due-soon documents; expire pending envelopes.'

    def handle(self, *args, **options):
        today = date.today()
        due_soon_threshold = today + timedelta(days=30)

        # MemberDocument: any non-expired doc with expiry_date in the past → expired
        count_expired = MemberDocument.objects.filter(
            expiry_date__lte=today,
        ).exclude(status='expired').update(status='expired')

        # MemberDocument: verified doc with expiry_date within 30 days → due_soon
        count_due_soon = MemberDocument.objects.filter(
            expiry_date__gt=today,
            expiry_date__lte=due_soon_threshold,
            status='verified',
        ).update(status='due_soon')

        # Envelope: pending envelope past expires_at → expired
        count_env_expired = Envelope.objects.filter(
            expires_at__lte=today,
            status='pending',
        ).update(status='expired')

        # Phase 3 note: add email (SendGrid) and SMS (Twilio) notifications here
        # before flipping status, using the due_soon/expired querysets above.

        self.stdout.write(
            f'Done: {count_expired} docs expired, {count_due_soon} due soon, '
            f'{count_env_expired} envelopes expired.'
        )
