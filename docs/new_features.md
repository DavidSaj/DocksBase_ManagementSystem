# DocksBase — Comprehensive Feature Expansion

**Document version:** 1.0
**Date:** 2026-05-07
**Status:** Roadmap / Backlog
**Source:** Competitive analysis — DockMaster, Dockwa, Molo/Storable Marine, Harbour Assist, Havenstar, Marina Master, EliteMarinas, MARINAGO/Scribble, BiT Marine, PierVantage, SpeedyDock, StackTrack, Harba, Successful Marine, Maxxton, ClearWater MMS, Marinapy, Clubessential, Marina Match and others.

> **How to read this document:** Features already specified in `features.md` are not repeated here. This document captures every capability found across the competitive landscape that is absent from or only partially covered by the existing spec. Sections reference the corresponding `features.md` module numbers where a partial spec already exists.

---

## Table of Contents

1. [Revenue Management & Yield Optimisation](#1-revenue-management--yield-optimisation)
2. [Reservations — Additional Capabilities](#2-reservations--additional-capabilities)
3. [Berth & Slip Management — Additional Capabilities](#3-berth--slip-management--additional-capabilities)
4. [Vessel Management — Additional Capabilities](#4-vessel-management--additional-capabilities)
5. [Customer & Member Management — Additional Capabilities](#5-customer--member-management--additional-capabilities)
6. [Loyalty Programme](#6-loyalty-programme)
7. [Financial Management — Additional Capabilities](#7-financial-management--additional-capabilities)
8. [Boatyard — Additional Capabilities](#8-boatyard--additional-capabilities)
9. [Inventory & Parts — Additional Capabilities](#9-inventory--parts--additional-capabilities)
10. [Utility Management — Additional Capabilities](#10-utility-management--additional-capabilities)
11. [Dry Stack & Launch Queue — Additional Capabilities](#11-dry-stack--launch-queue--additional-capabilities)
12. [Maintenance — Additional Capabilities](#12-maintenance--additional-capabilities)
13. [Staff Management — Additional Capabilities](#13-staff-management--additional-capabilities)
14. [Communications — Additional Capabilities](#14-communications--additional-capabilities)
15. [Analytics & Reporting — Additional Capabilities](#15-analytics--reporting--additional-capabilities)
16. [Restaurant & F&B — Additional Capabilities](#16-restaurant--fb--additional-capabilities)
17. [Events & Venue Hire — Additional Capabilities](#17-events--venue-hire--additional-capabilities)
18. [Activities & Experience Booking (New Module)](#18-activities--experience-booking-new-module)
19. [Charter & Boat Hire Management (New Module)](#19-charter--boat-hire-management-new-module)
20. [Housekeeping (New Module)](#20-housekeeping-new-module)
21. [Tenants & Commercial Lettings (New Module)](#21-tenants--commercial-lettings-new-module)
22. [Berth Marketplace & Sub-let (New Module)](#22-berth-marketplace--sub-let-new-module)
23. [Self-Service & Customer Apps — Additional Capabilities](#23-self-service--customer-apps--additional-capabilities)
24. [Security & Physical Access Control — Additional Capabilities](#24-security--physical-access-control--additional-capabilities)
25. [Environmental, Sustainability & ESG (New Module)](#25-environmental-sustainability--esg-new-module)
26. [Accounting Back-Office — Additional Capabilities](#26-accounting-back-office--additional-capabilities)
27. [Boat Sales & Brokerage — Additional Capabilities](#27-boat-sales--brokerage--additional-capabilities)
28. [Website, Digital Marketing & OTA Distribution (New Module)](#28-website-digital-marketing--ota-distribution-new-module)
29. [Commercial Harbour Management (New Module)](#29-commercial-harbour-management-new-module)
30. [Boater Network & Marketplace Integration](#30-boater-network--marketplace-integration)
31. [Integrations — Additional](#31-integrations--additional)

---

## 1. Revenue Management & Yield Optimisation

*Currently absent from `features.md`. Every major hotel-adjacent marina platform now has a revenue management layer.*

### 1.1 Demand-Based Pricing Engine

- **Occupancy-based yield rules** — define trigger thresholds (e.g. when occupancy exceeds 80%, automatically apply a 15% rate uplift on remaining available berths); rules apply per berth category, season, and booking type
- **Dynamic rate floors and ceilings** — set a minimum and maximum price per metre per night to prevent the yield engine from pricing below cost or above market; the engine only operates within the configured band
- **Competitor price benchmarking** — manually enter observed competitor rates by season; system flags when DocksBase pricing is significantly above or below the benchmark
- **Last-minute discount automation** — if a berth remains unbooked within a configurable window before the stay date (e.g. 72 hours), automatically apply a configurable discount; boaters on the wait list are notified first
- **Gap-fill promotions** — identify short unoccupied windows between bookings (e.g. 2–3 night gaps) and automatically offer a targeted promotional rate to close the gap; promotion sent to the wait list, customer app, or channel partners
- **Early-bird pricing** — apply a configurable discount for bookings made more than a defined number of days in advance; encourages advance commitment

### 1.2 Pacing & Forecasting Reports

- **Pacing report** — compares current confirmed booking volume (by berth category and revenue) for any future period against the same period last year at the same point in the booking cycle; enables proactive rate adjustment before occupancy slips behind
- **Average Daily Rate (ADR) tracking** — calculates the average revenue earned per occupied berth per night across any date range; trends by month and year; comparable to prior periods and by berth category
- **Revenue per available berth (RevPAB)** — total berth revenue divided by total available berth-nights; the marina equivalent of hotel RevPAR; tracked daily, weekly, and monthly
- **Forecast revenue report** — projects expected revenue from confirmed and tentative bookings for the next 30, 60, and 90 days; used for cash flow planning
- **Deferred revenue schedule** — shows the portion of revenue received but not yet earned (e.g. deposits and advance seasonal payments); updates in real time as bookings are consumed

### 1.3 Upsell & Upgrade Campaigns

- **Booking tier system** — optionally define booking grades (e.g. Standard, Premium, Superyacht) with corresponding berth allocations, services, and rate premiums; each booking is assigned a grade at creation
- **AI upgrade campaign** — system identifies customers booked at a lower tier who could upgrade to a premium berth that has become available; sends a personalised upgrade offer via email or SMS; accepted upgrades are processed automatically with the differential charge added to the invoice
- **In-stay upsell** — send targeted offers to guests currently on site (e.g. restaurant discount voucher, additional services, equipment hire); triggered by check-in event or mid-stay milestone

---

## 2. Reservations — Additional Capabilities

*Supplements `features.md` Modules 2.1–2.3.*

### 2.1 Booking Approval Workflows

- **Manager approval required** — configure certain booking types (e.g. commercial vessels, live-aboard applications, superyacht bookings above a defined LOA) to require manager sign-off before confirmation; booking sits in "pending approval" state; manager receives an alert with all vessel and booking details; approval or rejection triggers a notification to the customer
- **Document gate** — a booking cannot be moved from "pending" to "confirmed" until the vessel's insurance certificate and registration have been verified and uploaded; system prevents manual override without manager authorisation

### 2.2 Carbon Offset Option at Booking

- **Per-booking offset** — configure a small optional carbon offset contribution (e.g. £2 per night) at booking checkout; contributions go to a nominated offset partner (e.g. sea kelp planting, woodland credits); a running total of contributions and offset units is displayed in the sustainability module
- **Automatic offset calculation** — optionally calculate an estimated CO₂e for the stay based on vessel type and distance from the nearest port; display to the boater and offer to offset the calculated amount

### 2.3 Part-Day and Hourly Bookings

- **Hourly / half-day bookings** — support dockage bookings in increments as short as 15 minutes for fuel dock berths, day visitor berths, and equipment hire; minimum duration, maximum duration, and pricing per increment are configurable per berth or resource

### 2.4 Batch Contract Creation and Sending

- **Batch seasonal contracts** — generate and send seasonal or annual berth contracts to an entire segment in a single operation; each contract is populated with the member's specific berth, rate, and dates; status tracked per recipient (sent, opened, signed, declined)

---

## 3. Berth & Slip Management — Additional Capabilities

*Supplements `features.md` Modules 1.1–1.2.*

### 3.1 AI-Assisted Smart Slip Assignment

- **Vessel-to-berth matching** — when a booking is created, the system scores all available berths against the vessel's LOA, beam, draft, air draft, mooring type preference, and shore power requirement; the highest-scoring berth is pre-selected; staff can override the suggestion
- **Optimised fleet placement** — for group and fleet bookings, the system assigns berths to minimise vessel movements, cluster the fleet on adjacent pontoons, and balance equipment load across piers
- **Seasonal layout optimisation** — at the start of each season, the system can generate an optimised seasonal berth allocation across all annual holders, minimising dead space from mismatched vessel and berth sizes

### 3.2 Temporary Departure & Berth Sub-letting

- **Temporary departure registration** — an annual or seasonal berth holder notifies the marina that their vessel will be absent for a defined period; the departure creates a "gap" window in the berth's calendar
- **Sub-let booking** — the marina can choose to sell the gap to a transient visitor; revenue share between the marina and the berth holder is calculated automatically at a configurable percentage and credited to the holder's account or applied against their next invoice
- **Owner opt-in / opt-out** — berth holders consent (or decline) to sub-letting as part of their berth agreement; the system only makes berths available for sub-let if the holder has opted in; opt-in status is recorded in the member record

### 3.3 Dock Walk Mobile App

- **Dedicated dock walk mode** — in the staff mobile app, a dock walk mode presents dock staff with a structured walk of their assigned pier; each berth appears in physical order; staff confirm occupancy, enter meter readings, and note any visible issues
- **Offline operation** — dock walk mode caches the day's berth list, current bookings, and last readings; dock staff can complete the entire walk without a data connection; all entries sync automatically on return to WiFi
- **Photographic evidence** — staff can photograph a berth or vessel during the dock walk; photos are linked to the berth record and optionally to an open booking or maintenance task
- **Discrepancy flag** — if a berth recorded as "occupied" in the system shows as empty on the walk (or vice versa), the app flags the discrepancy for office review; auto-generates an overstay alert or missing vessel alert as appropriate

### 3.4 Mooring Movement Control

- **Movement log** — every berth change for a vessel (arrival, departure, inter-marina transfer, haul-out, relaunch) is recorded as a movement event with timestamp and staff identity
- **Vessel traffic log** — chronological log of all vessel movements across the marina on any given day; filterable by pier, vessel type, and movement type; exportable for harbour authority submission
- **Expected movements board** — a day-view board showing all expected arrivals and departures; dock staff mark each one as completed as the vessel moves; outstanding movements are highlighted if past the expected time

### 3.5 Berth Listing for Sale

- **For-sale flag** — mark an annual berth as "for sale" on the berth record; this triggers a listing in the marina's berth marketplace section of the customer portal
- **Berth sale listing** — the listing shows the berth dimensions, facilities, asking price, and any licence transfer terms; interested parties submit an enquiry through the portal; marina staff or the existing holder manages the sale process (see Module 22)

---

## 4. Vessel Management — Additional Capabilities

*Supplements `features.md` Module 3.*

### 4.1 Vessel Non-Return Alert

- **Expected return tracking** — when a vessel checks out with an expected return date (e.g. for a temporary departure or day use), the system records the expected return time
- **Non-return alert** — if the vessel has not checked back in within a configurable grace period after the expected return, the system generates a critical alert to the duty harbour master; the alert includes the vessel name, owner contact details, and last known departure heading if recorded
- **Coast Guard notification workflow** — non-return alerts above a configurable duration (e.g. 4 hours) generate a structured incident report pre-populated with vessel details and last departure record; harbour master can escalate directly to the coastguard from the incident screen with a single button

### 4.2 Departure Notification

- **Automated vessel departure event** — when a berth is marked as vacated (by dock walk, check-out, or gate sensor), the system records the departure event and can send an automated SMS to the owner confirming the departure and any outstanding charges or fuel left on the invoice

---

## 5. Customer & Member Management — Additional Capabilities

*Supplements `features.md` Module 4.*

### 5.1 Smart Deduplication

- **Duplicate detection** — when creating a new member record, the system checks for potential duplicates by comparing name, email, phone, and vessel name against existing records; probable duplicates are flagged before the record is saved
- **Merge workflow** — a manager can review two suspected duplicates and merge them into a single canonical record; all bookings, invoices, communications, and documents from both records are consolidated; the secondary record is archived with a link to the merged record for audit purposes

### 5.2 Crew and Agent Contacts

- **Crew contacts** — add crew members, skippers, and captains as secondary contacts on a vessel record; each crew contact has their own name, phone, email, and role; automated notifications (arrival reminders, weather alerts) can be directed to the skipper separately from the registered owner
- **Agent contacts** — for commercial vessels and superyachts, record the managing agent or charter manager as a separate contact type; invoices and correspondence can be directed to the agent while the vessel record remains linked to the owner

### 5.3 Aged Debtor Follow-up Workflows

- **SmartNotes / conversation tracking** — log every chase conversation (call, email, SMS) against an overdue invoice with outcome and agreed payment date; visible to all staff from the invoice record to ensure consistent follow-up
- **Automated dunning letters** — configurable sequence of formal demand letters generated as PDFs; escalating in tone from polite reminder to final demand; each letter is dated, branded, and can be printed or emailed; sent with a tamper-evident delivery record
- **Debt escalation workflow** — define who receives a debt for escalation (collections officer, manager, external debt recovery); escalation generates a task with a due date and links the relevant invoices; resolved when the debt is paid, written off, or handed to an external agency

### 5.4 Lead Scoring

- **Engagement score** — for enquiries and leads not yet converted to a booking, the system tracks engagement signals (portal logins, email opens, booking widget interactions); a composite score is displayed on the lead record to help staff prioritise follow-up
- **AI lead prioritisation** — optionally sort the lead list by predicted conversion probability based on engagement history and vessel type / budget match to available berths

### 5.5 Customer Satisfaction Surveys

- **Post-stay survey** — automatically send a short satisfaction survey to customers on check-out; configurable questions; results stored against the member record and aggregated in the analytics module
- **NPS tracking** — include a Net Promoter Score question; track NPS trend over time; segment by booking type, vessel type, and nationality
- **Negative review alert** — if a customer submits a low satisfaction score, the system generates an alert to the harbour master for immediate follow-up before the customer leaves the marina

---

## 6. Loyalty Programme

*Currently absent from `features.md`. Found in Havenstar, Marina Master, Successful Marine.*

### 6.1 Tier-Based Loyalty Discounts

- **Loyalty tiers** — define named loyalty tiers (e.g. Bronze, Silver, Gold, Commodore) with qualification criteria based on cumulative spend, number of stays, or years of membership; members are automatically promoted when they reach the next tier threshold
- **Tier benefits** — configure benefits per tier: percentage discount on berth fees, fixed amount credit per stay, priority berth allocation, complimentary services (pump-out, parking), access to premium berths reserved for loyalty members
- **Automatic discount application** — when a booking is created for a loyalty member, the applicable discount is applied automatically to the berth fee line item; the discount type and tier are shown on the invoice for transparency
- **Tier status display** — the member record and customer portal both display the member's current tier, total qualifying spend/stays, and how close they are to the next tier; progress bar visual in the customer portal
- **Tier re-qualification** — define whether loyalty tier is re-qualified annually (must re-earn) or is held permanently once achieved; grace period configuration for lapsed members

### 6.2 Loyalty Points

- **Points earning** — optionally operate a points model alongside or instead of tiered discounts; members earn configurable points per £/$ spent across all departments (berths, fuel, yard services, restaurant, retail); points rate can be boosted for specific departments or promotional periods
- **Points redemption** — members redeem points in the customer portal or at the fuel dock / office; points convert to a credit against the next invoice at a configurable rate; minimum redemption threshold configurable
- **Points expiry** — configure a rolling expiry policy (e.g. points expire if not used within 24 months of earning); members receive an automated reminder 30 days before expiry
- **Points history** — full ledger of all points earned and redeemed per member; visible to staff and to the member in the portal
- **Loyalty card** — optionally issue a physical or digital loyalty card linked to the member record; card number can be used at POS terminals to look up the account and apply redemptions

### 6.3 Referral Programme

- **Referral code** — generate a unique referral code per member; when a new customer uses the code at online booking, both the referrer and the new customer receive a configurable benefit (e.g. one free night, points bonus, discount)
- **Referral tracking** — log all referrals against the referring member; total referrals and earned benefits visible on the member record; referral programme performance report in analytics

---

## 7. Financial Management — Additional Capabilities

*Supplements `features.md` Module 5.*

### 7.1 Payment Plans

- **Custom payment schedules** — for seasonal and annual berth contracts, define a payment schedule with multiple instalments on specific dates; each instalment generates a separate invoice; the schedule is attached to the contract record
- **Variable direct debit amounts** — support direct debits where the amount varies by instalment (e.g. larger deposit first, then equal monthly instalments); customer receives advance e-notification of each debit per BACS/ACH regulation
- **Missed instalment handling** — if a direct debit or auto-pay charge fails, the system retries after a configurable number of days; on second failure, a manual payment request is generated and the instalment is flagged as overdue on the payment schedule

### 7.2 Prepayment & On-Account Credit

- **On-account balance** — members can hold a positive credit balance on their marina account; on-account credit can be loaded by the member through the portal (card payment or bank transfer) or credited by staff (e.g. loyalty redemption, refund)
- **Auto-deduct from balance** — when an invoice is generated for a member with sufficient on-account balance, the system can automatically deduct the invoice amount from the balance and mark the invoice as paid; requires member opt-in
- **Balance statement** — members view their on-account balance and all debit/credit transactions through the customer portal; staff see the balance on the member record

### 7.3 Convenience Fees & Surcharges

- **Card processing fee** — optionally pass through a configurable percentage surcharge for card payments to recover processing costs; displayed to the customer before payment confirmation; compliant with local consumer protection regulations
- **Service surcharge** — configure a flat or percentage surcharge on specific charge types (e.g. after-hours fuel sales, emergency haul-out); surcharge is added as a separate line item on the invoice

### 7.4 Red Diesel / HMRC Fuel Duty Compliance (UK)

- **Red diesel dual-rate** — configure the reduced-rate (rebated) diesel product for use in propulsion only; system enforces that red diesel sales are recorded against the vessel's propulsion use declaration; generates the required HMRC fuel duty records showing split between propulsion and non-propulsion use
- **HMRC fuel duty report** — generates the periodic fuel duty return in HMRC-compatible format; captures total litres sold, litres at each rate, and duty payable; exported as a structured report for submission

### 7.5 Deferred Revenue Recognition

- **Deferred revenue ledger** — all advance payments (seasonal deposits, annual berth pre-payments, gift vouchers sold) are posted to a deferred revenue liability account; each day/week/month, the system recognises the earned portion (daily or nightly rate × elapsed nights) and transfers it from deferred to earned revenue
- **Deferred revenue report** — shows total deferred revenue by product type and member; scheduled recognition amounts for the next 30/60/90 days; included in the balance sheet as a current liability

### 7.6 Cost Centre Profitability

- **Department cost centres** — assign every revenue and expense transaction to a cost centre (berths, fuel, boatyard, restaurant, events, marina shop, car park, chandlery); configurable cost centre list
- **Department P&L report** — combines revenue and direct costs per cost centre into a profit and loss statement for any period; marina manager can see which departments are profitable and by how much
- **Budget vs actuals** — enter a budget for each cost centre per month; report compares actual revenue and costs against budget with variance analysis

---

## 8. Boatyard — Additional Capabilities

*Supplements `features.md` Module 6.*

### 8.1 Gantt Chart Project Management

- **Gantt view for work orders** — long-duration jobs (major refits, new builds, winter lay-up schedules) can be viewed as a Gantt chart showing all tasks, their start and end dates, dependencies, and assigned resources; managers can identify critical path tasks and resource conflicts at a glance
- **Task dependencies** — within a work order, tasks can be marked as dependent on each other (e.g. "Antifoul application" cannot start until "Hull preparation" is complete); the Gantt chart enforces dependencies and warns if a delay in a predecessor task will push back dependent tasks
- **Baseline vs actual** — record the original planned schedule as a baseline; as the project progresses, the Gantt highlights schedule slippage in red against the baseline

### 8.2 Boat Builder & Shipyard Manufacturing Management

- **Build project record** — manage the construction of a new vessel from keel to launch; build projects are a specialised work order type with a multi-year timeline, progress milestones, and stage payments
- **Materials BOM (Bill of Materials)** — define the complete list of materials required for a build; track procurement against the BOM; link materials costs to the build project cost ledger
- **Stage payment invoicing** — generate invoices tied to build milestones (e.g. keel laid, hull complete, engine fitted, sea trials, delivery); each milestone invoice is linked to the build project and progress report

### 8.3 Job Packages & Templates

- **Job package catalogue** — define bundled service packages with a fixed set of tasks, labour hours, and parts (e.g. "Bronze antifoul service — 40ft", "Annual service — inboard diesel", "Osmosis treatment — full cycle"); packages are selectable from the work order creation screen as a starting point; individual items can be adjusted after selection
- **Batch job posting** — post time and materials entries to multiple work orders simultaneously (e.g. a yard team worked on 5 boats in a morning; supervisor posts hours to all 5 in a single batch operation rather than updating each work order individually)

### 8.4 Warranty Management Across Manufacturers

- **Manufacturer warranty register** — maintain a list of warranty claim agreements per manufacturer or supplier; each agreement specifies: parts or labour covered, claim submission process, reimbursement rate, and average processing time
- **Warranty claim submission workflow** — when a warranty work order is completed, generate a warranty claim document formatted for the specific manufacturer; track claim status (submitted, acknowledged, approved, reimbursed, rejected); match reimbursement received against the claim value and post the difference to the cost account

---

## 9. Inventory & Parts — Additional Capabilities

*Supplements `features.md` Module 6.5.*

### 9.1 Automatic Supplier Price File Updates

- **Supplier price file import** — suppliers provide regular price update files (CSV, EDI, or API feed); the system imports the file and updates unit costs for all matching parts automatically; price history is retained; parts with a significant cost increase (above a configurable threshold) are flagged for manager review before the new cost is applied to future work orders

### 9.2 Mobile Service Truck Inventory

- **Vehicle / truck inventory location** — create a named inventory location for a mobile service van or truck; parts can be transferred from the main warehouse to the truck inventory; technicians using the truck check out parts from the truck location rather than the main warehouse
- **Truck restock request** — when truck inventory falls below par, a restock request is generated automatically; office staff pick the parts from the warehouse and transfer them to the truck record; transfer is tracked as a stock movement

---

## 10. Utility Management — Additional Capabilities

*Supplements `features.md` Module 7.*

### 10.1 Smart Meter IoT Integration

- **Automatic meter polling** — connect to compatible smart meter hardware (Rolec, Meter-MACS, Ampy, Metron, MarineSync) via cloud API or direct M-Bus/Modbus; readings are polled automatically without any site walkthrough; configurable polling interval (15/30/60 minutes)
- **Outage detection** — if a berth meter stops reporting within the expected polling window, a connectivity alert is generated and sent to the maintenance team; the meter is flagged as offline on the berth record
- **OFGEM / regulatory reporting** — generate utility consumption reports in the format required by energy regulators (e.g. OFGEM in the UK) for marina operators who resell electricity; includes consumption by berth, period totals, and metering device identification
- **Hourly trend data** — per-berth electricity and water consumption trend charts available at hourly resolution; visible to staff on the berth record and optionally to the berth holder in the customer portal

### 10.2 Utility Prepayment via Portal

- **Prepay electricity / water** — berth holders can top up a utility credit balance through the customer portal; charges are deducted from the balance in real time as the meter reads; when the balance falls below a configurable threshold, an alert is sent and the holder can top up again
- **Low-balance warning** — automated notification to the member when their utility prepay balance falls below the configured minimum; links to the portal top-up page

### 10.3 Service Bollard Management

- **Shore power bollard registry** — each shore power service bollard (pole) is registered in the system with its berth assignment, maximum supply capacity, and current connection status
- **Remote bollard control** — for bollards with remote switching capability, staff can enable or disable supply from the web interface (e.g. when a berth becomes overdue or a member's account is suspended); connection events are logged
- **Bollard fault log** — bollard faults (supply failure, overcurrent trip, connection error) are logged as defects and trigger a maintenance task; the berth is marked as "power unavailable" on the map until the fault is resolved

### 10.4 Wash Token Management

- **Token / access code generation** — generate single-use or time-limited tokens for coin-operated or code-controlled facilities (showers, laundry, car wash); tokens are sold at the office or via the customer portal; each token has a value, expiry, and is tracked to the purchasing member
- **Token sales report** — total tokens sold and redeemed by facility and period; revenue per facility included in the department P&L

---

## 11. Dry Stack & Launch Queue — Additional Capabilities

*Supplements `features.md` Module 22.*

### 11.1 Forklift Operator Tablet Interface

- **Purpose-built forklift UI** — a simplified, large-text tablet interface designed for use in a forklift cab; shows only the current assignment: vessel name, rack position, destination (water or rack), and any concierge pick-ticket items to be completed before or after the launch
- **Put-away / leave-out mode** — after a retrieval, the operator selects "put away" and the system confirms the rack position; the vessel's yard grid record is updated automatically; if the vessel is to be left out overnight, the operator selects "leave out" and a day berth is assigned in the water

### 11.2 Concierge Pick-Ticket / Valet Services

- **Concierge services catalogue** — the marina defines a list of valet services that can be requested alongside a launch (e.g. vessel wash-down, topsides polish, bilge check, fuel pre-fill, ice delivery, provisioning top-up, battery charge, engine warm-up); each service has a price and an estimated preparation time
- **Pick-ticket** — when submitting a launch request, the boater selects any desired concierge services; the combined request becomes a "pick-ticket" for the dock team; services are completed before the vessel enters the water (or at pick-up, if specified); each service is charged and added to the invoice
- **Battery charge request list** — a dedicated queue for vessels requiring battery charging while stored on the rack; shows charge status, estimated time to full charge, and completion alerts to the owner

### 11.3 No-Show Prevention

- **Launch request confirmation** — customers confirm their launch request by a configurable cut-off time; unconfirmed requests generate a reminder 2 hours before cut-off
- **No-show logging** — if a vessel is launched but the owner does not arrive within a configurable window, the launch is logged as a no-show; a no-show fee (configurable) is added to the member's account; repeated no-shows flag the member for manager review and can restrict future same-day launch requests

---

## 12. Maintenance — Additional Capabilities

*Supplements `features.md` Module 8.*

### 12.1 Upfront Payment for Maintenance Bookings

- **Deposit at booking** — for scheduled maintenance services (e.g. annual service, haul-out), optionally require full prepayment or a deposit percentage at the time of booking; payment is collected via the customer portal or at the office; the maintenance job cannot be confirmed without payment

### 12.2 Capacity-Managed Maintenance Scheduling

- **Team capacity view** — when scheduling a maintenance task or batch of recurring maintenance jobs, the system shows the team's available hours per day against already-assigned work; the schedule planner can see immediately whether there is capacity to add more work on a given day
- **Maintenance batch scheduler** — for seasonal maintenance programmes (e.g. end-of-season COSHH inspections of all berths), generate a batch of maintenance tasks for all assets of a given type and auto-assign them across the team's available capacity over a date range

---

## 13. Staff Management — Additional Capabilities

*Supplements `features.md` Module 9.*

### 13.1 Crew / Tug Team Booking

- **Specialised crew resource types** — in marinas handling larger commercial vessels, configure resource types beyond individual staff members: tug crew, pilot, linesmen team, crane team; availability is tracked per team rather than per individual; a single harbour movement can require multiple crew resource types to be available simultaneously
- **Pilotage and tug booking** — create a pilotage or tug booking linked to a vessel movement event; assign the required crew; generate the pilotage invoice automatically on departure

### 13.2 Commission Tracking for Sales Staff

- **Commission rate configuration** — define commission structures per staff member or job role: percentage of sale price, fixed fee per transaction, tiered rate based on monthly volume; applies to boat sales, brokerage, and charter bookings
- **Commission accrual report** — tracks commissions earned per staff member for any period; manager can review before payroll processing; commission earnings are recorded as a payroll expense against the relevant department cost centre

---

## 14. Communications — Additional Capabilities

*Supplements `features.md` Module 10.*

### 14.1 WhatsApp Channel

- **WhatsApp Business API** — send booking confirmations, arrival reminders, payment links, and weather alerts via WhatsApp as an alternative to SMS; requires the customer's WhatsApp-enabled phone number and opt-in consent
- **Two-way WhatsApp** — customers can reply to marina messages via WhatsApp; replies appear in the unified communications inbox alongside email and SMS replies
- **WhatsApp message templates** — create and manage pre-approved WhatsApp message templates (required by Meta's Business API); templates are submitted for approval once and then reused for transactional sends

### 14.2 Multi-Channel Customer Journeys

- **Automated journey builder** — define a sequence of communications across multiple channels triggered by a single booking event; example: (Day -30) email seasonal renewal invitation → (Day -14, if not signed) WhatsApp reminder → (Day -7, if not signed) SMS with signing link → (Day -3) phone call task created for office staff; each step only fires if the previous one has not resulted in the desired action
- **Journey performance dashboard** — for each active journey, show open rates, click rates, completion rates (e.g. how many reached the signed document outcome), and channel-level effectiveness

### 14.3 Slack Integration

- **Operational alerts to Slack** — push configurable alert types to a marina's Slack workspace: new booking received, payment failure, critical defect logged, stock below minimum, overstay detected; each alert links back to the relevant record in DocksBase
- **Channel routing** — different alert types can be directed to different Slack channels (e.g. payment failures go to #finance, maintenance defects go to #yard, new bookings go to #operations)

### 14.4 Dotdigital / Marketing Automation Integration

- **Audience sync** — push DocksBase customer segments to Dotdigital (or equivalent marketing automation platform) automatically; segments update in real time when members join or leave
- **Campaign results import** — pull email open, click, and unsubscribe data from Dotdigital back into DocksBase communication history; enriches the member record without requiring staff to check two systems

### 14.5 A/B Testing for Communications

- **Subject line A/B test** — when sending a bulk email, optionally configure two subject lines; the system sends variant A to 20% of recipients and variant B to 20%; after a configurable hold period, the higher-performing subject is automatically sent to the remaining 60%
- **Content A/B test** — test two different email body layouts or offers; same split logic as subject line testing

---

## 15. Analytics & Reporting — Additional Capabilities

*Supplements `features.md` Module 11.*

### 15.1 Revenue Analytics (Hotel-Style Metrics)

- **ADR and RevPAB dashboards** — real-time display of Average Daily Rate and Revenue per Available Berth on the operational dashboard, alongside occupancy percentage; filterable by berth category and pier
- **Revenue per linear foot / per square metre** — for marinas charging by linear footage or storing vessels in area-based pricing zones, calculate revenue efficiency per unit of physical space
- **Slip utilisation heatmaps** — a colour-coded heatmap showing occupancy by berth over a selected date range; high-utilisation berths are dark red, low-utilisation ones are pale; reveals patterns in occupancy that inform future pricing and capacity decisions

### 15.2 Lead Conversion Funnel

- **Booking funnel report** — tracks the number of sessions on the booking widget, inquiries submitted, quotes generated, bookings confirmed, and payments received; drop-off rates at each stage identify where prospective customers abandon the process
- **Channel conversion** — segment the funnel by booking source (direct portal, OTA partner, phone, walk-in) to identify which channels convert best

### 15.3 Multi-Site Performance Comparison

- **Marina group dashboard** — for marina groups, a consolidated view comparing key metrics (occupancy, ADR, revenue, satisfaction score) across all marinas in the group; filterable by period and metric; individual marina managers see only their own data unless granted group access

### 15.4 ESG / Sustainability Reporting

- **Scope 1 emissions** — direct emissions from fuel combustion (marina vehicles, equipment); calculated automatically from fuel purchase records in the AP module
- **Scope 2 emissions** — indirect emissions from purchased electricity; calculated from utility cost data and the applicable grid carbon intensity factor
- **Scope 3 emissions** — value chain emissions from supplier activities and customer vessel fuel use; requires manual input or integration with FuelCloud dispense data
- **Sustainability scorecard** — overall CO₂e per unit of revenue, per berth-night, and total absolute emissions; trend over time; comparable to prior year; formatted for board reporting or investor ESG disclosure

---

## 16. Restaurant & F&B — Additional Capabilities

*Supplements `features.md` Module 12.*

### 16.1 Hospitality EPoS Integration

- **EPoS Now integration** — connect to EPoS Now as an alternative to the built-in restaurant POS for larger operations with existing EPoS infrastructure; orders placed on EPoS Now are reflected in DocksBase for account charging and reporting
- **Tevalis integration** — similar integration with Tevalis hospitality POS; covers table management, order management, and split billing; DocksBase receives sale totals for member account charging and department reporting

### 16.2 Self-Order Kiosk

- **Restaurant kiosk mode** — a simplified self-order interface displayable on a wall-mounted tablet at the restaurant entrance or bar; guests enter their table number and order directly; order is sent to the KDS and a bill is generated automatically; reduces waiting staff required for order-taking during peak periods

---

## 17. Events & Venue Hire — Additional Capabilities

*Supplements `features.md` Module 13.*

### 17.1 Event Lead & Enquiry Management

- **Event enquiry pipeline** — event enquiries from the website, phone, or email are logged as leads with: event type, proposed date, expected attendance, catering requirements, AV requirements, budget; pipeline stages: enquiry → proposal sent → site visit scheduled → booking confirmed
- **Automated proposal generation** — from an event enquiry, generate a tailored PDF event proposal including venue options, available dates, indicative pricing per head for catering and venue hire, and terms; sent for customer review and digital approval

### 17.2 Event Booking Matrix

- **Availability matrix** — visual grid showing all hireable event spaces across a date range; each cell shows whether a space is available, provisionally held, or confirmed booked; staff book by clicking a cell, preventing conflicts without needing to check a separate calendar

### 17.3 Linked Accommodation Bookings

- **Accommodation inventory** — for marina resorts with adjacent accommodation (lodges, cabins, hotel rooms, glamping pitches), define the accommodation as a bookable resource type; accommodation bookings are linked to the marina database but managed as a separate module
- **Event + accommodation bundle** — offer packages that bundle a venue hire, catering, and overnight accommodation; a single booking reference covers all elements; billing is consolidated on a single invoice

---

## 18. Activities & Experience Booking (New Module)

*Absent from `features.md`. Found in EliteMarinas and increasingly expected by resort-style marinas.*

### 18.1 Activities Catalogue

- **Activity types** — define bookable activities offered by the marina: paddleboarding, kayaking, sailing lessons, scuba diving, fishing trips, yoga on the pontoon, cooking classes, powerboat licence courses, children's sailing academy, boat safety course, marine wildlife tours, private charter day trips, equipment hire (bicycles, e-bikes, fishing rods, snorkelling gear)
- **Activity record** — activity name, description, duration, capacity (minimum and maximum participants), minimum age (with age verification rule), price per person, price by customer type (member vs. guest vs. child), category, photo, and seasonal availability window

### 18.2 Booking & Scheduling

- **Activity booking** — customers book activities from the customer portal, marina website, or at the office; availability is shown in real time based on capacity and instructor/equipment availability; confirmation email sent automatically
- **Resource assignment** — each activity is linked to required resources (instructor availability from the staff rota, equipment from the asset register); booking is only confirmed if all required resources are free
- **Group activity booking** — a single booking for a group of participants; group discounts configurable; if the group fills the activity's capacity, the activity is automatically marked as full
- **Activity calendar** — staff view all activities for the day/week in a calendar view; activities are colour-coded by type; instructor assignments visible

### 18.3 Activity Extras & Linked Hire

- **Add-on extras** — customers can add equipment hire or consumables to an activity booking (e.g. wetsuit hire, waterproof camera hire, refreshment pack); each extra is priced and added to the invoice
- **Equipment availability check** — when an activity with required equipment is booked, the system checks that the required item is available from the equipment register (see Module 21) and temporarily reserves it for the duration of the activity

### 18.4 Activity Billing

- **Activity invoicing** — activity charges are added to the customer's account or charged immediately at booking; for marina members, charges can be added to their berth invoice for settlement at check-out
- **Cancellation policy** — configure the activity cancellation policy (e.g. full refund if cancelled > 48h before, 50% refund if cancelled 24–48h before, no refund < 24h); policy is enforced automatically on cancellation

---

## 19. Charter & Boat Hire Management (New Module)

*Partially referenced in `features.md` Module 19 (Boat Sales) but charter management is distinct. Found in EliteMarinas, Successful Marine, Marina Master, MarinaOffice.*

### 19.1 Charter Fleet Inventory

- **Charter vessel record** — a vessel can be designated as a charter vessel; charter vessel attributes include: hourly / daily / weekly charter rate, fuel-inclusive vs. fuel-extra, skipper-required (bareboat vs. skippered), minimum qualification required of charterer, cleaning fee, security deposit amount, maximum charter duration
- **Owner / third-party fleet** — distinguish between marina-owned charter vessels (full revenue to marina) and third-party fleet vessels managed for commission; track commission structure and net proceeds per charter per vessel

### 19.2 Charter Booking

- **Charter booking creation** — customer selects vessel, dates, and option for skipper; booking wizard calculates total: base charter rate × duration + fuel allowance (if inclusive) + skipper fee (if required) + cleaning fee + security deposit; booking confirmation sent automatically
- **Skipper assignment** — assign a qualified skipper from the staff or contractor register; system validates that the skipper holds the required certification for the vessel type; skipper availability is checked against the rota
- **Charter hire duration** — support charter bookings in increments from 15 minutes (half-day and hourly boat hire) to multi-week passages; overnight charter terms distinct from day-hire terms

### 19.3 Charter Agreements & Security Deposits

- **Charter agreement** — generate a charter agreement from a template; populated with vessel details, charterer's details, dates, rate, fuel terms, deposit amount, and jurisdiction; sent for digital signature via the eSignature module
- **Security deposit** — collect a configurable refundable security deposit at booking via card; deposit is held and released (or partially withheld for damage) on vessel return; damage assessment workflow triggered when deposit deductions are required

### 19.4 Charter Channel Management

- **OTA distribution for charter** — publish charter availability to channel partners (e.g. Zizoo, Click&Boat, Rentals United); bookings received from channel partners import automatically; channel commission is recorded on each booking
- **Charter agent commissions** — record commissions owed to external booking agents for charter leads; commission is calculated and tracked per booking

---

## 20. Housekeeping (New Module)

*Absent from `features.md`. Found in EliteMarinas. Relevant to marinas with charter fleets, accommodation, or high-standard facility management.*

### 20.1 Housekeeping Task Generation

- **Auto-generate from bookings** — when a charter or accommodation booking check-out is processed, a housekeeping task is automatically created for the vessel or unit; task includes: unit/vessel identity, check-out time, target ready-by time, and a configurable cleaning checklist
- **Mid-stay housekeeping** — for long-stay charters or accommodation bookings, configure mid-stay housekeeping at a set frequency (e.g. every 3 days); tasks are generated automatically and added to the housekeeping queue
- **On-demand service** — guests can request additional housekeeping from the customer app; request creates a task in the housekeeping queue with priority level

### 20.2 Housekeeping Matrix Dashboard

- **Visual readiness board** — a grid view of all charter vessels and accommodation units showing their current housekeeping status: dirty (just vacated), in progress (team assigned), ready for inspection, inspected and clean, ready for guest; updated in real time as the housekeeping team progresses
- **Delay alert** — if a unit is not marked "ready for guest" within a configurable time before the next check-in, the system generates an alert to the housekeeping supervisor and the front desk; alternative vessel or unit substitution can be managed from the alert

### 20.3 Housekeeping Mobile App

- **Housekeeper task list** — housekeepers see only their assigned tasks and checklists on a simplified mobile interface; each task shows the unit, check-in time of incoming guest, and checklist items
- **Photo capture** — housekeepers photograph the unit at completion (before and after); photos are stored against the task record and optionally shared with the incoming guest as an "arrival photo"
- **Defect escalation from housekeeping** — if a housekeeper discovers a fault (broken fitting, plumbing issue, electrical fault), they flag it directly in the housekeeping app; this creates a maintenance defect record linked to the unit and notifies the maintenance team

### 20.4 Linen & Consumable Tracking

- **Linen inventory** — track linen sets (sheets, towels, duvet covers) across charter vessels and accommodation units; each housekeeping task consumes a configurable linen set; system tracks clean vs. dirty linen quantities and triggers a laundry task when dirty linen accumulates above a threshold
- **Consumable stock** — track consumable replenishment items (soap, shampoo, coffee, tea, welcome pack components) used per task; low-stock alerts and replenishment from the main inventory module

---

## 21. Tenants & Commercial Lettings (New Module)

*Absent from `features.md`. Found in EliteMarinas, Harbour Assist. Relevant to marinas with commercial units on site.*

### 21.1 Commercial Unit Inventory

- **Unit record** — define each lettable commercial space on the marina: boat chandlery, workshop, storage unit, office suite, retail unit, food kiosk plot, car parking bay, boat trailer storage space; attributes: unit ID, area (m²), facilities (power, water, broadband), current tenant, lease start/end date, monthly/annual rent, service charge

### 21.2 Tenancy Management

- **Lease record** — create a tenancy agreement linked to a unit and tenant contact; specify: rent amount and frequency, service charge, deposit amount, break clauses, notice period, rent review dates, permitted use
- **Rent invoicing** — automatically generate rent invoices on the configured schedule (monthly, quarterly, annually); invoice status and ageing tracked in the same AR module as berth fees; overdue rent triggers the same automated reminder sequences
- **Rent review workflow** — when a rent review date is approaching, the system generates a task for the marina manager; the review outcome (new rent amount) is recorded and applied to future invoices automatically from the effective date
- **Tenancy document vault** — store lease agreements, guarantor documents, planning permissions, and compliance certificates linked to each tenancy; document expiry tracked with automated renewal reminders

---

## 22. Berth Marketplace & Sub-let (New Module)

*Partially referenced in Module 1.2 (Wait list) and Module 3.5 (Berth listing). This module makes it a full-featured berth exchange platform. Found in Marina Match, EliteMarinas, Dockwa.*

### 22.1 Berth Sale Listings

- **Berth sale record** — existing berth holders (or the marina itself, for lapsed contracts) can list a berth for sale; listing attributes: berth dimensions, shore power supply, water, asking price, licence transfer terms, photos
- **Enquiry management** — interested parties submit enquiries through the portal or marketplace; enquiries are logged and notified to the listing party; standard messaging flow within the platform
- **Listing publication** — listings can be published to the marina's customer portal, the DocksBase public berth marketplace (if joined), or exported to third-party berth marketplaces (e.g. Marina Match)
- **Transaction recording** — when a berth is sold, record the transfer: outgoing holder, incoming holder, price paid, transfer date; generate the licence transfer document; update the berth record's owner link

### 22.2 Berth Exchange / Holiday Swap

- **Exchange listing** — seasonal berth holders can register their berth for a reciprocal exchange: I will let another holder use my berth while I'm away if they let me use theirs at another marina (or another period); exchange listings are visible to other registered holders within the group or network
- **Exchange agreement** — when two holders agree to an exchange, generate an exchange agreement document signed by both parties; both berths are blocked in each holder's calendar for the exchange period

---

## 23. Self-Service & Customer Apps — Additional Capabilities

*Supplements `features.md` Module 14.*

### 23.1 Self-Service Check-In Kiosk

- **Walk-up kiosk mode** — a large-screen tablet or mounted kiosk at the marina entrance allows arriving boaters to check in without staff interaction outside office hours; boater searches by booking reference or vessel name; confirms arrival, receives berth number, shore power PIN, and gate code on screen and by SMS; system marks the booking as active

### 23.2 Contactless Guest Registration

- **Digital arrival form** — dock staff send a pre-arrival link to the vessel skipper; skipper completes vessel details, emergency contact, and signs the marina rules acknowledgement before arriving; on arrival, check-in is instant as all information is already in the system
- **QR code check-in** — booking confirmation email includes a QR code; dock staff scan the code to pull up the booking instantly without searching

### 23.3 In-App Upsell & Service Ordering

- **Marina shop in the app** — customers browse and purchase marina services, merchandise, and booking extras from the customer app during their stay (fuel request, pump-out booking, laundry token, restaurant table, equipment hire, activity booking); purchases are added to the open invoice and fulfilled by staff with a task notification

### 23.4 Boater Marketplace Discovery

- **Public marina profile** — a public-facing marina profile page on the DocksBase boater network (or a partner marketplace like Dockwa, Snag-A-Slip, or Navily) showing marina facilities, photos, rates, availability, and reviews; boaters discover and book directly from the marketplace
- **Automated review solicitation** — on check-out, send the guest a review invitation; positive reviews are pushed to the public profile; negative reviews trigger an internal alert for service recovery

---

## 24. Security & Physical Access Control — Additional Capabilities

*Supplements `features.md` Module 15.*

### 24.1 RFID / Contactless Access Control

- **Reader-per-access-point architecture** — install contactless card readers on every controlled access point: main gate, each pier gate, shower block, laundry room, car park barrier, boatyard, fuel dock, staff-only areas; each reader is registered in the system with its location and zone
- **Membership card integration** — the member's marina card doubles as an access card; access is automatically enabled on contract activation and revoked on expiry, payment suspension, or insurance lapse; no manual re-programming of card readers required
- **Multi-card per member** — issue up to a configurable number of cards per member (e.g. owner + crew + family); each card is individually activatable and revocable
- **Zone-based access rules** — configure which zones each membership type can access (e.g. annual holders access all zones; transient visitors access main gate and Pier A only; seasonal holders access their assigned pier gate and shower block); rules apply automatically to all cards in the membership type

### 24.2 ANPR — Automatic Number Plate Recognition

- **ANPR camera integration** — integrate with ANPR cameras at the marina car park barrier; vehicle number plates are recognised and matched to member records; authorised vehicles enter without a physical card; unrecognised plates are flagged for staff review
- **Vehicle registration per member** — members register up to a configurable number of vehicle number plates on their account through the portal; plates are checked against the ANPR camera feed automatically
- **ANPR access log** — every vehicle entry and exit is logged with timestamp, number plate, and matched member (or "unrecognised"); exportable for security incidents

### 24.3 Searchable CCTV

- **Event-linked footage review** — when a security incident or access event is logged, the system links the event's timestamp and location to the nearest camera; staff click "Review footage" and the CCTV viewer jumps directly to the relevant camera and time; no manual scrubbing required
- **CCTV search by access event** — search for all camera clips matching a specific access card event or a specific vehicle number plate from the ANPR log

### 24.4 Biometric Authentication

- **FaceID for boaters** — optional biometric authentication for recurring visitors and annual berth holders; boater registers their face via the customer app; on subsequent arrivals, face recognition at the gate replaces the physical access card; attendance is logged automatically
- **Staff biometric clock-in** — staff clock in and out via facial recognition at the site entrance; integrates with the staff shift module to record actual worked hours against scheduled shifts

### 24.5 Fraud Prevention & Authorisation Workflows

- **Spend authorisation limits** — define maximum transaction values per staff role without requiring manager sign-off; any charge, discount, or write-off above the threshold requires a manager-level user to authenticate and approve; the authorisation is logged with approver identity
- **Anomaly alerts** — the system monitors for unusual transaction patterns (e.g. multiple large discounts applied by the same staff member in a single day) and sends an alert to the finance manager

---

## 25. Environmental, Sustainability & ESG (New Module)

*Partially referenced in `features.md` Module 16 (carbon tracking). This expands it into a full ESG reporting suite. Found primarily in EliteMarinas.*

### 25.1 Carbon / Emissions Tracking

- **Scope 1 emissions** — calculated from fuel combustion records: marina vehicles, workboats, generators, machinery; fuels entered in the AP module with emission factors per fuel type; CO₂e calculated automatically
- **Scope 2 emissions** — calculated from purchased electricity consumption (from the utility module) multiplied by the applicable grid carbon intensity factor; factor is updated periodically (e.g. annually from government published data or in real time from a grid API)
- **Scope 3 emissions** — indirect value chain emissions; configurable data sources: fuel sold to vessels at the fuel dock (from fuel dock sales records), supplier deliveries (estimated from purchase order quantities and supplier-declared emission factors); Scope 3 data requires manual input or integration with FuelCloud

### 25.2 Waste & Disposal Tracking

- **Waste log** — record waste disposal events per category: general waste, recycling, hazardous waste, antifouling paint, bilge oil, pump-out sewage; each entry records volume/weight, disposal method, and contracted waste carrier
- **Waste diversion rate** — calculate and display the percentage of waste diverted from landfill (recycling + composting + specialist disposal) vs. general waste; tracked over time

### 25.3 Sustainability Ledger

- **Sustainability accounts** — display total Scope 1, 2, and 3 CO₂e alongside revenue and cost data in a sustainability ledger; emissions intensity calculated as CO₂e per £/$ revenue and per berth-night
- **Year-on-year comparison** — sustainability metrics compared to prior years; trend analysis; target-setting against configurable reduction goals

### 25.4 ESG Board Reporting

- **Investor-grade ESG report** — a structured PDF report covering: environmental (emissions, waste, water, biodiversity initiatives), social (community programmes, staff wellbeing, access to maritime sport), governance (data protection, anti-bribery, audit findings); formatted to align with GRI, SASB, or TCFD framework disclosure items
- **Play It Green integration** — automatically calculate the offset units purchased (e.g. sea kelp fronds planted, tree-planting credits) from the per-booking offset contributions; display total offset contribution in the ESG report

---

## 26. Accounting Back-Office — Additional Capabilities

*Supplements `features.md` Module 5.7.*

### 26.1 Automated Invoice Capture (Accounts Payable)

- **Document capture integration** — connect to an OCR / document capture service (e.g. Continia, Dext, AutoEntry); supplier invoices emailed to a dedicated inbox are automatically scanned and extracted; key fields (supplier, invoice number, date, amount, line items) are pre-populated in a draft AP invoice for staff review and approval
- **Three-way matching** — when a supplier invoice arrives, the system matches it against the open purchase order and goods receipt record; discrepancies trigger a hold for review; matched invoices proceed automatically for payment approval

### 26.2 Cash Flow Reporting

- **Cash flow report** — real-time view of cash receipts and payments over any date range; categorised by department; distinguishes between receipts already banked and amounts outstanding; projects the rolling cash position based on due invoices and expected direct debit receipts
- **Weekly cash forecast** — a forward-looking report showing expected inflows (invoices due, direct debit run scheduled) and outflows (POs due for payment, payroll estimate) by week for the next 8 weeks

### 26.3 Balance Sheet & P&L

- **Balance sheet** — auto-generated balance sheet from the general ledger; assets (cash, debtors, prepayments), liabilities (creditors, deferred revenue, VAT payable, bank loans), and equity; updated in real time with each posted transaction; exportable as PDF
- **P&L statement** — income and expenditure statement for any period; comparative to prior period and prior year; exportable; drillable to individual transactions

### 26.4 Multi-Currency

- **Currency configuration** — configure one or more billing currencies per marina; transactions are recorded in the booking currency; foreign currency payments are converted to the base currency at the exchange rate on the date of payment; exchange rate gain/loss posted automatically to the GL

### 26.5 Additional Accounting Integrations

- **Sage Intacct** — push invoices, payments, and GL transactions to Sage Intacct for marinas using this platform; bidirectional sync of account codes and contact records
- **NetSuite** — REST-based integration with NetSuite ERP for marina groups using NetSuite as their corporate finance platform
- **Microsoft Dynamics 365 Business Central** — for marina groups standardised on Microsoft Dynamics; full invoice, payment, and GL sync; member and supplier records synced bidirectionally; multi-currency and multi-entity support via Business Central's native architecture
- **MYOB** — Australasian accounting integration for marinas in Australia and New Zealand

---

## 27. Boat Sales & Brokerage — Additional Capabilities

*Supplements `features.md` Module 19.*

### 27.1 RightBoat & Marketplace Listing Export

- **RightBoat integration** — publish brokerage and dealer listings to RightBoat.com (major UK/European boat sales marketplace) automatically from the sales module; listing status updates and price reductions sync in real time; enquiries from RightBoat import as leads in the sales pipeline
- **Boats.com / YachtWorld export** — push listings to the Boats.com / YachtWorld network (standard industry practice for US and international brokerage); listing specifications mapped automatically

### 27.2 Boat Charter Commission Tracking

- **Charter agent record** — record external charter agents and their commission rates; when a charter booking originates from an agent, the commission amount is calculated and tracked against the booking; commission is included in the AP module for payment to the agent

### 27.3 Boat Rental Management (RentalH₂O Model)

- **Short-term boat rental** — manage a fleet of boats available for short-term hire by non-members without a skipper (electric day boats, pedal boats, kayaks, paddleboards, small sailing dinghies); drag-and-drop rental calendar shows all fleet units and their bookings
- **Rental pricing** — hourly, half-day, and full-day rates per vessel type; season-based pricing configured in the rate card; online pre-booking available through the customer portal
- **Rental fleet availability widget** — embed a real-time rental availability widget on the marina's public website; customers select vessel type, date, and duration; payment collected at booking

---

## 28. Website, Digital Marketing & OTA Distribution (New Module)

*Absent from `features.md`. Found across Storable Marine, Dockwa, EliteMarinas.*

### 28.1 Marina Website Services

- **Branded website template** — optional white-label marina website hosted on a DocksBase subdomain or custom domain; includes: marina profile, photo gallery, facilities page, rates page, and an embedded live booking widget; content managed from a simple CMS within DocksBase
- **SEO tooling** — configurable page titles, meta descriptions, and structured data (schema.org/Marina); automatically generated sitemap; integration with Google Search Console

### 28.2 Online Booking Widget

- **Embeddable booking widget** — a JavaScript widget embeddable on any external website or WordPress site; shows real-time berth availability; accepts vessel details and dates; processes deposit or full payment; booking created automatically in DocksBase
- **Booking engine customisation** — configure widget branding (colours, logo, button text), required fields, and which berth categories are displayed; toggle which extras are offered at checkout (electricity, water, parking, provisioning)

### 28.3 OTA Distribution

- **Channel manager** — in addition to the marina-specific channels already in `features.md` Module 17.7, integrate with general outdoor / hospitality OTAs: Rentals United, PitchUp (camping and outdoor), Hoseasons (UK holiday lettings), Booking.com (for accommodation-integrated marinas); availability pushed to all connected channels simultaneously; bookings from each channel imported automatically
- **Channel parity pricing** — configure whether the same rates are published across all channels or whether channel-specific markups or discounts apply (e.g. lower direct rate as a best-rate guarantee)

### 28.4 Review Management

- **Automated review request** — send a review invitation to departing customers via email or SMS; link to the marina's Google Business Profile, Tripadvisor listing, or Dockwa profile; open and response rates tracked in the communications module
- **Review monitoring dashboard** — aggregate reviews from Google, Tripadvisor, Dockwa, and other connected sources; average rating and recent reviews displayed on the operational dashboard; negative reviews generate an alert for immediate follow-up

### 28.5 Coupon Codes & Promotional Discounts

- **Discount code creation** — generate alphanumeric coupon codes with configurable discount type (percentage or fixed amount), applicable charge types, minimum stay, validity dates, and maximum uses; codes are entered by customers in the booking widget checkout
- **Promo tracking report** — track usage and revenue impact per coupon code; shows number of uses, total discount granted, and total revenue from bookings where the code was applied

---

## 29. Commercial Harbour Management (New Module)

*Absent from `features.md`. Found in Harbour Assist. Relevant to marinas adjacent to working harbours or managing commercial shipping.*

### 29.1 Commercial Vessel Handling

- **Commercial vessel types** — ferry, cargo vessel, fishing vessel (commercial), research vessel, pilot vessel, dredger, supply vessel, cruise ship tender; each type has distinct tariff structures and reporting requirements
- **Commercial movement record** — each commercial vessel visit is recorded with: vessel name, IMO number, flag, registered tonnage, cargo type, port of origin, next port, crew number, passenger number (if applicable), agent name, ETA, ETD, berth assignment, actual arrival and departure

### 29.2 Commercial Dues & Tariffs

- **Pilotage dues** — calculate pilotage charges based on vessel tonnage, distance piloted, and applicable tariff; generate a pilotage invoice per movement
- **Tug dues** — calculate tug charges based on tug type, duration of engagement, and vessel tonnage; generate a tug invoice per engagement
- **Harbour dues / port dues** — calculate harbour dues based on vessel type, registered tonnage (GT or NT), and duration of stay; applicable tariff may vary by flag state (reciprocal agreements) or cargo type
- **Passenger landing dues** — for cruise ship tenders and passenger ferries, calculate dues per passenger disembarked; passenger count recorded per movement; invoice generated per vessel call
- **Cargo handling dues** — for cargo vessels, calculate dues based on cargo type, weight, and handling operations (crane time, stevedore hours)

### 29.3 Harbour Authority Reporting

- **Vessel traffic report** — a structured report of all vessel movements in any period, formatted for submission to the relevant harbour authority or port authority; includes all mandatory fields per the jurisdiction's reporting standard
- **Port State Control flagging** — commercial vessels subject to Port State Control inspection are flagged on their record; inspection history (dates, inspectors, deficiency codes, detentions) logged per vessel
- **DPR (Daily Port Report)** — generate a daily port report listing all vessels in port at midnight, with their status, berthing position, and expected departure

---

## 30. Boater Network & Marketplace Integration

*Currently referenced in `features.md` Module 17.7 as channel manager. This module elevates it to a full network strategy.*

### 30.1 DocksBase Boater Network

- **Network profile** — marinas on DocksBase can opt into a shared boater discovery network; each marina has a public profile visible to registered boaters across the network; boaters see real-time availability and can book any participating marina from a single network portal
- **Guest boater account** — a boater who books one marina via the DocksBase network has a persistent profile that pre-fills their vessel details and preferences at every other marina in the network; eliminates re-entering vessel data at each new marina
- **Reciprocal club flagging** — boaters who are members of partner yacht clubs (RYA, Cruising Association, specific clubs) are automatically recognised across all network marinas; their reciprocal discount is applied at every participating marina without manual verification

### 30.2 Snag-A-Slip Partnership

- **Snag-A-Slip integration** — publish marina availability to Snag-A-Slip (major US marina marketplace); bookings received import as transient reservations; channel is tracked on the booking record; Snag-A-Slip commission is recorded as a deduction against the booking revenue

---

## 31. Integrations — Additional

*Supplements `features.md` Module 17.*

### 31.1 Microsoft Dynamics 365 / Business Central

- Full bidirectional sync of customers, suppliers, invoices, payments, and GL entries; multi-entity support for marina groups; real-time or batch sync configurable; maps DocksBase departments to Business Central dimensions

### 31.2 NetSuite ERP

- Push invoices, receipts, and GL journals to NetSuite via REST API; contact sync; multi-subsidiary support for marina groups running NetSuite as the corporate ERP

### 31.3 Sage Intacct

- AP and AR sync; GL journal posting; multi-entity / location support; period-end close respected in both systems

### 31.4 Rentals United (OTA Channel Manager)

- Publish marina accommodation and charter availability to Rentals United's OTA distribution network; bidirectional availability and rate management; reservation import from connected OTAs (Booking.com, HomeAway, VRBO, PitchUp, Hoseasons)

### 31.5 Dotdigital Marketing Automation

- Customer segment push; email campaign performance pull; journey automation triggered by DocksBase booking events (booking created, contract expiry approaching, birthday)

### 31.6 Play It Green Carbon Offset

- Per-booking offset option at checkout; contribution total pushed to Play It Green platform; offset certificates (sea kelp planting, woodland credits) retrieved and stored in the sustainability module

### 31.7 Continia Document Capture

- Automated supplier invoice OCR and extraction into AP draft; three-way PO matching; approval workflow; relevant to marina groups running Business Central

### 31.8 Worldpay / Opayo / Optomany

- Alternative payment gateway integrations for markets where Stripe is not preferred or available; same functionality as the Stripe integration: online invoice payment, card-present terminal, stored cards, webhook-driven status updates

### 31.9 ClickLearn Training Platform

- Staff onboarding and training content linked to DocksBase workflows; new staff complete guided walkthroughs of key processes (check-in workflow, fuel dock POS, work order creation) with tracked completion; training completion logged against the staff record

### 31.10 Microsoft Teams Integration

- Push operational alerts and booking notifications to a marina's Microsoft Teams workspace as an alternative to Slack; configurable channel routing per alert type

### 31.11 MYOB

- Accounting sync for Australian and New Zealand marinas using MYOB AccountRight or MYOB Business

---

---

# Parallel Implementation Plan

**How to use this plan:**
Each track is a self-contained workstream that can be assigned to an independent AI agent or engineering squad. Tracks share no state at build time — each touches distinct models, services, and UI sections. When assigning work, say: *"You are Agent N. Implement Track N in full. The spec is above."*

Tracks are numbered 1–12. The dependency column is the only constraint — a track marked "needs Track X first" cannot start until Track X's core models are merged. All others can run in parallel from day one.

---

## Track Overview

| # | Name | Scope | Depends on |
|---|---|---|---|
| 1 | Revenue Intelligence & Dynamic Pricing | L | — |
| 2 | Berth Intelligence & Smart Assignment | L | — |
| 3 | Customer Intelligence & Loyalty | L | — |
| 4 | Financial & Accounting Back-Office | XL | — |
| 5 | Boatyard Advanced Features | L | — |
| 6 | Utilities, Smart Metering & Dry Stack Concierge | M | — |
| 7 | Communications, Marketing & OTA Distribution | L | — |
| 8 | Activities & Housekeeping Modules | M | Track 9 (charter task trigger) |
| 9 | Charter, Boat Hire & Commercial Harbour | L | — |
| 10 | Tenants, Berth Marketplace & Boater Network | M | — |
| 11 | Security & Physical Access Control | M | — |
| 12 | Sustainability & ESG | M | — |

---

## Track 1 — Revenue Intelligence & Dynamic Pricing

**One line:** Give the marina a hotel-style yield management layer — dynamic rates, pacing analytics, and AI upsell campaigns.

**Features from this document:** §1.1 Demand-Based Pricing Engine · §1.2 Pacing & Forecasting Reports · §1.3 Upsell & Upgrade Campaigns · §15.1 Revenue Analytics (ADR, RevPAB, heatmaps) · §15.2 Lead Conversion Funnel · §2.3 Part-Day / Hourly Bookings (pricing side)

**Backend models & services to build:**
- `PricingRule` — occupancy threshold, rate multiplier, berth category scope, active date range
- `YieldCalculationService` — evaluates all active pricing rules and returns the current effective rate for a berth/category/date combination; called by the booking wizard before price display
- `PacingSnapshot` — nightly snapshot of confirmed booking volume by category; used to generate pacing curves vs prior year
- `UpsellCampaign` — target segment, source tier, target tier, offer template, valid window, accepted/declined tracking
- Extend `RatePlan` — add floor price, ceiling price, and yield-managed flag
- Extend `BookingType` — add `duration_unit` (nightly / hourly / per-15-min), `min_duration`, `max_duration`

**Frontend screens & components to build:**
- Pricing Rules manager (CRUD table + rule builder form with threshold sliders)
- ADR / RevPAB / Occupancy % widget trio on the Operations Dashboard
- Pacing report screen (current season vs prior season booking curve chart + data table)
- Revenue per linear foot / per berth heatmap (date range × berth grid colour overlay)
- Upsell Campaign builder (segment picker, tier selector, email/SMS template editor, results table)
- Lead conversion funnel chart (booking widget sessions → enquiries → confirmed → paid)
- Hourly booking grid component (15-min slot grid for fuel dock / day berths, reusable)

**Dependencies:** None — builds on top of existing `RatePlan` and `Booking` models.

---

## Track 2 — Berth Intelligence & Smart Assignment

**One line:** Make berth assignment smarter, enable temporary sub-letting of absent holders' slips, and give dock staff a structured dock walk tool.

**Features from this document:** §3.1 AI Smart Slip Assignment · §3.2 Temporary Departure & Sub-let · §3.3 Dock Walk Mobile App · §3.4 Mooring Movement Control · §3.5 Berth Listing for Sale · §2.1 Booking Approval Workflows · §4.1 Vessel Non-Return Alert · §4.2 Departure Notification

**Backend models & services to build:**
- `BerthMatchScore` — scoring function: input (vessel LOA, beam, draft, power requirement, preference) → output (ranked list of available berths with match score and reason codes)
- `SubLetWindow` — linked to berth, annual holder, departure date, return date, opt-in flag, revenue share %
- `SubLetBooking` — transient booking filling a sub-let window; linked to `SubLetWindow`; revenue split calculation on payment
- `VesselMovementEvent` — berth_id, vessel_id, event_type (arrival / departure / inter-berth / haul-out / relaunch), timestamp, staff_id, notes
- `DockWalkSession` — pier_id, staff_id, date, status (in_progress / complete), list of `DockWalkEntry` child records
- `DockWalkEntry` — berth_id, occupancy_confirmed, meter_reading_kwh, meter_reading_water, discrepancy_flag, photo_ids, notes
- `VesselNonReturnAlert` — vessel_id, expected_return, alert_threshold_minutes, escalated_to_incident_flag
- Booking approval gate — add `approval_required` flag to booking type config; add `approval_status` (pending / approved / rejected) and `approver_id` to `Booking`

**Frontend screens & components to build:**
- Smart Assign panel in booking wizard — ranked berth suggestions with match scores and override button
- Sub-let opt-in toggle on member record + revenue share config in marina settings
- Sub-let window calendar on berth detail — shows gap windows and any sub-let bookings filling them
- Dock Walk screen in staff mobile app — pier selector → ordered berth list → per-berth confirm/meter/photo form → sync button
- Vessel Movement Log screen — chronological log filterable by pier, vessel, date; export to PDF
- Expected Movements board — today's arrivals and departures with tick-off buttons
- Non-return alert config on booking type settings + alert notification card in the alert centre
- Booking Approval queue — pending bookings requiring manager sign-off with approve/reject + note

**Dependencies:** None.

---

## Track 3 — Customer Intelligence & Loyalty

**One line:** Add a loyalty programme, make deduplication automatic, capture crew contacts, and close the gap on lead intelligence and customer satisfaction.

**Features from this document:** §5.1 Smart Deduplication · §5.2 Crew & Agent Contacts · §5.3 Aged Debtor SmartNotes · §5.4 Lead Scoring · §5.5 Customer Satisfaction Surveys · §6.1 Tier-Based Loyalty Discounts · §6.2 Loyalty Points · §6.3 Referral Programme

**Backend models & services to build:**
- `DuplicateDetectionService` — on member save, scores similarity against existing records (name fuzzy match, email exact, phone exact, vessel name fuzzy); returns candidate pairs above a threshold
- `MergeMemberWorkflow` — merge two member records; consolidate bookings, invoices, documents, communications; archive secondary record with audit link
- `CrewContact` — name, role (skipper / crew / owner / agent), phone, email, linked to `Vessel`; notification routing flag
- `DebtChaseNote` — invoice_id, staff_id, channel (call / email / SMS), outcome, agreed_payment_date, timestamp
- `LoyaltyTier` — name, colour, min_qualifying_spend, min_qualifying_stays, benefits JSON (discount %, free services, priority flag)
- `LoyaltyMembership` — member_id, current_tier, qualifying_spend_ytd, qualifying_stays_ytd, tier_achieved_date, expiry_rule
- `LoyaltyTransaction` — member_id, type (earn / redeem / expire / adjust), points_delta, source (booking / fuel / restaurant / adjustment), reference_id, timestamp
- `LoyaltyPointsRedemption` — applied to invoice as a credit line item
- `ReferralCode` — member_id, code (unique), benefit_referrer, benefit_referee, usage_count, max_uses, valid_to
- `SatisfactionSurvey` — booking_id, sent_at, responded_at, nps_score, answers JSON, low_score_alert_sent
- `LeadScore` — member_id / lead_id, score (0–100), signals JSON (portal_logins, email_opens, widget_interactions, recency), last_calculated_at

**Frontend screens & components to build:**
- Duplicate alert banner on member save + Merge workflow modal (side-by-side record comparison with field-level selection)
- Crew Contacts tab on Vessel detail — add/edit/remove crew contacts; notification routing toggles
- SmartNotes panel on invoice detail — timeline of chase notes with log-new-note form
- Lead scoring badge on member list and lead pipeline view
- Post-stay survey email template + survey response page (public-facing, no login required)
- NPS trend chart in Analytics section
- Loyalty programme configuration screen (tier editor, points rate config, benefit editor)
- Loyalty status widget on member record — tier badge, progress bar to next tier, points balance, transaction history tab
- Loyalty portal page in customer app — tier card, points balance, redemption button, referral link share
- Referral programme config screen + referral usage report

**Dependencies:** None.

---

## Track 4 — Financial & Accounting Back-Office

**One line:** Complete the accounting stack — payment plans, prepay balances, deferred revenue, department P&L, balance sheet, and the major accounting platform integrations.

**Features from this document:** §7.1 Payment Plans · §7.2 Prepayment & On-Account Credit · §7.3 Convenience Fees & Surcharges · §7.4 Red Diesel / HMRC Fuel Duty · §7.5 Deferred Revenue Recognition · §7.6 Cost Centre Profitability · §26.1 Automated Invoice Capture (AP) · §26.2 Cash Flow Reporting · §26.3 Balance Sheet & P&L · §26.4 Multi-Currency · §26.5 Additional Integrations (Dynamics 365, NetSuite, Sage Intacct, MYOB) · §31.1–31.4, §31.11

**Backend models & services to build:**
- `PaymentSchedule` — contract_id, instalment list (due_date, amount, status, invoice_id); auto-generates invoices on each due date via scheduler
- `OnAccountLedger` — member_id, balance; `OnAccountTransaction` (type: load / deduct / refund, amount, invoice_id, timestamp)
- `DeferredRevenueLedger` — booking_id, total_deferred, recognised_to_date, recognition_schedule (daily / nightly); nightly job posts recognition journal entries to GL
- `CostCentre` — name, department, GL account mapping
- `GLJournal` + `GLJournalLine` — generic double-entry ledger; every invoice, payment, credit note, recognition event, and bank transaction posts here
- `BudgetEntry` — cost_centre_id, period (month), revenue_budget, cost_budget
- `FuelDutyRecord` (UK) — fuel_sale_id, fuel_type, litres, use_type (propulsion / non-propulsion), duty_rate, duty_amount
- `SupplierInvoiceDraft` — OCR-extracted fields; three-way match status; approval workflow state
- `BankStatement` / `BankTransaction` — imported from OFX/CSV; matched to GL entries; reconciliation status
- Currency exchange rate table + `FXGainLoss` GL posting service
- Accounting push adapters: Dynamics 365, NetSuite, Sage Intacct, MYOB (each adapter implements the same `AccountingExportAdapter` interface)

**Frontend screens & components to build:**
- Payment Schedule builder on booking/contract — add instalment rows, set dates and amounts, validate they sum to contract value
- On-Account balance widget on member record — balance display, top-up button (opens payment flow), transaction history list
- Deferred Revenue report screen — schedule table + recognition chart by month
- Cost Centre configuration screen + P&L by department report (revenue, costs, GP, GP%)
- Budget vs Actuals report — monthly table with variance columns and traffic-light indicators
- Balance Sheet screen — assets / liabilities / equity layout, as-of date picker, export to PDF
- Cash Flow report screen — weekly bands, inflow vs outflow bars, running balance line
- HMRC Fuel Duty report screen (UK feature flag gated) — period picker, propulsion vs non-propulsion split table, export
- AP Invoice capture queue — list of OCR-extracted drafts with match status; three-way match panel; approve/reject buttons
- Accounting integrations config screen — connection setup wizard per platform (OAuth flows for Xero already exist; extend pattern to new platforms)
- Multi-currency settings screen — base currency, secondary currencies, exchange rate management

**Dependencies:** None — extends existing GL, invoice, and payment models.

---

## Track 5 — Boatyard Advanced Features

**One line:** Add Gantt project management, task dependencies, boat builder workflows, job package templates, and full manufacturer warranty management to the boatyard module.

**Features from this document:** §8.1 Gantt Chart Project Management · §8.2 Boat Builder & Shipyard Manufacturing · §8.3 Job Packages & Templates · §8.4 Warranty Management Across Manufacturers · §9.1 Automatic Supplier Price File Updates · §9.2 Mobile Service Truck Inventory · §12.1 Upfront Payment for Maintenance · §12.2 Capacity-Managed Maintenance Scheduling

**Backend models & services to build:**
- `WorkOrderTask` — work_order_id, name, assigned_to, start_date, end_date, duration_hours, predecessor_task_ids (array), status; `CriticalPathService` calculates earliest start/finish given dependency graph
- `BuildProject` — a specialised work order type; has `BOM` (bill of materials) child records and `BuildMilestone` stage-payment triggers
- `BOMLine` — build_project_id, part_id or description, quantity, unit_cost, procurement_status (required / on_order / received)
- `JobPackage` — name, category, description; `JobPackageLine` child records (task descriptions with estimated hours by trade, parts list with quantities)
- `ManufacturerWarrantyAgreement` — manufacturer_name, covered_parts_scope, covered_labour_scope, claim_submission_format, reimbursement_rate_labour, reimbursement_rate_parts, avg_processing_days
- `WarrantyClaim` — work_order_id, manufacturer_agreement_id, claimed_labour_amount, claimed_parts_amount, submission_date, status, reimbursement_received, variance_posted_to_cost_account
- `SupplierPriceFile` — supplier_id, last_import_date, file_format (CSV/EDI/API); `SupplierPriceFileJob` — scheduled import; updates `Part.unit_cost` for matching SKUs; flags large increases for review
- `InventoryLocation` — extend with `location_type` (warehouse / truck / vessel / remote_site); `StockTransfer` between locations
- `MaintenanceCapacitySlot` — team_id, date, available_hours, allocated_hours (computed from open tasks); used by the batch scheduler to distribute tasks across available days

**Frontend screens & components to build:**
- Gantt chart component on Work Order detail — horizontal bar timeline with drag-to-reschedule, dependency arrows, critical path highlight, baseline overlay
- Task dependency editor — link tasks with predecessor relationships; cycle detection warning
- Build Project screen — BOM editor, milestone table with stage payment trigger config, Gantt view
- Job Packages catalogue screen — list, search, CRUD editor; "Apply to Work Order" button from within WO creation
- Batch job posting modal — multi-WO selector, time/materials entry form applied to all selected WOs simultaneously
- Manufacturer Warranty Agreements screen — list and CRUD; linked warranty claims list per agreement
- Warranty Claim workflow — claim form pre-populated from WO, status tracker, reimbursement recording
- Supplier Price File import screen — upload trigger, import log, flagged increases review table
- Inventory Locations screen — add truck/remote locations; transfer stock form
- Maintenance Batch Scheduler — date range picker, asset type filter, team capacity view, drag-assign to available slots

**Dependencies:** None.

---

## Track 6 — Utilities, Smart Metering & Dry Stack Concierge

**One line:** Automate utility reading via IoT integrations, add prepay utility billing and bollard control, and give dry stack operations a concierge valet layer and a purpose-built forklift tablet UI.

**Features from this document:** §10.1 Smart Meter IoT Integration · §10.2 Utility Prepayment via Portal · §10.3 Service Bollard Management · §10.4 Wash Token Management · §11.1 Forklift Operator Tablet Interface · §11.2 Concierge Pick-Ticket / Valet Services · §11.3 No-Show Prevention · §31.6 (smart meter integration partners)

**Backend models & services to build:**
- `SmartMeterDevice` — berth_id, device_id, protocol (M-Bus / Modbus / cloud API), vendor (Rolec / Metron / MarineSync / Ampy), polling_interval_minutes, last_polled_at, last_reading_kwh, last_reading_litres, status (online / offline)
- `SmartMeterPollJob` — scheduled per device; calls vendor API or local bus; creates `MeterReading` record; triggers anomaly check; raises `MeterOfflineAlert` if missed
- `UtilityPrepayBalance` — member_id / berth_id, balance_pence, currency; `UtilityPrepayTransaction` (type: top_up / charge / alert_sent)
- `ServiceBollard` — berth_id, bollard_id, supply_capacity_amps, phase (single/three), remote_switch_capable, current_state (on/off/fault), last_switched_at, switched_by
- `BollardSwitchEvent` — audit log of every remote on/off command
- `WashToken` — token_code, facility_type (shower / laundry / carwash), value_pence, issued_to_member_id, issued_at, redeemed_at, expiry_at
- `ConciergeCatalogue` — service items (wash, fuel top-up, battery charge, ice, provisioning, engine warm-up) with price, estimated_prep_minutes, requires_fuel_dock_flag
- `PickTicket` — launch_request_id, items list of `PickTicketItem`, assigned_to, status (pending / in_progress / complete), completed_at
- `ForkLiftAssignment` — launch_request_id, operator_staff_id, equipment_id, start_time, action (launch / retrieve / put_away / leave_out), yard_position_from, yard_position_to, completed_at
- `LaunchNoShow` — launch_request_id, vessel_launched_at, owner_arrival_deadline, no_show_declared_at, fee_charged

**Frontend screens & components to build:**
- Smart Meter device registry screen — list, add/edit device, last reading display, online/offline status badge
- Smart Meter dashboard — all berths with current readings, anomaly flags, hourly trend sparklines
- Utility Prepay widget on member record — balance display, top-up form; customer portal top-up page
- Service Bollard board — grid of bollards with on/off/fault status; remote switch toggle; switch history log
- Wash Token management — token batch generator, sales counter, redemption log, revenue report
- Concierge Catalogue editor — CRUD for valet services; price and prep time config
- Pick-Ticket builder in Launch Request — valet services checklist; assigned staff selector
- Pick-Ticket fulfilment view for dock staff — checklist with complete toggles; photo attachment
- Forklift Tablet UI — full-screen, large-font view showing one assignment at a time: vessel name, position, action, pick-ticket items; "Done" button advances to next; designed for gloved hands
- No-show config in marina settings — grace period minutes, fee amount; no-show fee applied to account automatically

**Dependencies:** None.

---

## Track 7 — Communications, Marketing & OTA Distribution

**One line:** Add WhatsApp, multi-channel journey automation, A/B testing, coupon codes, OTA channel distribution, and a website booking widget.

**Features from this document:** §14.1 WhatsApp Channel · §14.2 Multi-Channel Customer Journeys · §14.3 Slack Integration · §14.4 Dotdigital Integration · §14.5 A/B Testing · §15.2 Lead Conversion Funnel · §15.3 Multi-Site Performance Comparison · §23.4 Boater Marketplace Discovery (review management part) · §28 Website, Digital Marketing & OTA Distribution (all sub-sections) · §31.5 Dotdigital · §31.10 Microsoft Teams

**Backend models & services to build:**
- `WhatsAppTemplate` — template_name, meta_template_id, body, category (transactional/marketing), approval_status; `WhatsAppMessage` send/receive log
- `CustomerJourney` — name, trigger_event (booking_confirmed / contract_expiring / invoice_overdue / custom), steps array; each step: channel, template_id, delay_days, condition (if previous step not actioned)
- `JourneyEnrolment` — journey_id, member_id, current_step, enrolled_at, completed_at, outcome
- `ABTest` — campaign_id, variant_a_subject, variant_b_subject (or body), split_percentage, hold_hours, winner_picked_at, winner_variant
- `CouponCode` — code, discount_type (percent/fixed), discount_value, applicable_charge_types, min_stay_nights, valid_from, valid_to, max_uses, use_count
- `OTAChannel` — name, channel_type (Rentals United / PitchUp / Hoseasons / Snag-A-Slip / custom), credentials, active_berth_categories, commission_rate, last_sync_at
- `OTABookingImport` — inbound webhook handler; creates `Booking` from OTA payload; maps channel fields to DocksBase schema
- `AvailabilityPushJob` — on every berth status change, push updated availability to all active OTA channels
- `BookingWidget` — marina_id, theme config, enabled_categories, extras_config, published_domain; generates embeddable JS snippet
- `ReviewRequest` — booking_id, sent_at, response_url, platform (Google/Tripadvisor/Dockwa), responded_at, score
- `MarinaCoupon` — front-facing coupon model; validated at booking wizard checkout; discount applied as line item
- Slack/Teams webhook publisher — maps internal alert types to Slack/Teams message payloads; configurable channel routing

**Frontend screens & components to build:**
- WhatsApp Template manager — list approved templates; submit new template for Meta approval; preview rendered message
- Customer Journey builder — trigger selector, drag-and-drop step chain, channel and template per step, condition editor; live enrolment count display
- Journey analytics dashboard — per-journey funnel: enrolled → each step completed → outcome achieved; channel-level open/response rates
- A/B test config on bulk email compose screen — enable toggle, variant B subject/body field, split %, hold time
- Coupon Code manager — CRUD + usage report (uses, discount granted, revenue attributed)
- OTA Channel config screen — connect/disconnect channels, credential entry, berth category mapping, commission config, last sync status
- OTA Distribution dashboard — per-channel: bookings received, revenue, commission paid, availability sync status
- Booking Widget config screen — theme editor (colour, logo, button text), extras config, preview iframe, JS snippet copy button
- Review Management screen — pending review requests, responses received, aggregate ratings by platform, negative review alert list
- Lead Conversion Funnel report — funnel chart with drop-off percentages, segmented by booking channel
- Multi-Site Comparison dashboard — KPI grid (occupancy, ADR, revenue, NPS) with per-marina columns, sortable

**Dependencies:** None.

---

## Track 8 — Activities & Housekeeping Modules

**One line:** Add bookable activities and experiences (paddleboarding, lessons, equipment hire) and a housekeeping management module for charter and accommodation turnovers.

**Features from this document:** §18 Activities & Experience Booking (all) · §20 Housekeeping (all)

**Backend models & services to build:**
- `Activity` — name, category, description, duration_minutes, capacity_min, capacity_max, min_age, price_per_person, prices_by_type JSON (member/guest/child), seasonal_window, photo, requires_instructor_flag, required_equipment_ids
- `ActivityResource` — instructor_staff_id or equipment_asset_id, linked to `Activity`; availability drawn from staff rota or asset register
- `ActivityBooking` — activity_id, customer_id, date, time_slot, participant_count, participant_breakdown JSON, extras, total_price, status, invoice_id
- `ActivityCancellationPolicy` — linked to `Activity`; rules (hours_before → refund_percent)
- `HousekeepingTask` — source_type (charter_checkout / accommodation_checkout / on_demand / recurring), source_id, unit_type, unit_id, triggered_at, target_ready_by, assigned_to_staff_id, checklist items, status (dirty / in_progress / ready_for_inspection / clean), completion_photos
- `LinenInventory` — unit (set type), location (vessel_id / unit_id / laundry), quantity_clean, quantity_dirty; `LinenTransaction` (used / washed / damaged / stock_take)
- `ConsumableStock` — item_name, location, quantity, par_level; depleted per housekeeping task; triggers replenishment alert

**Frontend screens & components to build:**
- Activities Catalogue screen — list with category filters, search; CRUD editor; seasonal window config; capacity config; pricing by type table
- Activity Booking screen — calendar picker, time slot grid, participant count and type entry, extras selector, price preview, confirm
- Activity booking management — list view with filters; check-in / mark complete; cancellation with refund calculation
- Activity calendar view for staff — day/week view; resource overlay (instructor, equipment); colour by status
- Housekeeping Matrix dashboard — grid: rows = units/vessels, column = date; cell = status colour (dirty / in progress / clean / ready); click cell to open task detail
- Housekeeping mobile screen (staff app extension) — task card with checklist, photo capture, before/after toggle, complete button, defect escalation shortcut
- Linen Inventory screen — current stock by location; dirty vs clean split; trigger laundry task button; stock-take entry form
- Consumable stock screen — list by location; par-level config; depletion log; replenishment request button

**Dependencies:** Track 8 is largely independent. The auto-generate-from-charter-checkout trigger (§20.1) requires the `CharterBooking` model from Track 9, but Track 8's core can be built without it — the trigger is wired in after both tracks merge.

---

## Track 9 — Charter, Boat Hire & Commercial Harbour

**One line:** Add a complete charter booking system with OTA distribution and commission tracking, short-term boat rental management, and commercial harbour dues for port-adjacent marinas.

**Features from this document:** §19 Charter & Boat Hire Management (all) · §27.2 Charter Agent Commission · §27.3 Boat Rental Management · §29 Commercial Harbour Management (all)

**Backend models & services to build:**
- `CharterVessel` — extends `Vessel`; adds: hourly_rate, daily_rate, weekly_rate, fuel_inclusive_flag, skipper_required, min_charterer_qualification, cleaning_fee, security_deposit_amount, owner_type (marina_owned / third_party), commission_rate (for third-party)
- `CharterBooking` — vessel_id, charterer_member_id, skipper_staff_id, start_dt, end_dt, duration_unit, rate_applied, fuel_terms, cleaning_fee, deposit_amount, deposit_status, total_price, agreement_signed, status, invoice_id
- `CharterAgreement` — charter_booking_id, template_id, signed_pdf_url, signed_at, charterer_signature_ip
- `CharterAgentCommission` — booking_id, agent_contact_id, commission_rate, commission_amount, payment_status
- `RentalUnit` — name, vessel_type (electric day boat / pedal boat / kayak / paddleboard / dinghy), hourly_rate, half_day_rate, full_day_rate, capacity_persons, status
- `RentalBooking` — unit_id, customer_id (or walk-in name), start_time, end_time, total_price, deposit, status, invoice_id
- `CommercialVesselMovement` — vessel_id, imo, flag, gross_tonnage, net_tonnage, cargo_type, crew_count, passenger_count, agent_contact_id, eta, etd, actual_arrival, actual_departure, berth_id, status
- `HarbourDueTariff` — vessel_type, tonnage_band_min, tonnage_band_max, rate_per_gt, rate_per_nt, minimum_charge, flag_state_exception
- `HarbourDueInvoice` — movement_id, due_type (pilotage / tug / harbour / passenger_landing / cargo_handling), calculated_amount, tariff_applied, invoice_id
- `PortStateControlRecord` — vessel_id, inspection_date, inspector, deficiency_codes, detention_flag, cleared_date

**Frontend screens & components to build:**
- Charter Fleet screen — list of charter vessels with status (available / booked / maintenance); quick-add charter booking button
- Charter Booking wizard — vessel selector, date/time picker with hourly support, skipper assignment, rate preview, deposit collection, agreement send button
- Charter booking management — list view; agreement status indicator; skipper assignment; deposit release / damage deduction workflow
- Charter fleet availability calendar — Gantt-style horizontal calendar per vessel; bookings shown as coloured bars
- Boat Rental drag-and-drop calendar — all rental units on Y-axis, dates on X-axis; drag to create / resize bookings; colour by status
- Rental booking quick-create modal — unit pre-selected from calendar click; customer lookup; duration; price display; payment
- Commercial Vessel Movements screen — list of all arrivals and departures; create/edit movement record; status tracker
- Harbour Dues calculator — select movement, select due type, display calculated amount based on tariff; generate invoice button
- Tariff management screen — CRUD for `HarbourDueTariff` entries by vessel type and tonnage band
- Port State Control log screen — per-vessel inspection history; deficiency codes; detention flag display
- Vessel Traffic Report export — period picker, format selector (PDF / CSV), submit to harbour authority button

**Dependencies:** None.

---

## Track 10 — Tenants, Berth Marketplace & Boater Network

**One line:** Add commercial unit tenancy management, a berth-for-sale/exchange marketplace, and the public boater network discovery layer.

**Features from this document:** §21 Tenants & Commercial Lettings (all) · §22 Berth Marketplace & Sub-let (listing/sale/exchange) · §30 Boater Network & Marketplace Integration · §23.4 Boater Marketplace Discovery (public profile side) · §31 Snag-A-Slip (§30.2)

**Backend models & services to build:**
- `CommercialUnit` — unit_id, name, type (chandlery / workshop / office / storage / retail / parking / kiosk), area_sqm, facilities JSON, current_tenancy_id
- `Tenancy` — unit_id, tenant_contact_id, start_date, end_date, rent_amount, rent_frequency, service_charge, deposit_amount, break_clause_date, notice_period_days, rent_review_dates, permitted_use
- `TenancyInvoice` — auto-generated by scheduler on rent_frequency cycle; linked to `Tenancy`
- `BerthListing` — berth_id, listing_type (for_sale / exchange), asking_price_or_terms, licence_transfer_terms, listed_by_member_id, listed_at, status (active / under_offer / sold / withdrawn), photos
- `BerthEnquiry` — listing_id, enquirer_member_id, message, sent_at, status
- `BerthExchange` — proposing_member_id, proposing_berth_id, seeking_marina, seeking_period, status; `BerthExchangeAgreement` — match record linking two `BerthExchange` records; both berths blocked in calendar
- `PublicMarinaProfile` — marina_id, tagline, photos, facilities tags, public_rates_summary, booking_enabled_flag, aggregate_review_score, review_count
- `BoaterNetworkProfile` — member_id (global), vessels, preferred_home_marina, past_marinas visited — cross-marina guest identity layer
- `SnagASlipChannel` — OTA channel adapter for Snag-A-Slip; inherits `OTAChannel` interface from Track 7

**Frontend screens & components to build:**
- Commercial Units screen — floor plan list with unit cards; status (vacant / tenanted); quick-add tenancy button
- Tenancy detail screen — lease terms, document vault tab, rent invoice history, rent review timeline, payment status
- Tenancy invoice schedule — calendar showing upcoming rent due dates; generate-now button; payment status per instalment
- Berth Marketplace screen (staff view) — list of active berth listings; enquiries per listing; mark as sold workflow
- Berth Listing creation form — dimensions auto-filled from berth record; price/terms entry; photo upload; publish toggle
- Berth Exchange board — list of exchange proposals; match browser (filter by marina / period); exchange agreement send
- Public Marina Profile editor — tagline, photo management, facilities checklist, booking widget toggle, preview button
- Boater Network opt-in settings for marina (join/leave network, availability publication scope)
- Snag-A-Slip channel config (follows Track 7's OTA config pattern)

**Dependencies:** Snag-A-Slip integration follows the `OTAChannel` interface from Track 7, but can be built independently and wired together at merge.

---

## Track 11 — Security & Physical Access Control

**One line:** Add full RFID multi-reader access control, ANPR car park integration, searchable CCTV event linkage, biometric authentication, and fraud prevention authorisation workflows.

**Features from this document:** §24.1 RFID / Contactless Access Control · §24.2 ANPR · §24.3 Searchable CCTV · §24.4 Biometric Authentication · §24.5 Fraud Prevention & Authorisation Workflows

**Backend models & services to build:**
- `AccessReader` — reader_id, location_label, zone_id, hardware_type (RFID / NFC / ANPR / biometric), IP_address, last_heartbeat
- `AccessZone` — name, description; membership types to zones: `ZoneAccessRule` (membership_type → zones array)
- `AccessCard` — extend existing with multi_card_per_member support; card_number, member_id, sub_type (owner / crew / family / contractor), active, zones_override (null = use membership rule), valid_from, valid_to
- `AccessEvent` — reader_id, card_id or plate or face_id, timestamp, granted (bool), denial_reason; indexed for fast search
- `ANPRCamera` — camera_id, location, zone_id, last_frame_at
- `VehicleRegistration` — member_id, plate_number, make, model, colour; up to config max per member
- `ANPREvent` — camera_id, plate_detected, matched_member_id (null if unrecognised), timestamp, access_granted
- `SpendAuthorisationRule` — role_id, action_type (discount / write_off / refund / override), threshold_amount, requires_approver_role
- `SpendAuthorisationRequest` — action_type, amount, requested_by_staff_id, approver_staff_id, approved_at, denied_at, note
- `FraudAnomalyAlert` — type, staff_id, period, count, threshold_exceeded, sent_at, resolved_at
- Biometric template store — encrypted biometric hash per member/staff (no raw biometric data stored); match service interface (hardware-vendor SDK integration point)

**Frontend screens & components to build:**
- Access Readers screen — list of all readers with zone assignment, online/offline status, last heartbeat
- Access Zone manager — zone CRUD; membership type → zone assignment matrix
- Member Access Cards tab — list of cards per member; activate/deactivate; zone override editor; issue new card form
- Vehicle Registration tab on member record — plate list with add/edit/remove; ANPR match history
- Access Log screen — real-time scrolling event feed with filters (zone, reader, member, time range, granted/denied); export to CSV
- ANPR event log — plate-recognised events; unrecognised plate queue for review; match to member button
- CCTV camera registry screen — camera list; event-linked footage viewer (timestamp + camera → jump to clip)
- Biometric enrolment flow (staff app and customer app) — guided face scan; confirmation of template stored
- Fraud anomaly alerts screen — current alerts with drill-down to underlying transactions
- Spend Authorisation request flow — triggered inline when a staff action exceeds a threshold; approver receives push notification; approve/deny modal with note; audit trail

**Dependencies:** None.

---

## Track 12 — Sustainability & ESG

**One line:** Add a full emissions tracking and sustainability reporting suite covering Scope 1/2/3, waste logging, and board-grade ESG disclosure.

**Features from this document:** §25 Environmental, Sustainability & ESG (all) · §2.2 Carbon Offset at Booking · §31.6 Play It Green Integration · §15.4 ESG Reporting in Analytics

**Backend models & services to build:**
- `EmissionFactor` — fuel_type or energy_type, kg_co2e_per_unit, unit (litre / kWh), jurisdiction, valid_from, valid_to, source (DEFRA / EPA / grid API)
- `GridCarbonIntensityFeed` — scheduled job pulling grid intensity (g CO₂/kWh) from national grid API (NGESO for UK, EPA eGRID for US); stores daily average per marina region
- `Scope1Record` — source (vehicle_fuel / machinery_fuel / workboat_fuel), fuel_type, quantity_litres, date, emission_factor_id, co2e_kg
- `Scope2Record` — period, purchased_kwh, grid_intensity_gco2_per_kwh, co2e_kg; auto-calculated from utility module electricity costs
- `Scope3Record` — category (fuel_sold_to_vessels / supplier_delivery / staff_commute), quantity, unit, emission_factor_id, co2e_kg, source_reference
- `WasteLog` — date, category (general / recycling / hazardous / antifouling / bilge_oil / pump_out), quantity_kg_or_litres, disposal_method, waste_carrier, disposal_note
- `SustainabilityLedger` — period (month), scope1_co2e, scope2_co2e, scope3_co2e, total_co2e, revenue_for_period, berth_nights_for_period, co2e_per_gbp_revenue, co2e_per_berth_night; computed monthly by scheduled job
- `OffsetContribution` — booking_id or batch_id, offset_partner (Play It Green), amount_gbp, units_purchased (fronds / credits), certificate_url
- `PlayItGreenSync` — periodic push of total contribution to Play It Green API; pulls back certificate and offset unit count

**Frontend screens & components to build:**
- Sustainability Dashboard — current year Scope 1/2/3 totals in tCO₂e; prior year comparison; intensity metrics (per £ revenue, per berth-night); reduction target progress bar
- Emissions configuration screen — emission factor library (CRUD per fuel/energy type); grid intensity source selection; Scope 3 category enable/disable
- Scope 1 data entry screen — log vehicle/machinery fuel purchases with fuel type and quantity; auto-calculates CO₂e
- Scope 2 auto-calculation display — shows electricity consumption from utility module × grid intensity; override input for manual correction
- Scope 3 data entry screen — by category; link to fuel dock sales totals (auto-populated from fuel module) or manual entry
- Waste Log screen — log entries with category and quantity; diversion rate chart (landfill vs diverted); waste trend over time
- Sustainability Ledger screen — monthly table of all scope totals and intensity metrics; chart view
- ESG Report generator — period picker; framework selector (GRI / TCFD / narrative); generate PDF button; report preview with narrative + data tables
- Carbon offset config in Booking settings — per-night offset amount, partner selection, display text for customer booking screen
- Play It Green dashboard tile — total contributions, total units purchased, certificates gallery
- Offset contribution report — per booking breakdown of contributions; total by period

**Dependencies:** Scope 2 auto-calculation reads from the utility module electricity consumption data (existing in `features.md` Module 7). Scope 3 fuel sold to vessels reads from fuel dock sales (existing). Both data sources already exist — this track only adds the calculation and reporting layer on top.

---

## Execution Notes for AI Agents

1. **Read the full spec first.** Before writing any code, read all sections of this document that relate to your track. The feature descriptions above each section are the authoritative spec.

2. **Follow existing patterns.** All 12 tracks extend a shared Django/React codebase. Before creating a new model, check whether a base model already exists (e.g. `Booking`, `Invoice`, `Member`, `Vessel`, `Asset`). Extend before creating.

3. **Backend first.** Build and test all models, serializers, and API endpoints before building frontend components. Use the existing URL structure (`/api/v1/<module>/`).

4. **Feature-flag every track.** Wrap each new module in a `marina.features` flag (e.g. `loyalty_enabled`, `charter_enabled`, `esg_enabled`). Marinas that don't need the module don't see it.

5. **Test coverage.** Every new model needs at minimum: a creation test, a validation test, and a permission test (staff role cannot access admin-only endpoints). Every new API endpoint needs a response-shape test.

6. **Do not break existing tests.** Run the full test suite before marking your track complete. If your model changes affect an existing model, update the relevant existing tests.

7. **Dependency handshake.** If your track has a soft dependency on another track (e.g. Track 8 wires housekeeping task generation to Track 9's `CharterBooking`), implement the wiring as a conditional block guarded by a feature flag. The feature enables silently if the dependent model doesn't exist yet.

---

*End of DocksBase Feature Expansion v1.0 — Plan appended 2026-05-07*
