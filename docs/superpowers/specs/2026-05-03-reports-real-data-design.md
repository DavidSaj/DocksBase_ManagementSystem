# Reports — Real Data Connection Design

**Date:** 2026-05-03
**Branch:** feature/reports-real-data (to be created)

## Overview

Replace all hardcoded mock data in `Reports.jsx` with live data from the backend. The existing `/api/v1/reports/` app has four views that are never called by the frontend — extend them and wire them up.

## What Changes

### Currently hardcoded (to be replaced)
- `MONTHLY_REV` constant — 7 months of revenue by fake category
- `BERTH_UTIL` constant — 8 fake berths with days/utilisation/revenue
- Arrivals & Departures Today — 5 hardcoded events
- "Avg Stay (nights)" KPI — hardcoded "3.8"
- Invoice overdue count — hardcoded 0 (wrong DB status lookup)

### Already real (no change)
- Occupancy KPIs (total/occupied/available) — `useBerths()`
- Occupancy by Pier chart — `useBerths()` + `usePiers()`
- Revenue outstanding/unpaid — `useInvoices()`
- Entire Compliance tab — `useMembers()`, `useAssets()`, `useDefects()`

## Backend Design

All changes are in-place edits to `backend/apps/reports/views.py`. No new endpoints or files.

### `RevenueReportView` (extended)

**New fields returned:**

```json
{
  "monthly_breakdown": [
    { "month": "2025-10", "berth": 4200, "utility": 620, "service": 340, "retail": 1800 },
    ...
  ],
  "current_month_by_category": { "berth": 5800, "utility": 780, "service": 420, "retail": 2100 },
  "invoices_overdue": 3
}
```

**Query logic:**
- `monthly_breakdown`: last 7 months. For each month, aggregate `InvoiceLineItem.total_price` grouped by `chargeable_item__category`, filtered by `invoice__created_at__month/year` and `invoice__marina`.
- `current_month_by_category`: same query restricted to the current month.
- `invoices_overdue`: `Invoice.objects.filter(marina=marina, status='open', due_date__lt=today).count()`

**Category mapping** (real `ChargeableItem.Category` choices):
- `berth` → Berth Fees
- `utility` → Utilities
- `service` → Services
- `retail` → Retail

Line items with `chargeable_item=NULL` are counted under `service` as a fallback.

### `OccupancyReportView` (extended)

**New fields returned:**
```json
{
  "departures_today": [
    { "vessel": "Windseeker", "berth": "A8", "status": "confirmed" }
  ],
  "avg_stay_nights": 4.2
}
```

**Query logic:**
- `departures_today`: `Booking.objects.filter(marina=marina, check_out=today, status__in=['confirmed', 'active']).select_related('vessel', 'berth')`
- `avg_stay_nights`: aggregate average of `(check_out - check_in).days` for bookings in the current month. Returns `None` if no bookings; frontend shows "—".

### `UtilisationReportView` (extended)

**New fields returned per berth:**
```json
{
  "berths": [
    {
      "berth": "A1",
      "pier": "A",
      "status": "occupied",
      "vessel": "Ocean Star",
      "days_occupied": 28,
      "util_pct": 93.3
    }
  ]
}
```

**Query logic:**
- `days_occupied`: for each berth, find all bookings overlapping the current month. Clamp `check_in` to month start and `check_out` to month end. For each booking compute `nights = (clamped_out - clamped_in).days`, then apply `max(1, nights)` so that a same-day stay (boat in the slip but gone before midnight) still counts as 1 occupied day. Sum across all bookings for the berth. Only count bookings with status `confirmed` or `active`.
- `util_pct`: `round(days_occupied / days_in_month * 100, 1)`
- `days_in_month`: computed from `calendar.monthrange`

### `ComplianceReportView`

No changes. Frontend uses member/asset/defect hooks directly.

## Frontend Design

### New file: `frontend/src/hooks/useReports.js`

```js
// Calls GET /api/v1/reports/{type}/ and returns { data, loading, error }
// type: 'occupancy' | 'revenue' | 'utilisation'
```

Same pattern as existing hooks (`useBerths`, `useInvoices`, etc.) — `useState` + `useEffect` + `api.get`.

### `Reports.jsx` changes

**Imports:** Add `useReports`. Remove `MONTHLY_REV` and `BERTH_UTIL` constants.

**Hook calls at top of component:**
```js
const { data: occReport,  loading: occRLoading  } = useReports('occupancy');
const { data: revReport,  loading: revRLoading  } = useReports('revenue');
const { data: utilReport, loading: utilRLoading } = useReports('utilisation');
```

**Occupancy tab:**
- "Avg Stay (nights)" KPI: `occReport?.avg_stay_nights ?? '—'`
- Arrivals & Departures Today: render `occReport?.arrivals_today` + `occReport?.departures_today`. Check-in/check-out buttons remain UI-only (no action wired in this iteration).
- Show combined loading state from `bLoading || occRLoading`

**Revenue tab:**
- Monthly chart: `revReport?.monthly_breakdown ?? []`. Show loading skeleton if `revRLoading`.
- KPI cards: derive total from `revReport?.current_month_by_category`. Sub-labels update to real category names (Berth Fees, Utilities, Services, Retail).
- Department chart: `revReport?.current_month_by_category`
- Overdue badge: `revReport?.invoices_overdue ?? 0`
- "Revenue — [Month]" label: derive from current month, not hardcoded "April"

**Berth Utilisation tab:**
- Table rows: `utilReport?.berths ?? []`
- Columns: Berth, Current Vessel, Days Occupied, Utilisation % — revenue column removed
- Empty state: "No utilisation data for this month" if `berths.length === 0`

## Out of Scope

- Revenue per berth (deferred — requires accrual-basis attribution logic)
- Check-in / check-out actions from the Arrivals card
- Date range pickers (always shows current month / today)
- Export CSV on the Utilisation tab (button stays but remains no-op for now)
