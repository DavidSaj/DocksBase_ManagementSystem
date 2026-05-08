from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0016_remove_marina_channel_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='require_manager_approval_loa_m',
            field=models.DecimalField(
                blank=True, decimal_places=1, max_digits=5, null=True,
                help_text='Vessels with LOA >= this value require manager approval.',
            ),
        ),
        migrations.AddField(
            model_name='marina',
            name='require_manager_approval_types',
            field=models.JSONField(
                default=list,
                help_text='Vessel types that always require manager approval (e.g. ["catamaran"]).',
            ),
        ),
        migrations.AddField(
            model_name='marina',
            name='require_approval_for_seasonal',
            field=models.BooleanField(
                default=True,
                help_text='If True, all seasonal bookings require manager approval.',
            ),
        ),
        migrations.AddField(
            model_name='marina',
            name='document_gate_enabled',
            field=models.BooleanField(
                default=False,
                help_text='If True, bookings require insurance/registration/waiver verification before confirmation.',
            ),
        ),
        migrations.AddField(
            model_name='marina',
            name='non_return_grace_hours',
            field=models.IntegerField(
                default=2,
                help_text='Hours after expected_return before a non-return alert is raised.',
            ),
        ),
        migrations.AddField(
            model_name='marina',
            name='coastguard_escalation_hours',
            field=models.IntegerField(
                default=4,
                help_text='Hours after alert creation before status elevates to CRITICAL.',
            ),
        ),
        migrations.AddField(
            model_name='marina',
            name='berth_sale_commission_pct',
            field=models.DecimalField(
                decimal_places=2, default=0, max_digits=5,
                help_text='Commission percentage charged on berth sale transactions.',
            ),
        ),
    ]
