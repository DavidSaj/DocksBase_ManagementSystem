from decimal import Decimal
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0001_initial'),
        ('accounts', '0005_marina_stripe_account_id_marina_vat_rate'),
        ('members', '0001_initial'),
        ('staff', '0001_initial'),
    ]

    operations = [
        # Delete old models (Payment first — it has FK to Invoice)
        migrations.DeleteModel(name='Payment'),
        migrations.DeleteModel(name='Invoice'),

        # Create new Invoice
        migrations.CreateModel(
            name='Invoice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('invoice_number', models.CharField(db_index=True, max_length=20, unique=True)),
                ('status', models.CharField(
                    choices=[('draft', 'Draft'), ('open', 'Open'), ('paid', 'Paid'), ('void', 'Void')],
                    default='draft', max_length=10,
                )),
                ('source_type', models.CharField(blank=True, max_length=50)),
                ('source_id', models.CharField(blank=True, db_index=True, max_length=255)),
                ('subtotal', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=10)),
                ('vat_rate', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=5)),
                ('tax_total', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=10)),
                ('total', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=10)),
                ('stripe_checkout_session_id', models.CharField(blank=True, max_length=200)),
                ('stripe_payment_intent_id', models.CharField(blank=True, max_length=200)),
                ('due_date', models.DateField(blank=True, null=True)),
                ('paid_at', models.DateTimeField(blank=True, null=True)),
                ('pdf_document', models.FileField(blank=True, null=True, upload_to='invoices/')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='invoices', to='accounts.marina',
                )),
                ('member', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='invoices', to='members.member',
                )),
            ],
            options={'ordering': ['-created_at']},
        ),

        # Create InvoiceLineItem
        migrations.CreateModel(
            name='InvoiceLineItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('description', models.CharField(max_length=255)),
                ('quantity', models.DecimalField(decimal_places=2, default=Decimal('1.00'), max_digits=8)),
                ('unit_price', models.DecimalField(decimal_places=2, max_digits=10)),
                ('total_price', models.DecimalField(decimal_places=2, max_digits=10)),
                ('invoice', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='items', to='billing.invoice',
                )),
            ],
        ),

        # Create new Payment
        migrations.CreateModel(
            name='Payment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('method', models.CharField(
                    choices=[('cash', 'Cash'), ('external_card', 'External Card')],
                    max_length=20,
                )),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10)),
                ('paid_at', models.DateTimeField(auto_now_add=True)),
                ('invoice', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='payments', to='billing.invoice',
                )),
                ('recorded_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to='staff.staffmember',
                )),
            ],
        ),
    ]
