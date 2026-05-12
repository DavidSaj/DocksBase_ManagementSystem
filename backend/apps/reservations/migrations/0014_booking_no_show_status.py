from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('reservations', '0013_booking_dynamic_price_applied_booking_end_time_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='booking',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending_approval', 'Pending Approval'),
                    ('awaiting_payment', 'Awaiting Payment'),
                    ('pending_payment', 'Pending Payment'),
                    ('confirmed', 'Confirmed'),
                    ('pending', 'Pending'),
                    ('checked_in', 'Checked In'),
                    ('checked_out', 'Checked Out'),
                    ('overstay', 'Overstay'),
                    ('no_show', 'No Show'),
                    ('cancelled', 'Cancelled'),
                ],
                default='pending',
                max_length=20,
            ),
        ),
    ]
