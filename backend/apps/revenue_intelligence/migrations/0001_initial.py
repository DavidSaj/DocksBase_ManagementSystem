"""
Initial migration for apps.revenue_intelligence.

Creates all 9 models:
  BookingTier, YieldRule, YieldApplication, HourlyBerthConfig,
  UpgradeCampaign, UpsellOffer, WaitlistEntry, WaitlistOffer, CompetitorRate.

Does NOT add:
  - booking_tier FK to berths.Berth
  - is_upsell_eligible to billing.ChargeableItem
  - hourly / dynamic-price fields to reservations.Booking

Those cross-app fields are documented in INSTALL.md and must be added as
separate migrations in their respective apps.
"""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0018_marina_no_show_grace_minutes'),
        ('berths', '0030_berth_intelligence_models'),
        ('billing', '0013_invoice_invoice_type_invoice_related_invoice_and_more'),
        ('reservations', '0012_booking_track2_fields'),
    ]

    operations = [
        # ── BookingTier ────────────────────────────────────────────────────────
        migrations.CreateModel(
            name='BookingTier',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('display_order', models.PositiveSmallIntegerField(default=0)),
                ('rate_premium_pct', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('description', models.TextField(blank=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='ri_booking_tiers',
                    to='accounts.marina',
                )),
            ],
            options={
                'ordering': ['display_order', 'name'],
                'unique_together': {('marina', 'name')},
            },
        ),

        # ── YieldRule ──────────────────────────────────────────────────────────
        migrations.CreateModel(
            name='YieldRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('trigger_type', models.CharField(
                    choices=[
                        ('occupancy_threshold', 'Occupancy Threshold'),
                        ('days_to_arrival', 'Days to Arrival'),
                        ('days_in_advance', 'Days in Advance'),
                        ('gap_fill', 'Gap Fill'),
                    ],
                    max_length=30,
                )),
                ('action_type', models.CharField(
                    choices=[
                        ('percent_uplift', 'Percent Uplift'),
                        ('percent_discount', 'Percent Discount'),
                        ('fixed_uplift', 'Fixed Uplift'),
                        ('fixed_discount', 'Fixed Discount'),
                    ],
                    max_length=30,
                )),
                ('action_value', models.DecimalField(decimal_places=2, max_digits=8)),
                ('occupancy_scope', models.CharField(
                    blank=True,
                    choices=[('tier', 'Tier'), ('marina', 'Marina')],
                    max_length=20,
                )),
                ('occupancy_threshold_pct', models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True)),
                ('days_to_arrival_lte', models.IntegerField(blank=True, null=True)),
                ('days_in_advance_gte', models.IntegerField(blank=True, null=True)),
                ('gap_max_nights', models.IntegerField(blank=True, null=True)),
                ('floor_price', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('ceiling_price', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('pricing_model_scope', models.CharField(
                    choices=[
                        ('per_night', 'Per Night'),
                        ('per_hour', 'Per Hour'),
                        ('all', 'All'),
                    ],
                    default='all',
                    max_length=20,
                )),
                ('valid_from', models.DateField(blank=True, null=True)),
                ('valid_until', models.DateField(blank=True, null=True)),
                ('priority', models.IntegerField(default=10)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='ri_yield_rules',
                    to='accounts.marina',
                )),
                ('booking_tier', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='rules',
                    to='revenue_intelligence.bookingtier',
                )),
            ],
            options={
                'ordering': ['priority', 'name'],
            },
        ),

        # ── YieldApplication ───────────────────────────────────────────────────
        migrations.CreateModel(
            name='YieldApplication',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('rule_name_snapshot', models.CharField(blank=True, max_length=200)),
                ('base_price', models.DecimalField(decimal_places=2, max_digits=10)),
                ('computed_price', models.DecimalField(decimal_places=2, max_digits=10)),
                ('floor_ceiling_clamped', models.BooleanField(default=False)),
                ('applied_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='ri_yield_applications',
                    to='accounts.marina',
                )),
                ('booking', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='yield_applications',
                    to='reservations.booking',
                )),
                ('rule', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to='revenue_intelligence.yieldrule',
                )),
            ],
            options={
                'ordering': ['-applied_at'],
            },
        ),

        # ── HourlyBerthConfig ──────────────────────────────────────────────────
        migrations.CreateModel(
            name='HourlyBerthConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('min_duration_minutes', models.IntegerField(default=60)),
                ('max_duration_minutes', models.IntegerField(default=480)),
                ('increment_minutes', models.CharField(
                    choices=[
                        ('15', '15 minutes'),
                        ('30', '30 minutes'),
                        ('60', '1 hour'),
                        ('240', '4 hours'),
                    ],
                    default='60',
                    max_length=5,
                )),
                ('is_active', models.BooleanField(default=True)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='hourly_berth_configs',
                    to='accounts.marina',
                )),
                ('berth', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='hourly_config',
                    to='berths.berth',
                )),
                ('pricing_item', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='hourly_berth_configs',
                    to='billing.chargeableitem',
                )),
            ],
        ),

        # ── UpgradeCampaign ────────────────────────────────────────────────────
        migrations.CreateModel(
            name='UpgradeCampaign',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('differential_amount', models.DecimalField(decimal_places=2, max_digits=10)),
                ('checkout_link', models.URLField(blank=True)),
                ('status', models.CharField(
                    choices=[
                        ('pending', 'Pending'),
                        ('accepted', 'Accepted'),
                        ('declined', 'Declined'),
                        ('expired', 'Expired'),
                    ],
                    default='pending',
                    max_length=20,
                )),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('responded_at', models.DateTimeField(blank=True, null=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='upgrade_campaigns',
                    to='accounts.marina',
                )),
                ('booking', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='upgrade_campaigns',
                    to='reservations.booking',
                )),
                ('from_tier', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='from_campaigns',
                    to='revenue_intelligence.bookingtier',
                )),
                ('to_tier', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='to_campaigns',
                    to='revenue_intelligence.bookingtier',
                )),
                ('offered_berth', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='upgrade_campaigns',
                    to='berths.berth',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),

        # ── UpsellOffer ────────────────────────────────────────────────────────
        migrations.CreateModel(
            name='UpsellOffer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('trigger_event', models.CharField(
                    choices=[
                        ('booking_quote', 'Booking Quote'),
                        ('check_in', 'Check In'),
                        ('mid_stay', 'Mid Stay'),
                        ('manual', 'Manual'),
                    ],
                    max_length=30,
                )),
                ('offer_text', models.TextField(blank=True)),
                ('discount_pct', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('status', models.CharField(
                    choices=[
                        ('sent', 'Sent'),
                        ('redeemed', 'Redeemed'),
                        ('expired', 'Expired'),
                    ],
                    default='sent',
                    max_length=20,
                )),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('redeemed_at', models.DateTimeField(blank=True, null=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='upsell_offers',
                    to='accounts.marina',
                )),
                ('booking', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='upsell_offers',
                    to='reservations.booking',
                )),
                ('chargeable_item', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='upsell_offers',
                    to='billing.chargeableitem',
                )),
                ('invoice_line_item', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='upsell_offers',
                    to='billing.invoicelineitem',
                )),
            ],
        ),

        # ── WaitlistEntry ──────────────────────────────────────────────────────
        migrations.CreateModel(
            name='WaitlistEntry',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email', models.EmailField()),
                ('name', models.CharField(blank=True, max_length=200)),
                ('vessel_length_m', models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
                ('desired_check_in', models.DateField(blank=True, null=True)),
                ('desired_check_out', models.DateField(blank=True, null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='ri_waitlist_entries',
                    to='accounts.marina',
                )),
                ('booking_tier', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to='revenue_intelligence.bookingtier',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),

        # ── WaitlistOffer ──────────────────────────────────────────────────────
        migrations.CreateModel(
            name='WaitlistOffer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('check_in', models.DateField()),
                ('check_out', models.DateField()),
                ('discounted_price', models.DecimalField(decimal_places=2, max_digits=10)),
                ('stripe_checkout_url', models.URLField(blank=True)),
                ('status', models.CharField(
                    choices=[
                        ('pending', 'Pending'),
                        ('claimed', 'Claimed'),
                        ('expired', 'Expired'),
                    ],
                    default='pending',
                    max_length=20,
                )),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('expires_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('claimed_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='waitlist_offers',
                    to='accounts.marina',
                )),
                ('waitlist_entry', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='offers',
                    to='revenue_intelligence.waitlistentry',
                )),
                ('berth', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='waitlist_offers',
                    to='berths.berth',
                )),
            ],
        ),

        # ── CompetitorRate ─────────────────────────────────────────────────────
        migrations.CreateModel(
            name='CompetitorRate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('competitor_name', models.CharField(max_length=200)),
                ('competitor_url', models.URLField(blank=True)),
                ('vessel_length_m', models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
                ('rate_per_night', models.DecimalField(decimal_places=2, max_digits=10)),
                ('valid_from', models.DateField(blank=True, null=True)),
                ('valid_until', models.DateField(blank=True, null=True)),
                ('source', models.CharField(
                    choices=[('manual', 'Manual'), ('scraper', 'Scraper')],
                    default='manual',
                    max_length=20,
                )),
                ('scraped_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='competitor_rates',
                    to='accounts.marina',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
