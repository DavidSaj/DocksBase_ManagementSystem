import logging
from datetime import date

from django.http import HttpResponse, JsonResponse
from django.template.loader import render_to_string
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework.filters import SearchFilter
from django_filters.rest_framework import DjangoFilterBackend

from .models import Member, Segment
from .serializers import MemberSerializer, SegmentSerializer

try:
    from weasyprint import HTML as WeasyHTML
except OSError:
    WeasyHTML = None  # type: ignore[assignment,misc]

logger = logging.getLogger(__name__)


class MemberListCreateView(generics.ListCreateAPIView):
    serializer_class = MemberSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['member_type', 'insurance_status', 'docs_status']
    search_fields = ['name', 'email']

    def get_queryset(self):
        return Member.objects.filter(marina=self.request.user.marina).prefetch_related('vessels')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class MemberDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = MemberSerializer

    def get_queryset(self):
        return Member.objects.filter(marina=self.request.user.marina).prefetch_related('vessels')


class SegmentListCreateView(generics.ListCreateAPIView):
    serializer_class = SegmentSerializer

    def get_queryset(self):
        return Segment.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class SegmentDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = SegmentSerializer

    def get_queryset(self):
        return Segment.objects.filter(marina=self.request.user.marina)


class BerthAgreementPDFView(APIView):
    """
    GET /members/{member_id}/berth-agreement-pdf/

    Query params (all required except notes):
      berth_id     – pk of a Berth belonging to this marina
      start_date   – YYYY-MM-DD
      end_date     – YYYY-MM-DD
      annual_rate  – decimal, e.g. 3500.00
      notes        – optional free text appended to the agreement
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, member_id):
        if WeasyHTML is None:
            return JsonResponse(
                {'detail': 'PDF generation not available in this environment.'},
                status=503,
            )

        marina = request.user.marina

        # ── Load & validate member ────────────────────────────────────────────
        try:
            member = Member.objects.get(pk=member_id, marina=marina)
        except Member.DoesNotExist:
            return JsonResponse({'detail': 'Member not found.'}, status=404)

        # ── Load & validate berth ─────────────────────────────────────────────
        berth_id = request.query_params.get('berth_id')
        if not berth_id:
            return JsonResponse({'detail': 'berth_id is required.'}, status=400)

        from berths.models import Berth
        try:
            berth = Berth.objects.select_related('pier', 'category').get(
                pk=berth_id, marina=marina
            )
        except Berth.DoesNotExist:
            return JsonResponse({'detail': 'Berth not found.'}, status=404)

        # ── Validate required date / rate params ─────────────────────────────
        start_date_raw = request.query_params.get('start_date')
        end_date_raw   = request.query_params.get('end_date')
        annual_rate    = request.query_params.get('annual_rate')

        for param, name in [(start_date_raw, 'start_date'), (end_date_raw, 'end_date'), (annual_rate, 'annual_rate')]:
            if not param:
                return JsonResponse({'detail': f'{name} is required.'}, status=400)

        try:
            from datetime import datetime
            start_date = datetime.strptime(start_date_raw, '%Y-%m-%d').date()
            end_date   = datetime.strptime(end_date_raw,   '%Y-%m-%d').date()
        except ValueError:
            return JsonResponse({'detail': 'start_date and end_date must be YYYY-MM-DD.'}, status=400)

        notes = request.query_params.get('notes', '')

        # ── Vessel & insurance ────────────────────────────────────────────────
        vessel    = member.vessels.first()
        insurance = None
        if vessel:
            try:
                insurance = vessel.insurance
            except Exception:
                pass

        # ── Agreement metadata ────────────────────────────────────────────────
        year             = start_date.year
        agreement_number = f'BA-{member.id}-{year}'
        today            = date.today()
        doc_date         = f'{today.day} {today.strftime("%B %Y")}'

        # ── Sub-letting consent ───────────────────────────────────────────────
        sublet_explicit = True  # Member model has the field
        sublet_allowed  = getattr(member, 'sublet_opt_in', False)

        # ── Render template ───────────────────────────────────────────────────
        context = {
            'marina':            marina,
            'member':            member,
            'vessel':            vessel,
            'insurance':         insurance,
            'berth':             berth,
            'start_date':        start_date,
            'end_date':          end_date,
            'annual_rate':       annual_rate,
            'notes':             notes,
            'year':              year,
            'agreement_number':  agreement_number,
            'doc_date':          doc_date,
            'sublet_explicit':   sublet_explicit,
            'sublet_allowed':    sublet_allowed,
        }

        try:
            html_string = render_to_string('members/berth_agreement_pdf.html', context)
            pdf_bytes   = WeasyHTML(string=html_string).write_pdf()
        except Exception:
            logger.exception('Berth agreement PDF generation failed for member %s', member_id)
            return JsonResponse({'detail': 'PDF generation failed.'}, status=500)

        safe_name = member.name.replace(' ', '-')
        filename  = f'berth-agreement-{safe_name}-{year}.pdf'

        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response
