"""
Celery tasks for the berths app.

Tasks:
  solve_fleet_assignment  — async greedy fleet berth assignment
  check_non_returns       — scheduled non-return alert creation (runs every 30 min via beat)
"""
import datetime

from django.utils import timezone

try:
    from config.celery import app
except ImportError:
    # Fallback for environments without Celery configured (e.g. CI)
    from unittest.mock import MagicMock
    app = MagicMock()
    app.task = lambda **kw: (lambda f: f)


@app.task(name='berths.solve_fleet_assignment')
def solve_fleet_assignment(job_id: int):
    """
    Greedy multi-vessel berth assignment.

    Algorithm:
    1. For each vessel in the payload, run SmartBerthScorer (excluding already-assigned berths).
    2. Pier-clustering pass: if all vessels can fit on a single LogicalPier, re-run
       scoring constrained to that pier. Otherwise greedy-fill the best pier first.
    3. Write results back to FleetAssignJob.result_payload.
    """
    from apps.berths.models import FleetAssignJob
    from apps.berths.scorer import SmartBerthScorer

    job = FleetAssignJob.objects.get(pk=job_id)
    job.status = 'processing'
    job.save(update_fields=['status'])

    try:
        payload = job.request_payload
        check_in  = datetime.date.fromisoformat(payload['check_in'])
        check_out = datetime.date.fromisoformat(payload['check_out'])
        vessels   = payload.get('vessels', [])

        assigned = {}       # vessel_key -> berth_id
        used_berth_ids = set()
        results = []

        # First pass: score each vessel independently
        vessel_scores = []
        for v in vessels:
            vessel_params = {
                'loa':          v.get('loa'),
                'beam':         v.get('beam'),
                'draft':        v.get('draft'),
                'air_draft':    v.get('air_draft'),
                'shore_power':  v.get('shore_power', False),
                'mooring_pref': v.get('mooring_pref', ''),
                'booking_source': payload.get('booking_source', ''),
            }
            # Load vessel dims from DB if vessel_id provided
            if v.get('vessel_id'):
                try:
                    from apps.vessels.models import Vessel
                    vessel_obj = Vessel.objects.get(pk=v['vessel_id'], marina=job.marina)
                    vessel_params.setdefault('loa',       float(vessel_obj.loa)       if vessel_obj.loa       else None)
                    vessel_params.setdefault('beam',      float(vessel_obj.beam)      if vessel_obj.beam      else None)
                    vessel_params.setdefault('draft',     float(vessel_obj.draft)     if vessel_obj.draft     else None)
                    vessel_params.setdefault('air_draft', float(vessel_obj.air_draft) if vessel_obj.air_draft else None)
                except Exception:
                    pass

            scorer = SmartBerthScorer(job.marina, check_in, check_out, vessel_params)
            scored = scorer.score_all()
            vessel_scores.append({'vessel': v, 'scored': scored})

        # Pier-clustering pass: find if a single pier can hold all vessels
        if vessel_scores:
            # Collect all logical piers that appear in every vessel's top results
            pier_candidates = None
            for vs in vessel_scores:
                piers_for_vessel = {r['logical_pier'] for r in vs['scored'] if r['logical_pier']}
                if pier_candidates is None:
                    pier_candidates = piers_for_vessel
                else:
                    pier_candidates &= piers_for_vessel

            if pier_candidates:
                # Try to cluster: assign each vessel to best berth on the shared pier
                clustering_pier = next(iter(pier_candidates))
                temp_used = set()
                cluster_ok = True
                cluster_assignments = []
                for vs in vessel_scores:
                    on_pier = [r for r in vs['scored'] if r['logical_pier'] == clustering_pier
                               and r['berth_id'] not in temp_used]
                    if not on_pier:
                        cluster_ok = False
                        break
                    best = on_pier[0]
                    temp_used.add(best['berth_id'])
                    cluster_assignments.append((vs['vessel'], best))
                if cluster_ok:
                    vessel_scores = []  # replace with cluster assignments
                    for v, best in cluster_assignments:
                        results.append({
                            'vessel':     v,
                            'assignment': best,
                            'clustered':  True,
                        })
                    used_berth_ids = {r['assignment']['berth_id'] for r in results}
                    vessel_scores = []  # all done

        # Greedy fallback: assign best available berth per vessel
        for vs in vessel_scores:
            available = [r for r in vs['scored'] if r['berth_id'] not in used_berth_ids]
            if available:
                best = available[0]
                used_berth_ids.add(best['berth_id'])
                results.append({'vessel': vs['vessel'], 'assignment': best, 'clustered': False})
            else:
                results.append({'vessel': vs['vessel'], 'assignment': None, 'clustered': False})

        job.result_payload = {'assignments': results}
        job.status = 'complete'
        job.completed_at = timezone.now()
        job.save(update_fields=['result_payload', 'status', 'completed_at'])

    except Exception as exc:
        job.error_detail = str(exc)
        job.status = 'failed'
        job.completed_at = timezone.now()
        job.save(update_fields=['error_detail', 'status', 'completed_at'])
        raise


@app.task(name='berths.check_non_returns')
def check_non_returns():
    """
    Periodic task (every 30 min via Celery beat).
    Raises BerthAlert(alert_type='non_return') for any TemporaryDeparture that has
    not returned after the marina's grace period, then elevates to CRITICAL if
    the escalation threshold is passed.

    IMPORTANT: This task NEVER auto-generates a coast guard report — only the
    explicit staff API endpoint does that.
    """
    from apps.accounts.models import Marina
    from apps.berths.models import BerthAlert, TemporaryDeparture

    now = timezone.now()

    for marina in Marina.objects.all():
        grace_delta     = datetime.timedelta(hours=marina.non_return_grace_hours)
        escalation_delta = datetime.timedelta(hours=marina.coastguard_escalation_hours)

        overdue_departures = TemporaryDeparture.objects.filter(
            marina=marina,
            status='active',
            expected_return__lt=(now - grace_delta).date(),
        )

        for departure in overdue_departures:
            # Only create if no open/critical alert already exists for this departure
            existing = BerthAlert.objects.filter(
                marina=marina,
                alert_type='non_return',
                departure=departure,
                status__in=['open', 'critical'],
            ).first()
            if existing:
                alert = existing
                created = False
            else:
                alert, created = BerthAlert.objects.get_or_create(
                    marina=marina,
                    alert_type='non_return',
                    departure=departure,
                    defaults={
                        'vessel': departure.vessel,
                        'berth':  departure.berth,
                        'status': 'open',
                        'detail': 'Vessel has not returned after the grace period.',
                    },
                )

            # Elevate to CRITICAL once the alert is old enough
            if not created and alert.status == 'open':
                if alert.created_at < now - escalation_delta:
                    alert.status = 'critical'
                    alert.save(update_fields=['status'])
                    # Plug-in point for push notification to harbour master
