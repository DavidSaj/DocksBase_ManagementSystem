"""
apps.accounting.exports
=======================

Period-end CSV export formatters.

Each module exposes a single `generate(job: ExportJob) -> None` callable that:

  - reads invoice / line-item rows for `job.marina` in the date range,
  - writes a CSV (or a small zip of CSVs) to a temporary file,
  - persists it to `job.file`,
  - updates `job.status`, `job.completed_at`, `job.row_count`, and
    `job.total_gross`/`job.total_tax`/`job.total_net`.

Resolve a format string to its generator with `get_generator(format_choice)`.
"""

from typing import Callable

from apps.accounting.models import ExportJob

from . import generic, qbo, xero, tax_summary


_GENERATORS = {
    ExportJob.Format.GENERIC_CSV:     generic.generate,
    ExportJob.Format.QBO_CSV:         qbo.generate,
    ExportJob.Format.XERO_CSV:        xero.generate,
    ExportJob.Format.TAX_SUMMARY_CSV: tax_summary.generate,
}


def get_generator(format_choice: str) -> Callable[[ExportJob], None]:
    try:
        return _GENERATORS[format_choice]
    except KeyError as exc:
        raise ValueError(f'No export generator registered for format={format_choice!r}.') from exc


__all__ = ['generic', 'qbo', 'xero', 'tax_summary', 'get_generator']
