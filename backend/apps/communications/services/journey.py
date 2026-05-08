from datetime import timedelta

from django.db import transaction
from django.utils import timezone


def enroll_in_journey(journey_id, marina, member=None, booking=None):
    """
    Enroll a member/booking in a journey. Deduplication: skip if an active enrollment already exists.
    """
    from apps.communications.models import Journey, JourneyEnrollment, JourneyStep

    journey = Journey.objects.get(pk=journey_id, marina=marina, is_active=True)

    # Deduplication guard
    existing_qs = JourneyEnrollment.objects.filter(
        journey=journey,
        status=JourneyEnrollment.Status.ACTIVE,
    )
    if member:
        existing_qs = existing_qs.filter(member=member)
    if booking:
        existing_qs = existing_qs.filter(booking=booking)
    if existing_qs.exists():
        return None

    # Determine first step delay
    first_step = JourneyStep.objects.filter(journey=journey).order_by('order').first()
    if first_step:
        next_due = _compute_next_due(first_step)
    else:
        next_due = None

    enrollment = JourneyEnrollment.objects.create(
        journey=journey,
        member=member,
        booking=booking,
        status=JourneyEnrollment.Status.ACTIVE,
        current_step_order=first_step.order if first_step else 0,
        next_step_due_at=next_due,
    )
    return enrollment


def _compute_next_due(step):
    """Calculate next_step_due_at based on step delay."""
    from apps.communications.models import JourneyStep
    now = timezone.now()
    unit = step.delay_unit
    value = step.delay_value or 0
    if unit == JourneyStep.DelayUnit.MINUTES:
        return now + timedelta(minutes=value)
    elif unit == JourneyStep.DelayUnit.HOURS:
        return now + timedelta(hours=value)
    elif unit == JourneyStep.DelayUnit.DAYS:
        return now + timedelta(days=value)
    return now


def condition_check(step, enrollment) -> bool:
    """
    Evaluate a GATE step condition against the enrollment context.
    Returns True if condition passes (continue), False otherwise.
    """
    from apps.communications.models import JourneyStep

    field = step.condition_field
    operator = step.condition_operator
    expected = step.condition_value

    member = enrollment.member
    booking = enrollment.booking

    if field == JourneyStep.ConditionField.WHATSAPP_OPT_IN:
        actual = str(getattr(member, 'whatsapp_opt_in', False)).lower()
        expected = expected.lower()
        return actual == expected

    if field == JourneyStep.ConditionField.MEMBER_TYPE and member:
        actual = member.member_type
    elif field == JourneyStep.ConditionField.INSURANCE_STATUS and member:
        actual = member.insurance_status
    elif field == JourneyStep.ConditionField.DOCS_STATUS and member:
        actual = member.docs_status
    elif field == JourneyStep.ConditionField.BOOKING_STATUS and booking:
        actual = booking.status
    elif field == JourneyStep.ConditionField.PAYMENT_STATUS and booking:
        actual = getattr(booking, 'payment_status', '')
    else:
        # Unknown field — pass through
        return True

    if operator in ('eq', '==', 'equals'):
        return actual == expected
    elif operator in ('neq', '!=', 'not_equals'):
        return actual != expected
    elif operator == 'in':
        return actual in [v.strip() for v in expected.split(',')]
    return True


def advance_enrollment(enrollment_id):
    """
    Process the next pending step for a given enrollment.
    Uses select_for_update to prevent concurrent processing.
    """
    from apps.communications.models import (
        JourneyEnrollment, JourneyStep, JourneyStepLog,
    )
    from apps.communications.services.dispatch import dispatch

    with transaction.atomic():
        try:
            enrollment = JourneyEnrollment.objects.select_for_update(nowait=True).get(
                pk=enrollment_id,
                status=JourneyEnrollment.Status.ACTIVE,
            )
        except JourneyEnrollment.DoesNotExist:
            return

        try:
            step = JourneyStep.objects.get(
                journey=enrollment.journey,
                order=enrollment.current_step_order,
            )
        except JourneyStep.DoesNotExist:
            # No more steps — complete enrollment
            enrollment.status = JourneyEnrollment.Status.COMPLETED
            enrollment.completed_at = timezone.now()
            enrollment.save(update_fields=['status', 'completed_at'])
            return

        message_log = None
        skipped = False
        gate_timed_out = False

        if step.step_type == JourneyStep.StepType.GATE:
            passed = condition_check(step, enrollment)
            if not passed:
                skipped = True
        elif step.step_type == JourneyStep.StepType.ACTION:
            try:
                marina = enrollment.journey.marina
                recipient = ''
                if step.channel in (JourneyStep.Channel.EMAIL,) and enrollment.member:
                    recipient = enrollment.member.email
                elif step.channel == JourneyStep.Channel.SMS and enrollment.member:
                    recipient = enrollment.member.phone
                elif step.channel == JourneyStep.Channel.WHATSAPP and enrollment.member:
                    recipient = enrollment.member.phone

                if recipient:
                    message_log = dispatch(
                        marina=marina,
                        channel=step.channel,
                        recipient=recipient,
                        subject=step.subject_template,
                        body=step.body_template,
                        member=enrollment.member,
                        booking=enrollment.booking,
                        journey_step=step,
                        whatsapp_template_name=step.whatsapp_template.meta_name if step.whatsapp_template else None,
                    )
            except Exception:
                pass

        JourneyStepLog.objects.create(
            enrollment=enrollment,
            journey_step=step,
            message_log=message_log,
            skipped=skipped,
            gate_timed_out=gate_timed_out,
        )

        # Advance to next step
        next_step = JourneyStep.objects.filter(
            journey=enrollment.journey,
            order__gt=step.order,
        ).order_by('order').first()

        if next_step:
            enrollment.current_step_order = next_step.order
            enrollment.next_step_due_at = _compute_next_due(next_step)
            enrollment.save(update_fields=['current_step_order', 'next_step_due_at'])
        else:
            enrollment.status = JourneyEnrollment.Status.COMPLETED
            enrollment.completed_at = timezone.now()
            enrollment.save(update_fields=['status', 'completed_at'])


def evaluate_all_due_enrollments():
    """Fetch all active enrollments past their due time and advance each one."""
    from apps.communications.models import JourneyEnrollment
    now = timezone.now()
    due = JourneyEnrollment.objects.filter(
        status=JourneyEnrollment.Status.ACTIVE,
        next_step_due_at__lte=now,
    ).values_list('id', flat=True)
    for enrollment_id in due:
        try:
            advance_enrollment(enrollment_id)
        except Exception:
            pass
