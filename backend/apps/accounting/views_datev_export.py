"""
DATEV "Buchungsstapel" (EXTF v7) export for German marinas.

Generates a DATEV-compliant CSV that a German tax accountant (Steuerberater)
can import directly into DATEV Rechnungswesen / DATEV Unternehmen Online.

Format specification: DATEV Format Beschreibung EXTF, version 510 / record set
type 21 ("Buchungsstapel"), header version 7.

Quirks the format demands:
  - File encoding: Windows-1252 (CP1252), NOT UTF-8.
  - Field separator: semicolon (;)
  - Decimal separator: comma (,)
  - Text fields wrapped in double quotes
  - Dates as DDMMYYYY (no separators)
  - First line: Vorlauf header (24 fields, semicolon-separated)
  - Second line: column header row (German field names)
  - Subsequent lines: one row per booking line ("Einzelbuchung" style)

Endpoint:
  GET /accounting/export/datev.csv/
      ?from=YYYY-MM-DD&to=YYYY-MM-DD
      &consultant=<DATEV-Berater-Nr>      (default 1)
      &client=<DATEV-Mandanten-Nr>        (default 1)
      &posted_only=true
"""

from datetime import datetime, timezone as dt_timezone
from io import StringIO

from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from apps.accounting.models import JournalEntry, JournalEntryLine

DATEV_FORMAT_NAME      = 'Buchungsstapel'
DATEV_FORMAT_VERSION   = 7
DATEV_RECORD_TYPE      = 21
DATEV_FORMAT_KENNZ     = 'EXTF'
DATEV_VERSION          = 510

# Column header row — these German names are part of the DATEV spec.
# Truncated to the 19-column "minimum useful" subset; DATEV pads missing cols.
COLUMN_HEADERS = [
    'Umsatz (ohne Soll/Haben-Kz)',
    'Soll/Haben-Kennzeichen',
    'WKZ Umsatz',
    'Kurs',
    'Basisumsatz',
    'WKZ Basisumsatz',
    'Konto',
    'Gegenkonto (ohne BU-Schlüssel)',
    'BU-Schlüssel',
    'Belegdatum',
    'Belegfeld 1',
    'Belegfeld 2',
    'Skonto',
    'Buchungstext',
    'Postensperre',
    'Diverse Adressnummer',
    'Geschäftspartnerbank',
    'Sachverhalt',
    'Zinssperre',
]


def _q(value: str) -> str:
    """Quote a string field. DATEV escapes embedded quotes by doubling them."""
    if value is None:
        return '""'
    s = str(value).replace('"', '""')
    return f'"{s}"'


def _amount(decimal_value) -> str:
    """DATEV expects decimal comma and no thousands separator."""
    if decimal_value is None:
        return '0,00'
    return f'{abs(decimal_value):.2f}'.replace('.', ',')


def _date(d) -> str:
    """DATEV Belegdatum: DDMM (within Buchungsstapel year-range)."""
    return d.strftime('%d%m') if d else ''


def _vorlauf(date_from, date_to, consultant, client, currency, source_label) -> str:
    """Build the first line — Vorlauf header (24 fields)."""
    now = datetime.now(tz=dt_timezone.utc).strftime('%Y%m%d%H%M%S000')
    year = (date_from or date_to or datetime.now()).year
    # WJ-Beginn = beginning of fiscal year, defaulting to 1 Jan
    wj_beginn = f'{year}0101'
    df = date_from.strftime('%Y%m%d') if date_from else ''
    dt = date_to.strftime('%Y%m%d') if date_to else ''

    fields = [
        _q(DATEV_FORMAT_KENNZ),         # 1. Format-Kennzeichen
        str(DATEV_VERSION),             # 2. Versionsnummer
        str(DATEV_RECORD_TYPE),         # 3. Datenkategorie (21 = Buchungsstapel)
        _q(DATEV_FORMAT_NAME),          # 4. Formatname
        str(DATEV_FORMAT_VERSION),      # 5. Formatversion
        now,                            # 6. Erzeugt am (yyyymmddhhmmssfff)
        '',                             # 7. Importiert
        _q(source_label),               # 8. Herkunft-Kennzeichen
        _q(''),                         # 9. Exportiert von
        _q('DocksBase'),                # 10. Importiert von
        str(consultant),                # 11. Berater
        str(client),                    # 12. Mandant
        wj_beginn,                      # 13. WJ-Beginn
        '4',                            # 14. Sachkontenlänge (default 4)
        df,                             # 15. Datum von
        dt,                             # 16. Datum bis
        _q('Buchungen'),                # 17. Bezeichnung
        _q(''),                         # 18. Diktatkürzel
        '1',                            # 19. Buchungstyp (1 = Finanzbuchführung)
        '0',                            # 20. Rechnungslegungszweck
        '0',                            # 21. Festschreibung (0 = nicht festgeschrieben)
        _q(currency or 'EUR'),          # 22. WKZ Buchführung
        '',                             # 23. (reserviert)
        '',                             # 24. Derivatskennzeichen
    ]
    return ';'.join(fields)


