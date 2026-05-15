import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('ais', '0001_initial'),
        ('reservations', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='vesselposition',
            name='last_transition_at',
            field=models.DateTimeField(blank=True, help_text='Last time in_basin transitioned. Used to apply hysteresis to prevent edge-flicker.', null=True),
        ),
        migrations.CreateModel(
            name='AISNotificationSent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(max_length=30)),
                ('sent_at', models.DateTimeField(auto_now_add=True)),
                ('booking', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='ais_notifications_sent', to='reservations.booking')),
            ],
            options={
                'constraints': [
                    models.UniqueConstraint(
                        fields=['booking', 'kind'],
                        name='ais_notif_booking_kind_uniq',
                    ),
                ],
            },
        ),
    ]
