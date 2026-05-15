"""
Generic journal export.

Endpoint:
  GET /accounting/export/journal.csv/?from=YYYY-MM-DD&to=YYYY-MM-DD&posted_only=true

Streams every JournalEntryLine in the marina between from/to (inclusive) as CSV,
one row per line. This is the universal fallback for accountants on platforms
we don't natively integrate with — they can import the file into anything that
accepts a CSV journal.
"""

import csv

from django.http import StreamingHttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from apps.accounting.models import JournalEntryLine


class _Echo:
    """File-like object writing to a returned string buffer (Django streaming pattern)."""
    def write(self, value):
        return value


COLUMNS = [
    'entry_id', 'entry_date', 'source_type', 'reference', 'description',
    'account_code', 'account_name', 'account_type',
    'cost_centre',
    'debit', 'credit',
    'currency', 'fx_rate',
    'foreign_debit', 'foreign_credit',
    'is_posted',
]


def _row(line):
    e = line.entry
    return [
        e.id,
        e.entry_date.isoformat() if e.entry_date else '',
        e.source_type,
        e.reference,
        e.description.replace('\n', ' ').strip(),
        line.account.code,
        line.account.name,
        line.account.account_type,
        line.cost_centre.code if line.cost_centre_id else '',
        f'{line.debit:.2f}',
        f'{line.credit:.2f}',
        e.currency,
        f'{e.fx_rate}',
        f'{line.amount_foreign_debit:.2f}'  if line.amount_foreign_debit  is not None else '',
        f'{line.amount_foreign_credit:.2f}' if line.amount_foreign_credit is not None else '',
        'Y' if e.is_posted else 'N',
    ]


class JournalCSVExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        qs = (
            JournalEntryLine.objects
            .filter(entry__marina=marina)
            .select_related('entry', 'account', 'cost_centre')
            .order_by('entry__entry_date', 'entry__id', 'id')
        )
        date_from = request.GET.get('from')
        date_to   = request.GET.get('to')
        if date_from:
            qs = qs.filter(entry__entry_date__gte=date_from)
        if date_to:
            qs = qs.filter(entry__entry_date__lte=date_to)
        if request.GET.get('posted_only', '').lower() in ('1', 'true', 'yes'):
            qs = qs.filter(entry__is_posted=True)

        writer = csv.writer(_Echo())

        def stream():
            yield writer.writerow(COLUMNS)
            for line in qs.iterator(chunk_size=500):
                yield writer.writerow(_row(line))

        filename_parts = ['journal']
        if date_from: filename_parts.append(date_from)
        if date_to:   filename_parts.append(date_to)
        filename = '-'.join(filename_parts) + '.csv'

        response = StreamingHttpResponse(stream(), content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response
