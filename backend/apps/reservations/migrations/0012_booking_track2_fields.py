from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('reservations', '0011_remove_booking_booking_dates_idx_booking_eta_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='booking',
            name='insurance_verified',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='booking',
            name='registration_verified',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='booking',
            name='waiver_verified',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='booking',
            name='document_gate_cleared',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='booking',
            name='document_gate_cleared_by',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='document_gate_clearances',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='booking',
            name='document_gate_cleared_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='booking',
            name='is_sublet',
            field=models.BooleanField(
                default=False,
                help_text='True when this booking fills a TemporaryDeparture sub-let gap.',
            ),
        ),
    ]
