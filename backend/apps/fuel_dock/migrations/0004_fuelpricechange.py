from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts',  '0001_initial'),
        ('billing',   '0021_invoice_reservation_backfill'),
        ('staff',     '0003_staffmember_is_contractor'),
        ('fuel_dock', '0003_fueldockentry_is_internal_use'),
    ]

    operations = [
        migrations.CreateModel(
            name='FuelPriceChange',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('old_price',  models.DecimalField(max_digits=10, decimal_places=2)),
                ('new_price',  models.DecimalField(max_digits=10, decimal_places=2)),
                ('note',       models.CharField(max_length=200, blank=True)),
                ('changed_at', models.DateTimeField(auto_now_add=True)),
                ('marina',     models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='fuel_price_changes', to='accounts.marina')),
                ('item',       models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='price_changes',      to='billing.chargeableitem')),
                ('changed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='fuel_price_changes', to='staff.staffmember')),
            ],
            options={'ordering': ['-changed_at']},
        ),
    ]
