from django.core.management.base import BaseCommand
from django.core.signing import TimestampSigner
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
from apps.accounts.models import Marina
from apps.accounts.emails import send_abandoned_cart_email


class Command(BaseCommand):
    help = 'Email marina owners who abandoned signup more than 2 hours ago.'

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(hours=2)
        pending = Marina.objects.filter(
            status='pending_payment',
            created_at__lt=cutoff,
            abandon_email_sent=False,
        )

        signer = TimestampSigner()
        sent = 0

        for marina in pending:
            owner = marina.users.filter(role='owner').first()
            if not owner:
                continue

            token = signer.sign(str(marina.id))
            website_url = getattr(settings, 'WEBSITE_URL', '')
            resume_url = f'{website_url}/signup/resume?token={token}'

            send_abandoned_cart_email(owner, marina.name, resume_url)
            marina.abandon_email_sent = True
            marina.save(update_fields=['abandon_email_sent'])
            sent += 1

        self.stdout.write(self.style.SUCCESS(f'Sent {sent} abandoned-cart email(s).'))
