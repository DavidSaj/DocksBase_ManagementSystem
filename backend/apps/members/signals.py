from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender='members.SurveyResponse')
def alert_on_low_nps(sender, instance, created, **kwargs):
    """Send an alert email to the harbour master when NPS score is 6 or below."""
    if not created:
        return
    if instance.nps_score <= 6 and not instance.alert_sent:
        marina = instance.marina
        if marina.harbour_master_email:
            from django.core.mail import send_mail
            send_mail(
                subject=f'Low NPS Alert — {marina.name}',
                message=(
                    f'Member {instance.member} submitted NPS {instance.nps_score} '
                    f'for booking {instance.booking_id}.\n\n'
                    f'Comments: {instance.comments}'
                ),
                from_email=None,
                recipient_list=[marina.harbour_master_email],
                fail_silently=True,
            )
            type(instance).objects.filter(pk=instance.pk).update(alert_sent=True)


@receiver(post_save, sender='members.Member')
def check_for_duplicate_on_save(sender, instance, created, **kwargs):
    """Run duplicate detection whenever a new Member is created."""
    if not created:
        return
    from apps.members.services import check_for_duplicates
    check_for_duplicates(
        marina=instance.marina,
        new_member=instance,
        name=instance.name,
        email=getattr(instance, 'email', ''),
        phone=getattr(instance, 'phone', ''),
        vessel_name='',
    )
