# DocksBase — Product Feature Specification

**Document version:** 1.2
**Date:** 2026-04-24
**Status:** Draft
**Scope:** Full platform specification for DocksBase marina and hospitality management system

---

## Table of Contents

1. [Core Marina Operations — Berths, Slips & Map](#1-core-marina-operations--berths-slips--map)
2. [Reservations & Bookings](#2-reservations--bookings)
3. [Vessel Management](#3-vessel-management)
4. [Customer & Member Management](#4-customer--member-management)
5. [Financial Management — Billing, Invoicing & Payments](#5-financial-management--billing-invoicing--payments)
6. [Boatyard & Yard Services](#6-boatyard--yard-services)
7. [Utility Management — Electricity, Water & Fuel](#7-utility-management--electricity-water--fuel)
8. [Maintenance & Asset Management](#8-maintenance--asset-management)
9. [Staff & Crew Management](#9-staff--crew-management)
10. [Communications & Notifications](#10-communications--notifications)
11. [Analytics & Reporting](#11-analytics--reporting)
12. [Restaurant & Food and Beverage](#12-restaurant--food-and-beverage)
13. [Events & Venue Hire](#13-events--venue-hire)
14. [Customer Self-Service Portal & Apps](#14-customer-self-service-portal--apps)
15. [Security & Access Control](#15-security--access-control)
16. [Environmental & Compliance](#16-environmental--compliance)
17. [Integrations](#17-integrations)
18. [System Administration & Multi-Marina](#18-system-administration--multi-marina)
19. [Boat Sales & Brokerage](#19-boat-sales--brokerage)
20. [Native eSignature Workflows](#20-native-esignature-workflows)
21. [Tool & Equipment Management](#21-tool--equipment-management)
22. [Dry Stack Launch Queue](#22-dry-stack-launch-queue)
23. [Linear Dockage & Partial Slip Management](#23-linear-dockage--partial-slip-management)

---

## 1. Core Marina Operations — Berths, Slips & Map

### 1.1 Interactive Marina Map

The marina map is the central operational view of the system. It renders the physical harbour layout as an interactive, zoomable SVG diagram updated in real time from the database.

- **Animated water background** — SVG wave animation representing the harbour basin; speed and colour adapt to current wind and tide data from the weather integration
- **Pier and berth rendering** — all piers, jetties, pontoons, and finger berths are drawn from a JSON map definition stored per marina; the map is not hard-coded
- **Mooring type support** — each berth is typed as one of: finger, hammerhead, alongside, swinging mooring, fore and aft, trots, pile mooring, or dry stack; the icon and cell shape reflect the mooring type
- **Real-time status colour coding** — occupied (blue), available (green), reserved/incoming (gold), out of service/maintenance (red), seasonally contracted (teal), departure today (orange); legend always visible
- **Click-to-inspect** — clicking any berth opens a slide-in detail panel showing: vessel name, owner name, vessel type, LOA, draft, check-in date, check-out date, booking ID, payment status, and utility consumption for the current stay
- **Quick actions from the map** — from the berth detail panel staff can: assign a vessel, create a new booking, mark as available, flag for maintenance, record a meter reading, or navigate to the full booking record
- **Shore facilities layer** — harbormaster office, fuel station, chandlery, pump-out points, bathhouse blocks, parking areas, boatyard, crane zones, and restaurant are rendered as distinct building icons with click-through labels; each layer can be toggled on or off
- **Compass rose and scale bar** — static navigational aids always rendered on the map
- **Depth soundings** — chart depths shown as text overlays at key channel and approach points; updated when marina admin enters dredge survey data
- **Map Builder Tool** — a drag-and-drop editor (administrators only) that lets operators define their own harbour layout: draw piers, place berths, set mooring types, define berth dimensions, name facilities, and set channel depths; layout saved as versioned JSON and re-renders the live map without any code deployment

### 1.2 Berth & Slip Inventory

- **Berth master record** — each berth has: unique ID, pier/pontoon assignment, length (m), beam limit (m), draft limit (m), mooring type, power supply type (16A/32A/three-phase/none), water supply (yes/no), WiFi access point ID, accessibility notes, and current status
- **Berth categories** — visitor/transient, seasonal, annual, commercial, superyacht, live-aboard, dinghy, kayak/paddleboard, commercial fishing; each category carries a default rate card and lease template
- **Berth availability calendar** — per-berth calendar showing confirmed, pending, and blocked dates; supports multi-month view; exportable as iCal
- **Berth blocking** — staff can manually block a berth for a date range with a reason (maintenance, reserved for event, owner request); blocked berths are excluded from online availability and shown in red on the map
- **Berth utilisation score** — calculated metric per berth showing days occupied vs days available over a rolling 30/90/365-day window; surfaced on both the berth record and the analytics module
- **Berth wait list** — per-category queue for seasonal and annual berths; records applicant details, preferred dates, vessel dimensions, position in queue, and date applied; automated notification when a berth becomes available
- **Berth transfer** — reassign an active booking from one berth to another (e.g. move a vessel for maintenance access) with automatic re-generation of any affected invoices

---

## 2. Reservations & Bookings

### 2.1 Booking Creation and Types

- **Booking types supported:** transient (nightly), weekly, fortnightly, monthly, quarterly, seasonal (typically May–October), annual, live-aboard licence, visitor day berth
- **New booking wizard** — step-by-step form: (1) search or create a vessel record, (2) select or auto-assign a berth that fits vessel dimensions, (3) choose dates, (4) select rate plan, (5) add optional extras (electricity, water, pump-out, parking, WiFi token, laundry access), (6) review total, (7) confirm and optionally collect deposit or full payment
- **Auto-assign berth** — system suggests the best-fit available berth based on vessel LOA, beam, draft, and mooring type preference; staff can override the suggestion
- **Split-stay bookings** — a single booking can span multiple berths if the vessel must move mid-stay (e.g. during a haul-out); the invoice is generated as a single document covering all berth fees
- **Repeat/recurring bookings** — create a recurring annual booking for a returning seasonal customer; system generates the next season's booking and sends a renewal invitation automatically
- **Group bookings** — link multiple vessels arriving together (rally, yacht club visit) under a single group reference; pricing tiers can apply per group size
- **Waitlist placement** — when no suitable berth is available, create a waitlisted booking with an ETA and notify the owner automatically when space opens up

### 2.2 Booking Management

- **Booking list view** — filterable and searchable table: booking ID, vessel, owner, berth, check-in/out dates, duration, type, status, amount, payment status; supports column sorting
- **Booking status lifecycle** — inquiry → pending → confirmed → active (checked in) → checked out → overdue (overstayed) → cancelled
- **Detail panel** — click any booking row to open a slide-in panel with full details, notes, payment history, utility charges accrued, and all associated documents
- **Check-in workflow** — dock master confirms arrival: verifies vessel against booking, records actual arrival time, confirms mooring allocation, issues gate code/key fob if applicable, captures skipper signature on arrival form, marks booking as active
- **Check-out workflow** — dock master records departure time, finalises utility charges, generates a departure invoice, collects outstanding payment, marks the berth as available
- **Early departure and extensions** — staff can extend a booking if the berth is available, or process an early departure with automatic credit note for unused nights
- **Overstay management** — system flags bookings where the checkout date has passed but the vessel is still on the map; generates overstay alerts and automatically applies the overstay daily rate; sends reminder to owner
- **Booking notes and attachments** — free-text notes per booking with timestamps and staff name; attach photos, PDFs, or scanned documents
- **Booking source tracking** — record how the booking was made: walk-in, phone, email, online portal, third-party channel; used in channel performance reporting

### 2.3 Rate Plans and Pricing

- **Rate plan library** — define unlimited named rate plans per marina; each plan specifies: base price per metre per night, minimum charge, weekend premium, peak season multiplier (with date ranges), and vessel type adjustments
- **Seasonal pricing tiers** — configure up to four pricing seasons per year (low, shoulder, high, peak) with automatic transitions on configured dates
- **Length-of-stay discounts** — configure automatic percentage discounts for stays of 7+, 14+, and 28+ nights
- **Reciprocal club discounts** — flag a member as belonging to a partner club (RYA, Cruising Association, specific yacht clubs) and apply the configured discount automatically
- **Manual overrides** — any booking can have a manual price override with a required reason field and staff identity captured for audit trail
- **Price preview** — the booking wizard displays a real-time price breakdown before confirmation: nightly rate × nights, extras, discounts, and VAT

---

## 3. Vessel Management

### 3.1 Vessel Registry

Each vessel in the system has a full profile that persists across bookings and owners:

- **Vessel identification** — vessel name, registration number, flag state, MMSI number, call sign, HIN (hull identification number), IMO number (if applicable)
- **Vessel specifications** — type (motor yacht, sailing yacht, catamaran, trimaran, superyacht, trawler, RIB, dinghy, commercial, tall ship, narrowboat), LOA, beam, draft, air draft, displacement, year built, builder/manufacturer, model name
- **Engine and propulsion** — engine make/model, number of engines, fuel type (diesel, petrol, LPG, electric, hybrid), fuel tank capacity (litres), freshwater tank capacity
- **Mooring preferences** — preferred mooring type, shore power requirement, special handling notes (e.g. "port side to" preference, fendering requirements)
- **Insurance record** — insurer name, policy number, cover level, expiry date, document upload; system warns when insurance is within 30 days of expiry and flags as expired on the day
- **Registration documents** — upload vessel registration certificate, SSR or Part 1, and commercial certificates; track expiry dates
- **Safety equipment log** — record flares expiry, life raft service date, EPIRB battery expiry, fire extinguisher service date; alert when items approach expiry
- **Vessel history** — full log of all past and current bookings, invoices, incidents, haul-outs, and maintenance work
- **Vessel photo gallery** — attach multiple photos per vessel (bow, stern, port, starboard, interior); first photo used as vessel avatar in lists and map tooltips

### 3.2 Vessel Owner Linkage

- A vessel record can be linked to one or more owners/contacts (e.g. joint ownership, skipper as separate contact from registered owner)
- A single owner can have multiple vessels registered
- Ownership transfer workflow: transfer a vessel from one member to another with a changeover date; historical invoices remain linked to the original owner

### 3.3 AIS Vessel Tracking Integration

- **AIS position badge** — if the vessel has a live AIS feed, display current position, speed, course, and last update time directly on the vessel profile page
- **ETA estimation** — when a booking is active, show the vessel's AIS-derived ETA to port compared against the booked arrival date
- Full AIS integration specification covered in Module 17

---

## 4. Customer & Member Management

### 4.1 Member and Owner Registry

- **Contact record** — full name, preferred name, nationality, address (with country), primary and secondary phone, primary and secondary email, language preference, date of birth (optional), profile photo
- **Member type** — transient visitor, seasonal berth holder, annual berth holder, live-aboard, commercial operator, yacht club member, staff/contractor; each type carries different permissions and default rate plans
- **Member status** — active, inactive, suspended (e.g. outstanding debt), blacklisted; status changes logged with reason and staff name
- **Membership number** — auto-generated unique member ID (e.g. M-001); printed on member cards if physical membership cards are used
- **Loyalty and visit history** — total visits, total nights stayed, total spend, first visit date, last visit date; used for repeat-visitor recognition
- **Emergency contact** — name, relationship, phone; mandatory for live-aboard members
- **GDPR / privacy consent** — record marketing consent, communication preferences, and data retention consent at registration; full consent history log; one-click data export (DSAR) and right-to-erasure workflow

### 4.2 Document Vault

- **Per-member document store** — upload and manage: vessel registration certificate, insurance certificate, RYA or equivalent competence certificates, marina licence or lease agreement, COSHH or commercial permits, identity documents
- **Document status matrix** — a single table per member showing all required document types and their status: on file/valid, missing, pending review, expired; colour-coded at a glance
- **Expiry tracking** — any document with an expiry date triggers an automated reminder to the member at 60, 30, and 7 days before expiry; staff receive a daily digest of documents expiring that week
- **Document request workflow** — staff can send a branded document request email with a secure upload link; member uploads through the self-service portal; document appears in the vault pending staff review
- **Document review** — staff mark uploaded documents as approved or rejected (with rejection reason); rejection triggers an automated follow-up request to the member
- **Version history** — keep all previous versions of a document for audit purposes; only the most recent version counts as the active record

### 4.3 Member Communications History

- Full log of all emails, SMS messages, push notifications, and portal messages sent to or received from a member; each entry shows channel, direction, subject, date/time, and delivery status
- Staff notes and internal comments on a member's record with timestamps and staff identity; internal notes are never visible to the member

### 4.4 Member Categorisation and Segmentation

- **Tags and groups** — apply custom tags to members (e.g. "Rally 2026", "VIP", "Commercial", "Referring Club: RORC"); filter and search by tag
- **Saved segments** — define and save reusable audience segments (e.g. "Seasonal holders with expiring insurance", "Members who stayed in July 2025") for use in billing batch runs and communications campaigns

---

## 5. Financial Management — Billing, Invoicing & Payments

### 5.1 Invoice Management

- **Invoice types** — berth fee (transient), seasonal/annual berth fee, electricity charge, water charge, fuel sale, boatyard service, haul-out fee, crane hire, pump-out, parking, laundry, restaurant, event venue hire, miscellaneous charge, credit note
- **Invoice generation** — invoices are created automatically on booking confirmation (berth fees), at check-out (utility charges), or manually for ad hoc charges; numbered sequentially per marina per year (e.g. INV-2026-0001)
- **Invoice detail** — invoice number, issue date, due date, marina name and address, customer name and address, vessel name, itemised line items with quantity/unit price/VAT rate/line total, subtotal, VAT amount per rate, grand total, payment terms, bank details or payment link
- **Invoice status lifecycle** — draft → issued → sent → partially paid → paid → overdue → written off
- **Invoice editing** — drafts can be edited freely; issued invoices can be amended only with a credit note and re-issue (audit trail preserved)
- **Credit notes** — generate a credit note against any issued invoice; partial credits supported; credit notes are applied to the next invoice automatically or refunded

### 5.2 Batch Invoicing

- **Batch run** — trigger a billing batch for a selected member segment (e.g. "all seasonal berth holders") and a billing period; system generates all invoices in a single operation and queues them for review before sending
- **Batch preview** — review all invoices in a batch before sending: inspect any individual invoice, correct discrepancies, remove a member from the batch, or put the whole batch on hold
- **Batch send** — send all approved invoices by email in a single click; delivery status (sent, bounced, opened) tracked per invoice
- **Recurring billing scheduler** — configure automatic monthly or quarterly billing runs; system triggers the batch automatically on the configured date and notifies the administrator to approve before sending

### 5.3 Electronic Invoicing and Payment Collection

- **PDF invoice generation** — branded PDF with marina logo, colours, and legal footer; downloadable and emailed as attachment
- **Online payment link** — each invoice includes a unique payment link; customer clicks link and pays by card; invoice status updates automatically on payment confirmation
- **Payment recording** — record offline payments manually: cash, bank transfer, cheque; capture payment date, reference, and amount; supports partial payments
- **Card-present (chip & PIN) payments** — integration with Stripe Terminal card reader for face-to-face payments at the office or fuel dock POS; payment is recorded against the open invoice automatically
- **Deposit handling** — collect a configurable deposit percentage at booking; deposit is tracked separately from the final balance and applied to the final invoice at check-out
- **Refunds** — process full or partial refunds against any paid invoice via the original payment method or recorded as a manual bank transfer; generates a credit note automatically

### 5.4 Fuel Dock Point of Sale (POS)

- **Quick-sale product buttons** — configurable grid of sale items: diesel (per litre), petrol (per litre), pump-out (flat fee), shore power token, bottled gas, ice, chandlery items, laundry tokens, guest WiFi day pass, merchandise
- **Quantity entry** — for fuel sales, staff enter litres dispensed; system calculates the charge at the current pump price; pump prices are configurable and update in real time on the POS
- **Vessel lookup** — staff search for the vessel to attach the charge to; if the vessel has an open booking, the charge is added to the existing invoice; otherwise a new charge invoice is created
- **Cash payment** — POS supports cash payment with change calculation; cash drawer reconciliation report at end of shift
- **Card payment** — integrated with card reader for chip & PIN and contactless sales at the fuel dock
- **Receipt printing** — configurable thermal receipt printer (Bluetooth or USB); print receipt on completion of sale
- **End-of-day report** — daily fuel dock summary showing total sales by product, total litres dispensed, total cash and card revenue, and running total against previous day and week

### 5.5 Debtor Management

- **Aged debtor report** — lists all outstanding invoices grouped by age bucket: 0–7 days, 8–14 days, 15–30 days, 31–60 days, 61–90 days, 90+ days; shows total outstanding per bucket and grand total
- **Automated reminder sequence** — configure up to four automated payment reminders at defined intervals after the due date; each reminder is a branded email with the invoice PDF attached and a payment link
- **Manual chase** — staff can send a one-off chase email or SMS from the invoice record; logged in the communications history
- **Debt escalation flag** — after a configurable number of days overdue, the invoice is flagged for escalation; marina manager receives an alert; member account can be automatically suspended
- **Write-off workflow** — mark an invoice as written off with a reason code; requires manager-level authorisation; written-off invoices are excluded from active debt reports but retained for accounting export

### 5.6 Accounts and Exports

- **Chart of accounts** — configure income account codes per charge type (berth fees, utilities, fuel, F&B, yard services, etc.) to map to the marina's accounting system
- **CSV/Excel export** — export any invoice list, payment list, or debtor report to CSV or formatted Excel with column headers, at any date range
- **Accounting software integration** — push invoices and payments to Xero or QuickBooks via API (see Module 17)
- **VAT/tax reporting** — generate a VAT summary report for any date range, showing standard-rate, reduced-rate, and zero-rate transactions separately; supports multi-jurisdiction tax codes
- **Daily Z-report** — end-of-day summary of all revenue by department (berths, fuel, utilities, F&B, yard, events); comparable to the previous day and same day last year

### 5.7 Accounts Payable & General Ledger

- **Purchase orders (PO)** — create purchase orders for suppliers (parts, fuel, chandlery stock, F&B ingredients, maintenance supplies); each PO specifies: supplier, line items with quantity and unit cost, expected delivery date, and linked department/cost centre; POs can be generated automatically from low-stock alerts in the parts inventory or F&B stock module
- **PO lifecycle** — draft → sent to supplier → partially received → fully received → invoiced → paid; receiving records are matched against the PO to identify shortages or substitutions
- **Supplier registry** — supplier name, category (fuel, parts, food and beverage, marine services, utilities, facilities), primary contact, payment terms, bank details, default account code
- **Accounts payable (AP)** — record supplier invoices against received POs; track due dates and payment status; aged creditor report mirrors the aged debtor report on the customer side
- **General ledger (GL)** — all income and expenditure transactions post to the GL automatically with the account code defined on each invoice or PO; supports configurable accounting periods; period-end close locks past periods against modification
- **Bank reconciliation** — import bank statements (CSV/OFX/QIF); match imported transactions against GL entries; flag unmatched items for review; mark periods as reconciled; reconciliation history is retained
- **1099 / year-end reporting** — for US-based marinas, generate 1099-MISC/NEC forms for contractors and service providers paid above the IRS threshold; export in IRS-compatible electronic format
- **ACH / direct debit payments** — collect payments from customers via ACH bank debit (US) or BACS direct debit (UK) for recurring seasonal fees and annual berth contracts; customer authorises the mandate once through the self-service portal; subsequent billing periods collect automatically with advance notice sent per regulation
- **1-click autopay** — members with a stored payment method (card or ACH/BACS) can opt into autopay; on invoice generation, the system automatically charges the stored method and marks the invoice as paid; if the charge is declined, the system retries once after 48 hours and then sends a manual payment request with a prominent failure notice

---

## 6. Boatyard & Yard Services

### 6.1 Haul-Out Scheduling

- **Haul-out calendar** — visual calendar view showing all scheduled lifts and splashes across configured equipment (travelifts, slings, cranes, mobile hoist, fork-lift); day and week views; drag-and-drop to reschedule
- **New haul-out booking** — form fields: vessel (auto-populates dimensions from vessel record), haul-out type (haul-out, splash, pressure wash and relaunch, keel work, mast step), requested date and time window, equipment required, estimated duration, yard team assignment
- **Equipment conflict detection** — system prevents double-booking of equipment and crew; warns if the requested vessel draft or weight exceeds the selected equipment's rated capacity
- **Weight and dimension check** — vessel weight validated against travelift rated capacity; LOA and beam checked against yard lanes; warnings are non-blocking (manager can override with a note)
- **Pre-lift checklist** — configurable checklist completed before a haul-out is marked as in-progress: sea cocks closed, engine flushed, keel bolts checked, cradle/chocks ready; each item ticked off with timestamp
- **Post-splash checklist** — configurable checklist completed after splash: sea cocks opened, bilge checked dry, engine start confirmed, mooring lines secured; attached to the haul-out record
- **Yard invoice generation** — on completion, a yard services invoice is automatically generated covering: lift fee, daily hard-standing charge × days on the hard, and any additional services logged during the yard stay

### 6.2 Dry Storage Management

- **Yard grid map** — visual grid of the dry storage yard; each cell displays vessel name (or "empty") colour-coded by status: occupied, available, blocked
- **Multi-level stacking** — support for vessels stored on cradles that block the position behind or below; system tracks which vessels are accessible and which are obstructed; warns when attempting to schedule a launch for an obstructed vessel
- **Vessel placement record** — for each vessel on the hard: position ID, date in, date out (scheduled), cradle ID, jacking pad positions, pressure wash completed, antifoul type and date applied, notes
- **Seasonal storage contracts** — issue a dry storage contract covering a defined period; specifies position, access terms, rate per week or month; documents generated as PDF and stored in the member's document vault
- **Winter lift-out programme** — batch schedule for end-of-season haul-outs; create multiple haul-out slots in sequence, notify vessel owners, track confirmations

### 6.3 Yard Works and Services

- **Work order system** — create a work order against a vessel on the hard: describe the scope of work, assign to an internal team or external contractor, set a target completion date, attach photos or documents
- **Work order status** — pending authorisation → authorised → in progress → completed → invoiced
- **Job estimating** — build a detailed estimate before work begins: line items for labour (hours × rate by trade), parts/materials (with markup), subcontractor costs, and any surcharges; estimates are presented to the owner as a professional PDF for review and sign-off
- **Project templates** — save standard job structures as reusable templates (e.g. "Annual service — outboard engine", "Antifoul + osmosis treatment", "Full rewire"); templates pre-populate the estimate with typical labour tasks and parts, saving time and ensuring consistency
- **Real-time job cost tracking** — as hours and materials are logged, the work order displays running cost vs. estimated cost with a visual indicator; managers are alerted when a job is approaching or has exceeded its budget
- **Progress billing** — for long-duration jobs (multi-week refits, new builds), bill the owner in milestone instalments rather than a single invoice at the end; each milestone has a defined amount and a trigger condition (e.g. "keel work complete", "50% of contracted value"); partial invoices are generated and tracked against the overall contract value
- **Owner authorisation** — for work orders above a configurable value threshold, automatically send the owner an estimate with a click-to-authorise link; work does not commence until authorisation is recorded
- **Labour time logging** — yard staff log hours against a work order from the mobile app; the rate per hour is configured in the rate card by trade/skill type; logged hours are converted to invoice line items automatically
- **Parts and materials tracking** — add material costs to a work order: part number, description, unit cost, quantity, markup percentage; total materials cost feeds into the invoice
- **Warranty management** — flag parts or labour on a completed work order as under warranty; record warranty period, expiry date, and terms; if the customer returns with the same fault within the warranty period, the system links the new work order to the original and flags it for warranty resolution without charge; warranty claims are tracked and reportable by technician and part type
- **Sub-contractor work orders** — work orders can be assigned to external contractors; contractor access period recorded; contractor invoices can be uploaded and attached to the work order for internal cost tracking

### 6.5 Parts & Inventory Management

- **Parts catalogue** — master list of all stocked parts and consumables: part number, description, category, supplier, unit of measure, unit cost, sell price, markup percentage, minimum stock level (par), current stock quantity, storage location (bin/shelf)
- **Stock tracking** — every parts transaction (receipt from PO, issue to work order, return, adjustment) updates the stock quantity in real time; full transaction history per part
- **Barcode support** — assign a barcode or QR code to each part; print barcode labels for shelves and bins; staff scan parts in/out using a mobile device or USB scanner rather than manual entry, reducing errors
- **Special orders** — parts not stocked in the yard can be ordered specifically for a work order; the special order is linked to the work order and the relevant PO; visibility across departments so office staff can advise customers on expected arrival dates
- **Parts issue to work orders** — issue parts directly from stock to a work order; the cost (at unit cost) and the charge (at sell price with markup) are added to the work order automatically
- **Stock adjustment and write-off** — adjust stock quantities for damaged, lost, or miscounted items with a reason code; write-offs are reported separately from normal consumption
- **Low-stock alerts and auto-PO** — when any part falls below its par level, generate an alert; optionally auto-generate a draft purchase order to the default supplier for the shortfall quantity
- **Inventory valuation report** — total value of all stock on hand at cost, by category and overall; useful for insurance and year-end accounting

### 6.4 Contractor Management

- **Contractor registry** — company name, trade (mechanics, electrical, rigging, canvas/upholstery, detailing, painting, plumbing, electronics, surveying), primary contact name, phone, email, public liability insurance expiry, trade qualification certificates, approved status
- **Site access log** — each contractor arrival and departure is logged (automatically if gate integration is active, or manually by dock staff)
- **Contractor access passes** — issue a timed site access pass for a specific vessel and date range; pass can be a PIN code or fob assigned via the access control module
- **Contractor blacklist** — flag a contractor as barred from site with a reason; barred contractors are flagged if they attempt to be added to a work order

---

## 7. Utility Management — Electricity, Water & Fuel

### 7.1 Electricity Metering

- **Smart meter support** — connect to smart electricity sub-meters (M-Bus or Modbus TCP) per berth; readings polled automatically at configurable intervals
- **Manual meter entry** — for marinas without smart meters, staff enter meter start and end readings per berth; entry form shows the previous reading for reference
- **Consumption calculation** — usage = end reading − start reading (kWh); current price per kWh is configurable and can be tiered
- **Meter reading history** — full history of all readings per berth per booking; audit trail showing who entered manual readings and when
- **Anomaly detection** — flag unusual consumption (e.g. >3× average daily usage for that vessel type or berth) for staff attention
- **Utility invoice generation** — at the end of a stay, or monthly for seasonal holders, generate a utility invoice itemising electricity and water charges
- **Electricity hookup types** — configure which supply type is available at each berth: 16A single phase, 32A single phase, 63A single phase, 32A three-phase; charge different rates per supply type if required

### 7.2 Water Metering

- **Water meter reading** — same data model as electricity: start reading, end reading, consumption in litres; price per litre configurable
- **Water usage tracking** — per-berth water usage trends; flag high usage; alert dock staff
- **Potable water vs pump-out** — distinguish potable water supply (charged) from pump-out service (separate flat fee per pump-out event)

### 7.3 Fuel Dock Management

- **Fuel stock tracking** — record daily tank dip readings for each fuel tank (diesel, petrol); system calculates current stock level; low-stock alert configurable per tank
- **Fuel delivery recording** — log supplier deliveries: date, supplier, fuel type, quantity received (litres), unit cost per litre, delivery invoice number; stock level updates automatically
- **Pump price management** — update the pump price per litre for each product; price history is retained; all future sales use the new price
- **Fuel sales reconciliation** — compare total litres sold (from POS) against tank dip readings to identify losses, spillage, or calibration issues; reconciliation report available daily/weekly/monthly
- **Fuel dock safety checks** — daily pre-opening checklist for fuel dock staff: pump calibration verified, spillage kit in place, fire extinguisher checked, no smoking signs visible; checklist is time-stamped and retained

---

## 8. Maintenance & Asset Management

### 8.1 Asset Register

- **Asset types** — cranes/travelifts, fuel pumps, electrical shore power panels, water supply standpipes, gangways, pontoons, dock cleats and bollards, buoys, buildings, CCTV cameras, gate barriers, fire safety equipment, safety vessels/workboats
- **Asset record** — asset ID, name, category, location (pier, building, or map coordinate), manufacturer, model, serial number, purchase date, purchase cost, current replacement value, expected service life, warranty expiry
- **Asset status** — operational, due for service, under repair, out of service, decommissioned
- **Asset photo and documents** — attach installation photos, manuals, warranty documents, and service certificates to the asset record

### 8.2 Maintenance Scheduling

- **Planned preventive maintenance (PPM)** — configure recurring maintenance schedules per asset: daily, weekly, monthly, quarterly, annually, or by operating hours/cycles (e.g. every 500 crane lifts)
- **Maintenance task record** — asset, scheduled date, task description, assigned team or individual, estimated duration, required parts/materials, checklist items, completion date, outcome notes, cost incurred
- **Service history** — full chronological log of all maintenance events per asset; shows last service date, next due date, total maintenance cost to date, mean time between failures
- **Maintenance calendar** — calendar view of all upcoming and overdue maintenance tasks across all assets; colour-coded by status and priority; exportable

### 8.3 Defect and Fault Reporting

- **Defect log** — any staff member can log a defect against any asset or location; fields: location/asset, description, severity (low/medium/high/critical), photo attachment, reporter name, date and time
- **Defect-to-task escalation** — a logged defect can be converted to a maintenance task or work order in one click; the original defect record is linked to the resulting task
- **Defect status** — open → acknowledged → in progress → resolved → closed; status transitions are time-stamped
- **Critical defect alerts** — defects flagged as critical trigger an immediate push notification to the duty harbour master and all staff with the maintenance manager role
- **Berth-linked defects** — defects affecting a specific berth automatically mark the berth as out of service on the map until the defect is resolved; staff must explicitly re-enable the berth

### 8.4 Incident Management

- **Incident report** — log any safety or operational incident: vessel contact, fire, injury, fuel spill, flooding, theft, suspicious activity, near-miss; fields include date/time, location, vessels involved, description, immediate actions taken, photos, severity (low/medium/high/critical/MAIB-reportable)
- **Incident status** — open → under investigation → resolved → closed
- **Resolution notes** — record investigation findings, remedial action taken, lessons learned, and whether any external authority was notified (coastguard, MAIB, police, harbour authority)
- **Insurance claim linkage** — flag an incident as insurance-related; attach the insurance claim reference number; system retains all related photos, reports, and correspondence in a single incident file
- **MAIB reporting** — for UK-registered marinas, flag incidents meeting MAIB (Marine Accident Investigation Branch) reporting criteria; generate a report summary formatted for regulatory submission

### 8.5 Staff Task Management

- **Task creation** — create a task with: title, description, priority (low/medium/high/urgent), category (dock, yard, fuel, electrical, cleaning, admin, safety), assigned team or individual, due date/time, related asset or berth
- **Task board** — Kanban-style view with columns: To Do, In Progress, Blocked, Done; alternatively, a flat list view with filter and sort
- **Daily task digest** — each morning, assigned staff receive an email or push notification listing their open tasks for the day, ordered by priority
- **Recurring tasks** — configure tasks that repeat daily, weekly, or monthly (e.g. "Empty rubbish bins on Pier A — daily 08:00"); system generates the next instance automatically on completion
- **Task completion** — staff mark tasks complete with an optional completion note and photo; timestamp and staff name are recorded

---

## 9. Staff & Crew Management

### 9.1 Staff Directory

- **Staff record** — full name, role/job title, department, contact phone, contact email, emergency contact, start date, contract type (full time, part time, seasonal, contractor), certifications held (VHF radio, first aid, forklift licence, ADR for fuel handling)
- **Role assignment** — each staff member is assigned one or more system roles that determine their permissions (see Module 15)
- **Team grouping** — organise staff into named teams (Dock Team A, Dock Team B, Yard Team 1, Fuel Team, Office, Kitchen); tasks and assignments use team names for bulk assignment

### 9.2 Rota and Shift Scheduling

- **Shift planner** — weekly calendar view showing all staff; drag-and-drop to assign shifts; each shift has: staff member, start time, end time, role/position, location (dock, yard, office, fuel dock, restaurant, security)
- **AI-assisted scheduling** — when building the yard or dock schedule, the system analyses open work orders, their estimated durations, technician certifications, and current workload; it suggests an optimised technician-to-job assignment for the day or week that minimises conflicts and balances hours across the team; the manager reviews and approves the suggestion before it is published
- **Technician workload view** — visual display of each technician's assigned hours per day against their available hours; identify over-allocated and under-utilised staff at a glance
- **Shift templates** — save and reuse rota templates (standard summer rota, bank holiday rota, winter skeleton rota)
- **Shift confirmation** — staff receive a notification when a shift is published; can confirm or flag a conflict
- **Absence recording** — log absences: holiday, sickness, training leave, unpaid leave; annual leave balance tracked per staff member; absence shown on the rota in a distinct colour
- **Minimum cover warnings** — configure minimum staffing levels per role per shift; system warns the schedule manager if a published rota falls below minimums

### 9.3 Certifications and Compliance

- **Certification register** — track certifications per staff member: issue date, expiry date, certificate number, issuing body; document upload
- **Expiry alerts** — auto-reminder to staff member and manager at 60, 30, and 7 days before a certification expires
- **Required certification enforcement** — flag tasks that require a specific certification; system warns if a task is assigned to a staff member who lacks the required certificate

---

## 10. Communications & Notifications

### 10.1 Bulk Email and SMS

- **Recipient targeting** — send to: all berth holders, seasonal holders only, transient visitors currently on site, custom segment, specific tags, hand-picked individuals
- **Compose and send** — rich-text editor with marina-branded header and footer; support inline images and hyperlinks; preview before sending
- **Email delivery** — sent via SendGrid (or configured SMTP provider); delivery, open, and click tracking per message
- **SMS delivery** — sent via Twilio or equivalent; delivery status tracked; supports two-way replies
- **Message templates** — save reusable templates for common communications: seasonal renewal invitation, payment reminder, document request, weather/storm alert, upcoming event announcement, haul-out reminder
- **Scheduled sends** — schedule a message to send at a future date and time
- **Communication log** — every message sent is logged with: date/time, sender, channel, subject, recipient list, delivery stats; accessible from the member record and from a central communications history

### 10.2 Automated System Notifications

System-triggered notifications that fire automatically based on business rules:

- **Booking confirmation** — sent to customer on booking creation (email + optional SMS)
- **Arrival reminder** — sent 24 hours before check-in with berth number, gate code, and marina directions
- **Departure reminder** — sent the morning of check-out with checkout instructions and invoice preview
- **Payment due reminder** — 3, 7, and 14 days before invoice due date (configurable)
- **Overdue payment alerts** — at intervals after due date; escalating in tone per template
- **Document expiry reminders** — at 60, 30, and 7 days before expiry
- **Insurance expiry warning** — specific workflow for insurance with stricter follow-up
- **Haul-out reminder** — 48 hours before a scheduled haul-out
- **Seasonal berth renewal** — configurable number of weeks before the season end date
- **Wait list notification** — when a suitable berth becomes available for a member on the wait list
- **Booking cancellation confirmation** — sent to customer with any applicable refund details

### 10.3 In-App Notifications and Alerts

- **Notification centre** — bell icon in the top bar; dropdown shows unread notifications with timestamps; notifications link directly to the relevant record
- **Alert types** — overdue payment, insurance expired, document missing, critical defect logged, incident created, new booking pending confirmation, AIS-detected arrival of an expected vessel, weather forecast breach, overstay detected
- **Push notifications** — browser push notifications for critical alerts (requires staff opt-in); mobile app push notifications for the DocksBase staff app
- **Alert digest** — daily 08:00 email to harbour masters listing all active alerts across all categories

### 10.4 Newsletter and Marketing Communications

- **Newsletter builder** — drag-and-drop email builder with marina-branded templates; sections for featured events, seasonal offers, facilities news, local area highlights
- **Unsubscribe management** — all marketing emails include a one-click unsubscribe link; unsubscribed contacts are excluded from future marketing sends but still receive transactional notifications
- **Marketing vs transactional** — system clearly distinguishes marketing communications (consent required) from transactional communications (no consent required)

---

## 11. Analytics & Reporting

### 11.1 Operational Dashboard

The Overview screen extended to include:

- **Live occupancy gauge** — real-time percentage of berths occupied vs total with a visual ring chart; breakdown by pier
- **Arrivals and departures timeline** — today's expected arrivals and departures listed chronologically; dock master can tick off actual arrivals and departures as they happen
- **Revenue today** — running total of revenue recorded today across all departments: berths, fuel, utilities, F&B, yard
- **Open tasks** — count of open tasks by priority; click to go to the task board
- **Urgent alerts panel** — insurance expired, overdue payments, critical defects, overstays; count per category with direct links

### 11.2 Berth and Occupancy Reports

- **Occupancy rate report** — percentage occupancy by day, week, month, season, or year; charts and data table; filterable by pier, berth category, vessel type; comparable to prior period
- **Berth utilisation league table** — rank berths from highest to lowest utilisation over a selected period
- **Average length of stay** — by booking type, vessel type, month; trend over time
- **Arrival and departure volumes** — total check-ins and check-outs by day of week, month, season; used for staffing planning
- **Wait list demand report** — number of wait list applications by berth category over time; informs decisions about expanding capacity

### 11.3 Financial Reports

- **Revenue summary** — total revenue by department by day/week/month/year; year-on-year comparison; chart and table
- **Invoice ageing report** — exportable; includes write-offs and credit notes
- **Cash vs card vs bank transfer split** — breakdown of payment method by period
- **VAT report** — totals by tax rate for any period; formatted for HMRC (UK) or equivalent submission
- **Top customers by revenue** — list of members ranked by total spend in a period
- **Seasonal revenue comparison** — month-by-month revenue heat map comparing years
- **Department P&L** — configurable departmental profitability report combining revenue and cost per department

### 11.4 Boatyard Reports

- **Haul-out throughput** — total number of lifts and splashes per week/month/year; by equipment; crane utilisation percentage
- **Average time on the hard** — mean duration between haul-out and relaunch; trend over time
- **Yard revenue** — total yard services revenue by service type for any period
- **Work order completion rate** — completed vs open work orders; average time to completion; by team

### 11.5 Compliance and Safety Reports

- **Document compliance report** — percentage of active members with all required documents on file and valid; flagged exceptions
- **Insurance compliance report** — list of all vessels with expired or missing insurance; sorted by severity
- **Incident trend report** — incidents by type, severity, and location over time; useful for safety committee reporting
- **Maintenance overdue report** — all assets with overdue planned maintenance; sorted by days overdue

### 11.6 Export and Integration

- **Export to CSV/Excel** — every report has a one-click export with column headers and date-stamped filename
- **Export to PDF** — formatted PDF version of any report, branded with marina name and logo; suitable for management meetings or regulatory submission
- **Scheduled report delivery** — configure any report to be generated and emailed automatically on a schedule (e.g. weekly revenue summary every Monday at 07:00)
- **API access to report data** — authenticated REST API endpoints returning report data as JSON for integration with third-party BI tools

---

## 12. Restaurant & Food and Beverage

### 12.1 Table and Floor Plan Management

- **Floor plan editor** — drag-and-drop editor to define the restaurant layout: draw tables (round, square, rectangular), assign table numbers, set table capacity, define sections (terrace, main dining room, bar, private dining room); layout saved as JSON and rendered as a visual floor map
- **Table status board** — real-time view of the restaurant floor plan showing each table's current status: available, occupied (with party size and time seated), reserved (upcoming booking), reserved in X minutes, requires cleaning
- **Section assignment** — assign sections of the restaurant to specific waiting staff; section assignment updates the floor map display

### 12.2 Restaurant Reservations

- **Reservation creation** — date, time, party size, table preference, special requirements (dietary restrictions, wheelchair access, high chair, celebration note), customer name, phone/email
- **Table assignment** — auto-suggest available table(s) that fit the party size; staff can override; system prevents double-booking of the same table
- **Reservation status** — confirmed → seated → completed → no-show → cancelled
- **Walk-in management** — add a walk-in party to the floor plan without creating a reservation; assign to any available table
- **No-show tracking** — mark a reservation as no-show after a configurable grace period; no-shows are logged against the customer contact record
- **Reservation widget** — an embeddable booking widget for the marina's public website allowing customers to book a table online

### 12.3 Menu Management

- **Menu builder** — create and manage menus: name (Lunch, Dinner, Sunday Brunch, Bar Menu, Specials Board, Kids), active date range, availability days of week
- **Menu item record** — item name, description, price, category/section (starters, mains, desserts, sides, beverages, cocktails), allergen flags (14 major allergens per EU/UK regulations), dietary tags (vegan, vegetarian, gluten-free, halal, kosher), photo, preparation time estimate, cost price for margin tracking
- **Modifier system** — attach modifiers to items: cooking preference, sauce choice, add-ons; each modifier option can have a price uplift
- **Menu activation** — set a menu as active for specific service periods (lunch 12:00–15:00, dinner 18:00–22:00); only the active menu is shown on the POS at the relevant time
- **Specials board** — quick-add daily specials without editing the full menu; specials appear at the top of the active menu on the POS and can be marked as sold out instantly

### 12.4 Order Management and Kitchen Display

- **Table-side ordering (waiter POS)** — waiter selects a table and items from the active menu on a tablet or handheld device; items sent to the kitchen display system (KDS) on confirmation; covers can be tracked per seat for splitting
- **Kitchen Display System (KDS)** — orders appear on a web-based kitchen display screen running on any display; each order card shows: table number, cover count, ordered items in sequence, time since order was placed; items turn amber if prep time is exceeded, red if significantly delayed
- **Order status** — sent to kitchen → acknowledged → in preparation → ready for service; waiter is notified on their device when the order is ready
- **Course firing** — waiter can send courses individually ("fire starters now, hold mains"); course sequence visible on KDS
- **Order modification** — waiter can add, remove, or amend items on a live order before it reaches "in preparation" status; changes after that require manager override with a reason
- **Void and comps** — void an item with a reason (ordered in error, complaint, comp for inconvenience); voided items are removed from the bill and logged for waste/comp reporting; manager authorisation required above configurable threshold

### 12.5 Restaurant Point of Sale and Billing

- **Bill management** — generate a bill for any table showing all ordered items, modifiers, quantity, unit price, and total; VAT calculated at the applicable food/drink rate per item
- **Split bills** — split a table's bill by seat, by item, evenly by number of people, or as any custom split; each split generates its own receipt
- **Discounts and vouchers** — apply a percentage or fixed discount to a bill; discount reason and authorising staff are logged
- **Payment methods** — cash, chip & PIN (Stripe Terminal), contactless, marina account (charge to a member's marina account for settlement on their berth invoice), gift voucher
- **Charge to marina account** — if the diner is a known marina member, they can charge the restaurant bill to their marina account; the amount is added as a line item on their next berth invoice
- **Receipt printing** — thermal receipt with item breakdown, VAT summary, payment method, table number, date and time
- **Restaurant invoices** — for private dining or event bookings paid on account, generate a formal invoice in the same format as marina invoices

### 12.6 Restaurant and Marina Integration

- **Boat-to-table** — when a marina guest makes a berth reservation, offer them a restaurant table as an optional add-on during the booking wizard; the restaurant reservation is linked to the marina booking for reporting
- **Welcome arrangement** — flag marina VIP arrivals in the restaurant reservation system; relevant note visible to the restaurant host

### 12.7 Stock and Inventory (Food and Beverage)

- **Ingredient/product register** — item name, unit of measure, category, supplier, par level (minimum stock quantity), current stock quantity, unit cost, shelf life
- **Stock intake** — log deliveries from suppliers; update stock quantities; record delivery note number and supplier invoice number
- **Recipe costing** — attach a recipe to each menu item defining ingredient quantities per portion; system calculates theoretical gross profit margin per item
- **Waste logging** — record food waste by item and reason (spoilage, over-production, void); waste report shows total cost of waste by period
- **Low-stock alerts** — trigger a notification when any ingredient falls below par level; generate a suggested purchase order for items below par

---

## 13. Events & Venue Hire

### 13.1 Event Management

- **Event record** — event name, type (yacht race, regatta, boat show, private party, corporate function, charity fundraiser, club meeting, public market, seasonal festival), date(s) and times, location (marina grounds, specific pontoon, car park, restaurant, private dining room, event marquee), organiser contact, expected attendance
- **Event status** — inquiry → proposal sent → confirmed → in progress → completed → cancelled
- **Event resource allocation** — block berths for visiting race fleet; reserve parking areas; allocate staff; reserve the restaurant for private dining; book equipment (PA system, projector, power connections, marquee)
- **Multi-day events** — events spanning multiple days (e.g. a regatta weekend) managed as a single record with per-day schedules and resource allocations

### 13.2 Venue Hire

- **Venue inventory** — define hireable spaces within the marina: restaurant private dining room, function room, pontoon area, car park, dockside terrace; each space has: capacity (standing and seated), facilities (AV, catering, power), hourly/daily hire rate, seasonal availability
- **Venue booking** — link venue hire to an event or create a standalone booking; conflict detection prevents double-booking
- **Hire agreement** — generate a PDF venue hire agreement from a configurable template including: venue description, dates and times, capacity terms, cancellation policy, damage deposit amount, total fee and payment schedule; sent for digital signature via the customer portal

### 13.3 Event Booking for Visiting Fleets

- **Fleet registration** — organiser registers a visiting fleet (race, rally, cruise in company); lists participating vessels with name, LOA, beam, draft, flag; system auto-assigns berths from available stock to fit the fleet
- **Fleet check-in** — as individual vessels arrive, dock staff check them in against the fleet list; arrival times recorded
- **Fleet billing** — generate a consolidated invoice for the organising club or a batch of individual invoices per vessel; configurable which model applies per event
- **Fleet communication** — send targeted messages to all vessels participating in a specific event

### 13.4 Event Reporting

- **Event revenue** — total revenue per event across all departments (berths, F&B, venue hire, parking)
- **Event attendance** — actual vs expected attendance; vessel count for regattas
- **Post-event summary** — auto-generated PDF report covering all key metrics; suitable for committee or sponsor reporting

---

## 14. Customer Self-Service Portal & Apps

### 14.1 Customer Web Portal

A branded, mobile-responsive web portal accessible to customers at a marina-configured URL:

- **Account registration and login** — customers create an account linked to their member record; login via email and password with option for magic-link (passwordless) login; optional two-factor authentication
- **Dashboard** — current bookings, upcoming arrivals, outstanding invoices, documents requiring attention
- **Make a booking** — online booking widget: select dates, enter vessel details, view available berths, select rate plan, add extras, pay deposit or full amount by card; confirmation email sent automatically
- **View and manage bookings** — list of all past and future bookings; view booking details; request an extension (subject to availability and staff approval); request a cancellation (subject to cancellation policy)
- **Invoice management** — view all invoices; download PDF; pay outstanding invoices online by card
- **Document upload** — upload required documents; view status of each document (under review, approved, rejected)
- **Vessel profiles** — add, edit, and manage vessel records; update specifications, insurance details, and photos
- **Communications inbox** — view all messages received from the marina; reply to messages
- **Notifications preferences** — configure which notifications are received by email vs SMS vs push notification; opt out of marketing communications
- **Restaurant reservations** — book a table at the marina restaurant from within the portal; view and manage existing table reservations

### 14.2 Customer Mobile App (Boater App)

A native mobile app (iOS and Android) for marina customers:

- **Arrival notification** — tap to notify the marina that you are approaching; estimated ETA entry; dock master receives alert
- **My berth** — view assigned berth number and pier map with visual highlight of their berth; directions from the harbour entrance
- **Active booking details** — current booking summary, check-out date, outstanding balance
- **Pay invoice** — tap to pay outstanding invoices from the app using stored card
- **Fuel request** — request fuel delivery to the berth; specify fuel type and quantity; dock staff receive a notification
- **Report a problem** — submit a defect report (e.g. shore power not working, water tap dripping) with photo; dock staff are notified
- **Marina services** — directory of marina facilities, opening hours, contact numbers, WiFi password
- **Restaurant** — view menu, make a table reservation, view active reservation
- **Weather** — current conditions and 5-day forecast for the marina location
- **Push notifications** — receive arrival reminders, invoice reminders, and marina alerts (storm warning, facility outage, event announcements)

### 14.3 Staff Mobile App

A separate, staff-facing mobile app for dock staff and yard teams:

- **My tasks** — view assigned tasks; mark tasks complete; add completion photos
- **Berth check-in/out** — process arrivals and departures from the dock; scan or manually enter vessel name or booking ID; complete check-in checklist on mobile
- **Berth map** — view the marina map on mobile; tap any berth for current status and vessel details
- **Incident report** — quickly log an incident with photo and voice-to-text description
- **Defect report** — log a defect against an asset from any location; asset QR codes (printed and placed on physical assets) can be scanned to pre-populate the asset field
- **Meter reading entry** — enter electricity and water meter readings from the berth
- **Parts scanning** — scan a part barcode to look up stock levels or issue the part to an open work order
- **Offline-first operation** — the staff app caches the day's work orders, task list, and berth assignments locally; staff can complete tasks, log time, and record readings without a data connection (e.g. in the boatyard or on a remote pontoon); all offline actions sync to the server automatically when connectivity is restored, with conflict detection
- **Push notifications** — critical alerts, new task assignments, and incoming vessel notifications

---

## 15. Security & Access Control

### 15.1 User Roles and Permissions

Role-based access control (RBAC) governs all system features. Predefined roles:

| Role | Access Summary |
|---|---|
| Harbor Master | Full access to all modules |
| Deputy Harbor Master | Full operational access; no system admin or financial export |
| Dock Master | Map, reservations, check-in/out, vessel records, tasks, incidents; no billing admin |
| Finance Officer | Full billing, invoices, and reports; read-only reservations and members |
| Yard Supervisor | Full boatyard, work orders, contractor management, assets; no billing |
| Fuel Dock Operator | Fuel dock POS only |
| Maintenance Technician | Tasks, incidents, defects, and asset records; no financial data |
| Restaurant Manager | All restaurant and F&B modules; read-only marina reservations |
| Chef / Kitchen Staff | KDS display access only |
| Waiting Staff | Table POS and reservation access only |
| Events Coordinator | Events, venue hire, restaurant reservations |
| Office Administrator | Members, communications, documents, invoices; no system config |
| View Only | Read-only dashboard and reports; no transactional access |
| System Administrator | Full access including system configuration, user management, and multi-marina admin |

- **Custom roles** — system administrators can create custom roles with granular permission selection from the permission library
- **Permission audit log** — every permission change, role assignment, and user creation is logged with administrator identity and timestamp

### 15.2 Physical Access Control Integration

- **Gate and barrier control** — integrate with barrier and gate systems via MQTT or proprietary API; remotely open or close gates from the staff web interface or mobile app
- **PIN code management** — generate time-limited PIN codes for customer berth access valid for the duration of the booking; codes are auto-generated on check-in and sent to the customer by SMS/email; expired codes are automatically deactivated
- **Key fob / NFC card management** — issue fobs or contactless access cards linked to a member record; activate, suspend, or revoke access from the member profile; access log shows every card read with timestamp and gate location
- **Contractor access passes** — contractor PINs are time-limited and tied to specific gate zones
- **Access log** — complete log of all gate access events: timestamp, access point, credential used, person/vessel name, success/failure; retained for security and insurance compliance
- **Access zones** — configure multiple access zones (main gate, Pier A, Pier B, boatyard, fuel dock, staff only areas); each credential can be granted access to specific zones only

### 15.3 CCTV Integration

- **Camera registry** — list of all CCTV cameras with location, type (IP/analogue), and IP address
- **Live feed viewer** — view live CCTV feeds within the web interface via WebRTC proxy; recordings stored externally on the marina's NVR system
- **Camera-to-incident linkage** — when logging an incident, staff can reference a specific camera and approximate timestamp; creates a note on the incident record

### 15.4 Authentication and Data Security

- **Authentication** — JWT-based authentication; tokens expire after 8 hours idle; refresh tokens valid for 7 days
- **Two-factor authentication (2FA)** — optional TOTP or SMS OTP for staff accounts; mandatory 2FA for Harbor Master and System Administrator roles
- **Single Sign-On (SSO)** — optional SAML 2.0 / OAuth 2.0 SSO integration for corporate identity providers (Microsoft Entra ID, Google Workspace)
- **Password policy** — minimum 10 characters, mixed case and digit required; breach detection via HaveIBeenPwned API
- **Data encryption** — all data encrypted at rest (AES-256); all data in transit encrypted via TLS 1.3
- **API security** — all REST API endpoints require authentication; rate limiting per IP and per user; CORS policy enforced

---

## 16. Environmental & Compliance

### 16.1 Environmental Management

- **Pump-out station management** — log pump-out events per vessel; track total sewage volumes pumped out and disposal method; required for Blue Flag marinas and harbour authority compliance reports
- **Fuel spill response** — when a fuel spill is reported as an incident, system triggers a specific fuel spill checklist (contain spill, notify harbour authority, record volume, record response actions); generates a timestamped record for regulatory compliance
- **Hazardous materials register** — log hazardous substances stored on marina premises (fuel, antifouling paint, solvents, gas cylinders); quantity, location, storage method, safety data sheet upload; required for fire safety risk assessment and COSHH compliance
- **Carbon/emissions tracking** — optional module to record fuel dispensed by type and calculate estimated CO2 emissions; exportable for sustainability reporting
- **Water quality log** — record periodic water quality test results (pH, clarity, bacteria counts); flag below-standard results; log any pollution events and response actions
- **Antifouling compliance** — record antifouling paint type applied per vessel during haul-outs; flag TBT-containing products (banned in many jurisdictions); compliance report available for harbour authority submission

### 16.2 Regulatory Compliance

- **GDPR / Data Protection** — data retention policies configurable per data type; automated purge of customer data after the configured retention period; right-to-erasure workflow (anonymises all PII while retaining anonymised booking and financial data for accounting); data processing register (Article 30 record) auto-generated from configured data flows
- **AML / Know Your Customer** — for superyacht and high-value seasonal contracts above a configurable threshold, flag the record for KYC documentation (passport copy, proof of source of funds); status tracked in the document vault
- **Harbour authority reporting** — export a monthly vessel traffic report for submission to the relevant harbour or port authority; format configurable per authority
- **Health and safety log** — retain all completed maintenance checklists, risk assessments, and incident reports as a permanent audit trail; cannot be deleted by marina staff (only archived)
- **Port State Control** — for commercial vessels, flag records subject to Port State Control inspection; track inspection history and deficiencies

---

## 17. Integrations

### 17.1 AIS Vessel Tracking

- **AIS data source** — connect to AISHub, MarineTraffic API, or a locally connected VHF AIS receiver; configurable per marina
- **Vessel position overlay** — display AIS targets on the marina map as moving vessel icons with COG (course over ground) and SOG (speed over ground) vectors; colour-coded by vessel type
- **Booking matching** — system attempts to match incoming AIS targets against active reservations by vessel name and MMSI; when a match is found, the booking is updated with an estimated arrival time
- **Arrival prediction** — for matched vessels within a configurable range (e.g. 5 nm), trigger an arrival notification to dock staff: "Nordic Blue (MMSI 235001234) is 3.2nm away, ETA ~20 minutes, booked on A6"
- **Unrecognised vessels** — AIS targets not matched to any booking or member record are flagged as "unknown approaching vessel" if they enter a configurable proximity radius; dock master is alerted
- **AIS position on vessel profile** — if a vessel has an MMSI on record, a live position minimap appears on the vessel profile screen

### 17.2 Weather Integration

- **Weather data source** — OpenWeatherMap API, Yr.no API, or Met Office DataHub API; configurable per marina; location set as the marina's lat/lon
- **Current conditions display** — temperature, apparent temperature, wind speed and direction, gust speed, significant wave height, swell period, visibility, UV index, tide state; shown on the Overview dashboard
- **Forecast** — 5-day forecast shown as a strip on the dashboard; expandable to hourly view
- **Tide times** — calculate or import tide times for the marina location; display today's high and low water times and heights on the dashboard; accessible in the mobile app
- **Storm alert trigger** — configure a wind speed threshold (e.g. 25 knots); when the forecast exceeds the threshold, the system generates a critical alert and can auto-trigger a pre-composed storm warning message to all berth holders
- **Historical weather log** — retain daily weather observations; referenced in incident reports and insurance claims

### 17.3 Payment Gateway

- **Stripe integration** — primary payment processor for online invoice payments (Stripe Checkout), in-person card payments (Stripe Terminal), and POS card payments
- **Stripe Terminal** — pair one or more Stripe Terminal card readers per marina location; payment intent created by DocksBase, captured by the reader
- **Webhook handling** — Stripe sends webhooks for payment success, failure, refund, and dispute events; DocksBase updates invoice statuses in real time
- **Stored payment methods** — with customer consent, store a payment method on file for repeat or automatic billing; customer manages stored cards from the self-service portal
- **3D Secure** — Stripe handles Strong Customer Authentication (SCA) requirements automatically
- **Multi-currency** — configure the marina's billing currency; Stripe handles conversion for international customers

### 17.4 Accounting Software

- **Xero integration** — push invoices, credit notes, and payment records to Xero via OAuth 2.0 API; map DocksBase charge types to Xero account codes; sync contacts between systems; mark invoices as synced
- **QuickBooks integration** — same data flow as Xero, using QuickBooks Online API
- **Export fallback** — for marinas not using Xero or QuickBooks, a CSV export compatible with SAGE and other common accounting packages is available for manual import

### 17.5 Email and SMS Providers

- **Email — SendGrid** — all transactional and marketing emails sent via SendGrid API; bounce, delivery, open, and click events received via webhook and stored against the message log
- **SMS — Twilio** — all SMS messages sent via Twilio Programmable Messaging; delivery receipts stored; two-way SMS supported
- **Alternative providers** — email can be configured to use Mailgun, Postmark, or any SMTP relay; SMS can be configured to use MessageBird or Vonage

### 17.6 Mapping and Navigation

- **Chart overlays** — optionally overlay Navionics or OpenSeaMap chart tiles on the marina map background to show the harbour approach and surrounding waters
- **Google Maps / Mapbox embed** — embed an external map on the customer portal and marina's public website showing the marina location, approach routes, and entrance coordinates

### 17.7 Online Booking Channels

- **Channel manager** — connect berth availability to third-party marina booking platforms (Noforeignland, TheMarinePassage, Navily, MarineTraffic) via published availability API; bookings made on external platforms are imported automatically; channel is recorded on the booking record
- **iCal export** — export individual berth availability calendars as iCal feeds for integration with generic booking tools or calendar applications

### 17.8 FuelCloud Integration

- **FuelCloud** — integrate with FuelCloud fuel management hardware for automated fuel dispensing and billing; FuelCloud tank controllers report dispense events (fuel type, volume, card/vessel ID) directly to DocksBase; dispense events are automatically converted to fuel sale records and posted to the relevant vessel's open invoice without manual staff entry
- **Reconciliation** — FuelCloud-reported dispense totals are used as the authoritative source for the fuel dock reconciliation report; discrepancies between FuelCloud and manual dip readings trigger an alert for investigation

### 17.9 Document Signing

- **Electronic signatures** — seasonal lease agreements, work order authorisations, venue hire agreements, and haul-out consent forms can be sent for electronic signature via DocuSign or HelloSign integration; signed document is stored in the member's document vault automatically

---

## 18. System Administration & Multi-Marina

### 18.1 Marina Configuration

- **Marina profile** — marina name, address, coordinates (lat/lon), harbour authority, VAT/tax registration number, company registration number, bank details (for invoice payment instructions), logo upload, brand colour overrides, contact email, phone, and public website URL
- **Currency and locale** — set billing currency, date format, time zone, language (supports English, French, Spanish, Italian, German, Dutch, Portuguese)
- **VAT / tax configuration** — configure applicable tax rates per charge type and jurisdiction; system applies the correct rate automatically
- **Billing terms** — configure standard payment terms in days (net 7, net 14), late payment fee policy, cancellation and no-show fee policy
- **Rate card configuration** — build and publish rate cards per season; all pricing within the system references the active rate card; historic rate cards are retained for retrospective invoice queries
- **System notifications configuration** — configure which automated notifications are active, which templates they use, and the trigger timing for each
- **Working hours** — set marina operational hours per day of week; used for automated scheduling of communications and for defining shift coverage requirements

### 18.2 Multi-Marina Support

- **Multi-tenancy architecture** — DocksBase supports multiple marina organisations on a single deployment; each marina's data is strictly isolated; user credentials are scoped to one or more specific marinas
- **Marina group accounts** — a marina group (e.g. a chain under one corporate owner) can be created as an organisation containing multiple marinas; group-level reports aggregate data across all marinas
- **Cross-marina member records** — a customer who holds berths at multiple marinas within the same group has a single member record shared across the group; booking and financial history visible across all marinas with appropriate permissions
- **Cross-marina reporting** — group administrators can run consolidated occupancy, revenue, and compliance reports across all marinas in their group
- **System administrator** — a superuser role above the marina level; can create and configure new marina organisations, manage subscriptions, access all data for support purposes

### 18.3 User Management

- **Create and manage staff accounts** — invite staff by email; configure role(s) and marina access; staff set their own password via an invite link
- **Deactivate accounts** — when a staff member leaves, deactivate their account; all historical records created by the user are retained and attributed to them
- **User audit trail** — every create, update, and delete action in the system is logged with the user's identity, timestamp, and before/after state of the changed record; the audit log is read-only and cannot be deleted

### 18.4 System Configuration

- **Feature flags** — enable or disable optional modules per marina (restaurant, events, boater app, AIS, multi-marina); marinas that do not need F&B can hide the restaurant module entirely
- **Custom fields** — add custom fields to member records, vessel records, and bookings; custom fields are included in data exports
- **Webhook outbound** — configure outbound webhooks to notify a marina's own systems when specific events occur in DocksBase (new booking created, invoice paid, incident logged)
- **API keys** — generate API keys for third-party integrations; each key is scoped to a specific marina and a specific set of read/write permissions; keys can be rotated or revoked at any time
- **Backup and restore** — daily automated database backups retained for 30 days; point-in-time restore can be initiated by a system administrator; marina-level full data export (JSON dump) available on request

### 18.5 Subscription and Licensing

- **Subscription tiers:**
  - **Starter** — single marina, up to 50 berths, core modules (map, reservations, billing, members, maintenance)
  - **Professional** — single marina, unlimited berths, all modules including restaurant, events, and apps
  - **Enterprise** — multi-marina, group reporting, dedicated support, custom integrations, SLA guarantee
- **Usage-based billing add-ons** — SMS messages and email sends above the included monthly allowance are billed per unit; AIS data feeds and electronic signature integrations are optional paid add-ons
- **Trial period** — new marina operators can access a fully featured trial environment for 30 days with sample data pre-loaded; conversion to a paid subscription activates the live environment

---

---

## 19. Boat Sales & Brokerage

### 19.1 Sales Inventory

- **For-sale vessel listings** — maintain a catalogue of boats for sale at the marina: new inventory (dealer stock), brokerage listings (owner's boat sold on commission), and trade-in vessels; each listing has: vessel details (from the vessel registry or manually entered), asking price, listing status (active, under offer, sold, withdrawn), listing date, key selling points, and a photo gallery
- **Condition and survey records** — attach pre-purchase survey reports, sea trial notes, and condition assessments to a listing; visible to the sales team when showing the boat to prospects
- **Valuation tracking** — record successive valuations or price reductions over time; pricing history chart shows how the asking price has moved; useful for brokerage negotiations
- **Listing publication** — export listing details and photos to the marina's public website or to third-party boat sales portals (e.g. Boats.com, YachtWorld, Apollo Duck); listings are updated automatically when the price or status changes in DocksBase

### 19.2 Lead and Prospect Management

- **Lead capture** — log enquiries from walk-ins, phone calls, website contact forms, and third-party portal leads; each lead records: prospect name and contact details, vessel of interest, budget range, intended use, financing interest (yes/no), source channel
- **Lead status pipeline** — new enquiry → contacted → viewing scheduled → viewing completed → offer made → under offer → survey commissioned → sale agreed → completed; pipeline displayed as a Kanban board per sales person or across the team
- **Activity log** — log every touchpoint against a lead: phone call (with notes), email sent, viewing appointment, test sail/sea trial, offer letter sent; activity history is visible to the whole sales team to ensure continuity if a lead is handed over
- **Follow-up reminders** — set a follow-up reminder on any lead; reminder appears in the salesperson's task list and is sent as an email/push notification on the due date
- **Lead source reporting** — track which channels generate the most leads and the most completed sales; cost-per-sale calculation if marketing spend per channel is entered

### 19.3 Sales Contracts and Documentation

- **Sales contract generation** — generate a marine sales agreement from a configurable template populated with: vessel details, agreed sale price, deposit amount and due date, balance due date, conditions (subject to survey, subject to sea trial, subject to finance), warranty terms, and details of any included or excluded items; contract is sent for electronic signature via DocuSign/HelloSign
- **Deposit and balance tracking** — record receipt of the deposit and the balance payment; link payments to the relevant invoice; automatically update the listing status to "sold" when the balance is received
- **Trade-in handling** — when a buyer trades in a vessel as part of the transaction: create a trade-in record with the agreed trade-in value, vessel details, and condition notes; the trade-in value is applied as a credit against the purchase price; the traded-in vessel is added to the for-sale inventory automatically
- **Bill of sale** — generate a final bill of sale document on completion of the transaction; the document records transfer of title, payment summary, and any outstanding warranties; stored in the buyer's document vault

### 19.4 Finance & Insurance (F&I)

- **Finance referral tracking** — record whether the buyer is using finance and which provider; track the finance application status (pending, approved, declined); completion of the sale is blocked until finance approval is confirmed if the sale is conditional on finance
- **Commission management** — configure commission rates for: internal sales staff (percentage of sale price or fixed fee), external brokers (percentage of sale price); commission is calculated automatically on sale completion and generates an internal payment record for payroll or contractor invoice matching
- **F&I product tracking** — record any additional finance and insurance products sold alongside the vessel: extended warranty, marine insurance policy, gap insurance, payment protection; each product is recorded with the provider, premium, and commission earned

### 19.5 Brokerage Agreements

- **Central agency agreement** — record the terms of the brokerage agreement with the boat owner: asking price, commission percentage, agreement start and end date, sole agency or open listing, marketing expenses to be deducted, minimum acceptable offer (confidential field)
- **Owner disbursement** — on sale completion, the system calculates: gross sale price minus commission minus any deductible marketing expenses = net proceeds to owner; generate an owner disbursement statement and record the payment
- **Brokerage listing portal** — brokerage listings can be published to the marina's public-facing website with a dedicated brokerage section; owners can log into the customer portal to see their listing status, enquiry count, and any offers received

### 19.6 Sales Reporting

- **Sales pipeline value** — total value of all active listings and leads at each stage of the pipeline; forecast revenue from deals in the under-offer and sale-agreed stages
- **Sales performance report** — completed sales by salesperson, by month, by vessel type, by price band; conversion rate from lead to sale; average days-on-market per listing
- **Commission report** — total commissions earned by staff and external brokers for any period; filtered by salesperson or broker
- **Trade-in and inventory report** — current inventory on hand at cost and at asking price; days on market per listing; ageing inventory flags (listings unsold after a configurable number of days)

---

## 20. Native eSignature Workflows

*Identified via Dockmaster competitive analysis. Currently DocksBase references DocuSign/HelloSign as third-party integrations (17.9). A native eSignature module reduces per-signature costs, eliminates external API dependency, and allows tighter integration with billing and member records.*

### 20.1 Document Template Library

- **Marine-specific templates** — pre-built templates for the most common marina documents: seasonal slip rental agreement, transient dockage waiver, haul-out consent and liability form, work order authorisation, vessel storage contract, venue hire agreement, marina rules acceptance, emergency contact registration
- **Template builder** — upload an existing PDF and use the template builder to add interactive fields: signature, initials, date, free text, checkbox, dropdown; field positions are dragged onto the document and locked to page coordinates
- **PDF Page Assembler** — combine multiple PDFs into a single signing document by dragging pages into the desired order; signature field positions remap automatically when pages are reordered; useful for marina rules booklet + lease agreement + GDPR consent bundled into a single envelope
- **Conditional logic** — show or hide form fields based on answers to other fields (e.g. show the live-aboard addendum page only if the "live-aboard" checkbox is ticked)
- **Template versioning** — each template is versioned; existing signed documents always reference the version active at the time of signing; new versions do not invalidate historical records
- **Template categories** — Marina Operations, Boatyard, Sales & Brokerage, Events & Venue, Finance

### 20.2 Sending and Signing

- **Single recipient envelope** — send a document to one signer; options: email link, SMS link, or QR code displayed on a marina tablet for in-person signing
- **Multi-party signing** — define a signing order for documents requiring multiple parties (e.g. owner authorises a large work order before the yard supervisor countersigns); each party receives the document only after the previous party has signed
- **No-authentication signing** — transient customers and visiting boaters can sign documents without creating a portal account; the signing link is valid for a configurable time window (24–72 hours); no password or account required; designed for waivers, dockage agreements, and emergency contact forms completed at the fuel dock or dock master office
- **In-person signing** — dock staff can complete a signing session face-to-face on a marina tablet; the document is loaded in a clean kiosk view; customer signs with a finger or stylus; staff witness field captured automatically
- **Required attachments** — configure any template to require the signer to attach specific file types before the envelope is considered complete (e.g. "attach your current insurance certificate as PDF or JPG"); file type and size validation applied; attachments stored in the member's document vault on completion

### 20.3 Tracking and Notifications

- **Envelope status dashboard** — central view of all envelopes: draft, sent, partially signed, completed, expired, voided; filterable by template type, date sent, member, and status
- **Real-time status** — track whether each recipient has: received the email, opened the document, completed all fields, submitted; timestamp per status change
- **Automated reminders** — system sends a reminder email at configurable intervals (e.g. 24 h, 48 h, 7 days) for envelopes not yet completed; reminder count and last reminder date shown on the envelope record
- **Mass distribution** — send a document to multiple recipients in a single operation: select a saved member segment (e.g. "All seasonal berth holders") and choose a template; a separate envelope is created per recipient; useful for annual marina rules acknowledgements or policy updates; delivery and completion tracked per individual
- **Expiry and voiding** — envelopes expire after a configurable number of days if unsigned; expired envelopes are marked as such and a new one can be sent with one click; staff can manually void any envelope at any time with a reason note

### 20.4 Completed Document Management

- **Automatic archival** — completed envelopes are stored immediately in the relevant member's document vault under the appropriate document category; the signed PDF is generated server-side with a tamper-evident audit trail embedded in the PDF metadata
- **Audit certificate** — each completed envelope generates an audit certificate recording: all signer IP addresses and geolocations, timestamps for every action (opened, signed, submitted), email delivery confirmations; stored alongside the signed document
- **Integration with billing** — for documents that trigger a financial action (e.g. seasonal lease agreement → generate a seasonal berth invoice; work order authorisation → set WO status to "authorised"), the completion of the envelope automatically triggers the linked action in the billing or boatyard module
- **GDPR compliance** — completed envelopes containing personal data are subject to the same data retention policies as other member records; right-to-erasure requests anonymise the signer's personal fields while preserving the document structure for accounting audit trails

---

## 21. Tool & Equipment Management

*Identified via Dockmaster competitive analysis. Currently absent from DocksBase. Boatyards and service centres need to track portable tools and equipment assigned to technicians and work orders, separate from fixed capital assets (cranes, panels) tracked in Module 8.*

### 21.1 Tool Register

- **Tool record** — tool ID (auto-generated or barcode), name, category (hand tool, power tool, diagnostic equipment, specialised marine tool, PPE, lifting gear), make, model, serial number, purchase date, purchase cost, current location (storage rack, workshop bay, or assigned to technician), condition (excellent / good / requires service / out of service)
- **Tool photo** — attach a photo per tool for identification and condition reference
- **Calibration and service tracking** — for tools requiring periodic calibration or PAT testing (e.g. torque wrenches, electrical testers), record the calibration date, next due date, and certificate reference; alert when calibration is due
- **Tool categories requiring certification** — flag tools that can only be operated by staff with a specific certification (e.g. forklift, cherry picker, oxygen-acetylene); system warns if the tool is checked out to a staff member without the required cert

### 21.2 Checkout and Return

- **Tool checkout** — assign a tool to a specific technician and optionally to a specific work order; record checkout date and time and expected return date; a tool cannot be checked out to two people simultaneously
- **Checkout log** — complete history of every checkout and return per tool: who had it, when, which work order, returned on time or late, condition on return
- **Work order tool list** — view all tools currently checked out against a work order; check all tools back in when the job is complete
- **Overdue returns** — tools not returned by the expected return date are flagged; the assigned technician receives a reminder; the tool register highlights overdue items
- **Mobile scan-out** — from the staff mobile app, technicians scan a tool's barcode to check it out or return it; no desk visit required
- **Damage report** — when returning a tool, the technician can flag a condition change; this creates a defect record against the tool and removes it from service pending inspection

### 21.3 Utilisation and Reporting

- **Tool utilisation report** — percentage of time each tool is in use vs. available over a selected period; identifies under-used tools (candidate for disposal) and over-used tools (candidate for additional stock)
- **Tool availability view** — at-a-glance board showing all tools in a category: available (green), checked out (blue with technician name), out of service (red); useful for workshop supervisors planning the day
- **Cost per use** — tracks approximate cost-per-job contribution of tools based on purchase cost and total uses; useful for job costing accuracy
- **Lost and stolen log** — record tools as lost or stolen with a date and circumstances; contributes to insurance claims and purchasing decisions

---

## 22. Dry Stack Launch Queue

*Identified via Dockmaster competitive analysis (Launch Master module). DocksBase already has a Haul-out Schedule (Module 6.1) for travelift bookings, but dry stack marinas need a separate customer-facing "launch request" queue where boat owners can request that their vessel be launched on a given day without staff needing to manually coordinate every call. This module applies primarily to marinas operating a dry stack facility or forklift-served launch ramp.*

### 22.1 Launch Request System

- **Customer launch request** — from the customer portal or boater app, an owner requests a launch for their dry-stored vessel: preferred launch date, preferred time window (morning/afternoon/specific time), duration of use (half-day/full day/multi-day/indefinite), return-to-stack requested (yes/no, with return date and time)
- **Request cut-off time** — configure a cut-off time by which requests must be submitted for next-day launching (e.g. requests must be in by 17:00 the day before); requests after cut-off are queued for the following day
- **Automated customer notification** — on request receipt, system sends a confirmation with the request details and an estimated launch window based on current queue depth; when the vessel is launched and in the water, a push notification is sent to the owner: "Your vessel [Name] is in the water and ready at berth [X]"
- **Priority handling** — requests from premium or annual storage contract holders can be configured to receive a priority slot; priority queue visible separately from standard queue

### 22.2 Launch Queue Management

- **Day view queue** — dock staff see a chronological queue of all launch and retrieval requests for the day: vessel name, position in yard, owner contact, requested time, equipment required (forklift vs. crane), estimated duration
- **Status tracking** — each queue entry progresses through: pending → scheduled (equipment and staff assigned) → launching → in water → retrieval scheduled → retrieved → stored; each status change is time-stamped
- **Equipment and staff assignment** — assign the forklift operator or crane driver and the equipment to each launch; conflict detection prevents double-assigning equipment; staff see their assignments in the mobile app
- **Yard position recall** — when a launch is scheduled, the system displays the vessel's current yard grid position (from Module 6.2) so the forklift driver knows exactly where to find it; obstructed position warning shown if other vessels need to be moved first
- **Weather hold** — a single "weather hold" toggle pauses all pending launches for the day and sends an automated notification to all affected customers; hold can be lifted and the queue resumes when conditions permit

### 22.3 Launch Billing

- **Launch fee** — configurable launch fee per event (single launch, launch + retrieval, day rate for in-water storage); fee is added to the vessel's open invoice or generates a new invoice if no active booking exists
- **Multi-launch packages** — sell block launch packages (e.g. 10 launches for a discounted flat rate); package balance tracked against the member's account; each launch deducts from the balance; low-balance alert sent when fewer than 2 launches remain
- **Daily launch summary** — end-of-day report showing total launches, total retrievals, revenue, equipment utilisation, and average wait time from request to launch; comparable to prior week and prior year

---

## 23. Linear Dockage & Partial Slip Management

*Identified via Dockmaster competitive analysis. Relevant to marinas with alongside berths, fuel docks, hammerhead pontoons, and linear quays where a single long berth can accommodate multiple smaller vessels simultaneously. The standard slip management model (one booking per slip) does not work for these configurations.*

### 23.1 Linear Berth Configuration

- **Linear berth definition** — designate a berth as "linear" when creating it in the Map Builder; set total length (e.g. 40 m) and minimum and maximum vessel size
- **Segmentation** — a linear berth can be divided into segments dynamically: when booking a vessel, the system checks what portion of the total length is occupied and what remains available; vessels are booked against a named segment (e.g. "Quay B — Position 1") rather than the whole berth
- **Display on map** — linear berths are rendered as a long rectangle on the marina map; each segment's occupancy is shown as a coloured block within the rectangle; hovering over a block shows the vessel and booking details

### 23.2 Partial Slip Booking

- **Partial booking** — when creating a booking for a linear berth, staff enter the vessel's LOA; the system checks whether the remaining unoccupied length is sufficient and suggests a position within the berth; multiple vessels can share the same linear berth simultaneously
- **Conflict detection** — the system prevents partial bookings that would leave a gap too small for any remaining vessel traffic or that would violate the minimum passing clearance configured per berth
- **Fuel dock mode** — the fuel dock is a special case of linear berth: vessels queue at the fuel pontoon, are served, and depart without overnight booking; the system manages a real-time queue showing vessels present, vessels waiting, and estimated service time; fuel charges are attached to the vessel's account automatically on departure

### 23.3 Security Deposits for Wait Lists

*Addition to Module 1.2 (Berth Wait List). Dockmaster specifically calls out security deposit collection as part of wait list management.*

- **Wait list deposit** — when a member joins the wait list for a seasonal or annual berth, collect a configurable refundable security deposit (e.g. £500) to confirm the applicant's serious intent; deposit is held against the member's account
- **Deposit refund on withdrawal** — if the applicant withdraws from the wait list before being allocated a berth, the deposit is refunded in full (or partially, subject to configurable terms); if they decline an offered berth without valid reason, the deposit is forfeit
- **Deposit applied on allocation** — when the member is allocated a berth, the held deposit is applied against the first season's invoice; no additional payment is requested for the deposit amount already held
- **Deposit ledger** — all held wait list deposits are visible in the accounts module as a liability (money owed to customers); included in financial reports separately from revenue

---

## Additions to Module 17 — Integrations

*The following integrations were identified via Dockmaster competitive analysis and are added to supplement Module 17.*

### 17.10 PartSmart Digital Parts Catalog

- **PartSmart integration** — connect to the ARI PartSmart parts catalog database; technicians can search for parts by model name, model attributes, part number, or description directly within a work order without switching to an external catalog
- **Pick list generation** — from a search result, add parts to a pick list linked to the work order; pick list is converted to a parts issue or special order in the inventory module
- **Automated price lookup** — PartSmart returns current trade pricing from configured supplier accounts; prices imported directly into the work order line items
- **Part number cross-referencing** — look up OEM part numbers and find compatible aftermarket alternatives; alternative part numbers visible alongside the OEM reference

### 17.11 BoatCloud Integration

- **BoatCloud** — third-party dry stack and marina reservation management platform; connect BoatCloud's customer-facing reservation API to DocksBase so that bookings made through BoatCloud appear in the DocksBase reservation list automatically; availability published to BoatCloud updates in real time when berths are booked or released in DocksBase
- **Concierge service sync** — BoatCloud's mobile concierge features (customer requests for vessel wash-down, fuel pre-order, ice delivery) generate notifications in the DocksBase task board

### 17.12 SpeedyDock Integration

- **SpeedyDock** — mobile app for dry stack marina customers to request launches and manage their vessel; when a customer submits a launch request through the SpeedyDock app, the request appears in DocksBase's Launch Queue (Module 22); launch status updates made by dock staff in DocksBase are reflected in the SpeedyDock app in real time; customers receive push notifications through SpeedyDock when their vessel is ready

### 17.13 MarineSync Automated Meter Readings

- **MarineSync** — hardware and software system for automated utility meter reading at marina berths; connect to the MarineSync API to pull electricity and water meter readings automatically at configurable intervals without manual staff entry; readings populate the utility meter records in Module 7 and generate anomaly alerts when usage deviates significantly from average
- **Usage analytics** — MarineSync provides per-berth consumption trend data; this data is surfaced in the Utility Reports section of Module 11

### 17.14 Supreme BI Reporting Integration

- **Supreme BI** — third-party business intelligence and data visualisation platform designed for the marine industry; DocksBase can push summarised revenue, occupancy, and operational data to Supreme BI via a scheduled data export or API connection; Supreme BI generates advanced cross-marina dashboards, trend analysis, and forecast reports beyond the built-in reporting module

### 17.15 Kenect Messaging Platform

- **Kenect** — business texting and messaging platform; integrate Kenect as an additional channel for customer communications; two-way SMS conversations between marina staff and customers are managed within the Kenect interface but logged in the DocksBase communications history against the member record; Kenect handles opt-in compliance, delivery receipts, and response routing

### 17.16 DealerSpike Website Integration

- **DealerSpike** — website platform and digital marketing tools for marine dealers; if the marina operates a boat sales division, the DocksBase Boat Sales module (Module 19) can push active listings to a DealerSpike-powered public website; new leads captured through the DealerSpike website contact forms and listing enquiry forms are imported into the DocksBase Lead Management pipeline automatically

### 17.17 CoreLogic Credco Credit Reporting

- **Credco** — credit and lending information service; for marinas and dealers processing boat finance applications (Module 19.4), integrate Credco to request a credit report for a finance applicant directly from within the sales deal record; credit report summary is attached to the lead record for the finance manager's review

### 17.18 TeamMarine CRM Integration

- **TeamMarine** — Salesforce-based CRM customised for the marine industry; for marina groups with an existing Salesforce CRM deployment, connect DocksBase customer and lead data to TeamMarine; new member registrations and sales leads created in DocksBase are synced to TeamMarine; CRM activity (call logs, email campaigns, opportunity stages) is mirrored back to the DocksBase communications history

---

---

*End of DocksBase Feature Specification v1.2*
