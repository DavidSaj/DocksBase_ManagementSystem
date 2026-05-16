from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0033_backfill_email_verified_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='max_waitlist_declines',
            field=models.IntegerField(
                default=3,
                help_text='Number of waitlist offers a boater may decline before being removed.',
            ),
        ),
        migrations.AddField(
            model_name='marina',
            name='waitlist_enabled',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='marina',
            name='waitlist_deposit_cents',
            field=models.IntegerField(default=7500),
        ),
    ]