def _booking_row(line: JournalEntryLine) -> str:
    """One CSV row per JournalEntryLine in DATEV Einzelbuchung style."""
    entry = line.entry
    amount = line.debit if line.debit > 0 else line.credit
    sh = 'S' if line.debit > 0 else 'H'
    konto = line.account.external_code or line.account.code

    text = (entry.description or line.description or '')[:60].replace(';', ',')
    belegfeld_1 = (entry.reference or f'JE-{entry.pk}')[:36]

    fields = [
        _amount(amount),         # 1. Umsatz
        _q(sh),                  # 2. Soll/Haben-Kennzeichen
        _q(entry.currency),      # 3. WKZ Umsatz
        '',                      # 4. Kurs
        '',                      # 5. Basisumsatz
        '',                      # 6. WKZ Basisumsatz
        _q(konto),               # 7. Konto
        '',                      # 8. Gegenkonto (Einzelbuchung — leave blank)
        '',                      # 9. BU-Schlüssel
        _date(entry.entry_date), # 10. Belegdatum (DDMM)
        _q(belegfeld_1),         # 11. Belegfeld 1 (reference)
        '',                      # 12. Belegfeld 2
        '',                      # 13. Skonto
        _q(text),                # 14. Buchungstext
        '',                      # 15. Postensperre
        '',                      # 16. Diverse Adressnummer
        '',                      # 17. Geschäftspartnerbank
        '',                      # 18. Sachverhalt
        '',                      # 19. Zinssperre
    ]
    return ';'.join(fields)


class DatevCSVExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        date_from_str = request.GET.get('from')
        date_to_str   = request.GET.get('to')
        consultant    = request.GET.get('consultant', '1')
        client        = request.GET.get('client', '1')
        posted_only   = request.GET.get('posted_only', 'true').lower() in ('1', 'true', 'yes')

        def _parse(s):
            return datetime.strptime(s, '%Y-%m-%d').date() if s else None
        try:
            date_from = _parse(date_from_str)
            date_to   = _parse(date_to_str)
        except ValueError:
            return HttpResponse('Invalid date format. Use YYYY-MM-DD.', status=400)

        qs = (
            JournalEntryLine.objects
            .filter(entry__marina=marina)
            .select_related('entry', 'account')
            .order_by('entry__entry_date', 'entry__id', 'id')
        )
        if date_from:    qs = qs.filter(entry__entry_date__gte=date_from)
        if date_to:      qs = qs.filter(entry__entry_date__lte=date_to)
        if posted_only:  qs = qs.filter(entry__is_posted=True)

        # Determine currency from the first entry, falling back to EUR.
        currency = 'EUR'
        first_entry = JournalEntry.objects.filter(marina=marina).order_by('-entry_date').first()
        if first_entry:
            currency = first_entry.currency

        # Build the file in memory — DATEV files are typically small, and we need
        # Windows-1252 encoding which doesn't stream well via StreamingHttpResponse.
        buf = StringIO()
        buf.write(_vorlauf(date_from, date_to, consultant, client, currency,
                           source_label='DB'))   # DB = DocksBase
        buf.write('\r\n')
        buf.write(';'.join(_q(c) for c in COLUMN_HEADERS))
        buf.write('\r\n')
        for line in qs.iterator(chunk_size=500):
            buf.write(_booking_row(line))
            buf.write('\r\n')

        content = buf.getvalue().encode('cp1252', errors='replace')

        filename_parts = ['EXTF', 'Buchungsstapel']
        if date_from: filename_parts.append(date_from.strftime('%Y%m%d'))
        if date_to:   filename_parts.append(date_to.strftime('%Y%m%d'))
        filename = '_'.join(filename_parts) + '.csv'

        response = HttpResponse(content, content_type='text/csv; charset=cp1252')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response
