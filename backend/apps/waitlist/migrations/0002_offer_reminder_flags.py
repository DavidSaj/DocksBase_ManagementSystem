"""Add reminder_sent_t24h / reminder_sent_t2h to WaitlistOffer."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('waitlist', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='waitlistoffer',
            name='reminder_sent_t24h',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='waitlistoffer',
            name='reminder_sent_t2h',
            field=models.BooleanField(default=False),
        ),
    ]
