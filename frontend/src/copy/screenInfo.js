export const SCREEN_INFO = {
  overview: `Today at your marina. Arrivals and departures for the day, current occupancy, pending payments, and open tasks across booking, maintenance, and housekeeping.

Use this as your daily starting point — most cards link directly to the screen where you can act. Pending booking requests appear here so you can confirm or reject them without navigating away.`,

  map: `Visual and calendar views of your berths. The Berth Calendar tab shows a timeline of which vessel occupies each berth and when — good for spotting gaps and planning moves. The Map tab shows real-time status with colour-coded availability.

Clicking a berth on the map highlights it in the calendar and vice versa. Status colours: green = available, blue = occupied, gold = reserved, red = maintenance.`,

  reservations: `All bookings in one place — transient (short-stay) and seasonal (long-stay), plus pending requests from boaters who applied online.

The Pending tab shows requests that haven't been confirmed yet; they hold capacity but don't assign a specific berth until you confirm. The Requests tab surfaces applications that came in via your booking portal or OTA channels. Use the calendar sub-tab for a visual berth timeline.`,

  vessels: `Registry of every vessel your marina knows about, with dimensions, flags, AIS transponder numbers, and owner links. Also tracks insurance policies and safety equipment expiry dates.

The Insurance Tracker flags policies approaching expiry. The Safety Equipment tab lists each certificate per vessel — red means expired, orange means due within 60 days.`,

  boatyard: `Haul-out scheduling, dry storage, work orders, parts, tools, contractors, and lift operations — the full land-side workflow.

Schedule a lift from the Haul-out Schedule tab. Once a vessel is ashore it appears in Dry Storage where you can assign it to a slot. Work orders track jobs against specific vessels and can be raised directly from the Defect Log in Maintenance.`,

  maintenance: `Staff task board, maintenance work orders, incident reports, asset register, and defect log for the marina's own infrastructure.

Staff Tasks are quick jobs assigned to crew (cleaning, security rounds). Maintenance Tasks are more structured, tracked through a Kanban board from pending to complete. If a defect is found on a marina asset, raise a task directly from the defect entry.`,

  staff: `Directory of your marina staff with roles, contact details, contract type, and certifications. Also includes the weekly rota.

Invite new staff members from the Directory tab — they receive an email to set their password. The Rota tab shows a 7-day schedule per person; click any cell to add a shift. Certifications can be attached with PDF uploads and status is tracked automatically by expiry date.`,

  billing: `Invoices, boater account balances, payment plans, utility meter readings, and aged debtor reporting.

Issue an invoice from the Invoices tab — it pulls items from your Service Catalog. The Boater Accounts tab shows each member's running balance and lets you record ad-hoc payments. Batch billing at month-end generates invoices for all seasonal berth holders in one click.`,

  reports: `Occupancy, revenue, and berth utilisation reports for the current period.

The Occupancy tab shows arrivals and departures today plus a per-pier breakdown. Revenue shows monthly income split by category (berth, utility, service, retail). Berth Utilisation lets you export a CSV of how many days each berth was occupied this month — useful for benchmarking and board reporting.`,

  members: `Your marina's member list — boaters with seasonal berths, club memberships, or stored vessels. Each member has a financial snapshot (outstanding balance, last payment) and a document vault for contracts.

The portal link button sends a magic-link login so a member can view their own account online. The Documents tab stores signed waivers and berthing agreements per member.`,

  restaurant: `Point-of-sale and floor management for the marina restaurant or café.

Floor Plan shows table status in real time — click a table to seat a party or see what's ordered. The Menu tab lets you manage sections and items. Live Orders shows the kitchen display. POS / Bills handles splitting and settling tabs. Note: table data in this demo is seeded and not backed by a live API.`,

  events: `Events you host at the marina — regattas, sunset cruises, kids' sailing days — plus hireable spaces like function rooms and pontoons.

The Events tab lists upcoming events with booking counts. The Venue Hire tab lets you configure which spaces are available, their capacity, and pricing. Bookings for both flow into your billing system as service-catalog line items.`,

  settings: `Marina profile, staff accounts, subscription, Stripe payment gateway, OTA connections, and accounting integrations.

The Marina tab holds core identity (name, logo, location, currency, capacity). The Integrations tab is where you connect Xero, QuickBooks, NetSuite, or Sage Intacct for ledger sync. Stripe connects your card terminal and online payment collection. Changes here affect the whole system.`,

  documents: `Document templates (waivers, berthing agreements) and envelope tracking for e-signatures.

Upload a PDF template in the Templates tab and mark signature fields. Send it to individual members from the template list, or use Mass Send to dispatch it to many members at once. The Envelopes tab tracks signature status — pending, signed, or declined.`,

  sales: `Boat sales inventory, CRM pipeline for enquiries, and brokerage listings for vessels consigned by owners.

The Inventory tab lists boats your marina owns or brokers for sale, with photos and pricing. The Pipeline tab is a lightweight CRM — move enquiries through stages from first contact to deposit. Brokerage tracks commission-based listings separately from marina-owned stock.`,

  operations: `Fuel dock management, live queue, and point-of-sale for fuel and dockside services.

The Fuel Dock tab shows vessels currently waiting for fuel in order of arrival. You can record a quick sale directly against a vessel or boater account. Recent Fuel Sales gives a running log of today's transactions. Other operational tabs cover additional dockside services.`,

  infrastructure: `The physical fabric of your marina — berths, piers, and the interactive map builder.

The Berths tab is the master list of every slip with its dimensions, type, and operational status. Piers lets you define logical groupings of berths. The Map tab opens the drag-and-drop editor where you draw your marina layout — berths placed here appear on the live map and calendar.`,

  serviceCatalog: `The price list for everything you sell — berth nightly rates, utility charges, activities, fuel, and retail items.

Items here are referenced when raising invoices and in the booking portal's rate calculator. The Berth Rates tab lets you assign rate tiers by berth category or individual berth. Changes take effect immediately on new bookings but do not retroactively alter existing invoices.`,

  channels: `Controls which booking sources feed reservations into your berths — your own portal and any OTA partners such as mySea.

Two allocation modes exist per OTA connection. Auto Tetris shares remaining inventory evenly across all auto-allocated connections. Manual lets you set an exact target percentage for each connection. You can mix the two: manual targets are honoured first, then Auto Tetris divides what's left. A connection at 0% with no Auto Tetris receives no berths and no bookings will sync from it.`,

  activities: `Public-facing activities you sell to boaters — paddleboard rentals, lessons, guided trips — plus the housekeeping side: cleaning tasks, schedules, and the staff board.

Bookings come in two flavours. Manager-created bookings (from the Bookings tab) land confirmed and reserve assets immediately. Public requests (from the Requests tab) are pending until you confirm them — they count against capacity but don't reserve assets, so rejecting a request doesn't pin a kayak.`,

  revenueIntelligence: `Dynamic pricing tools — booking tiers, yield rules, hourly rate configuration, promotional campaigns, and competitor rate tracking.

Booking Tiers let you define price bands (e.g., peak, shoulder, off-season). Yield Rules apply automatic adjustments based on occupancy thresholds. Campaigns can layer discounts or premiums on top of base rates for a defined period. Competitor tracking is a placeholder for future integration with external rate-monitoring services.`,

  berthIntelligence: `A live occupancy dashboard broken down by berth category and operational type — standard, charter, dry-stack, and so on.

KPI cards at the top show total, available, occupied, reserved, and maintenance counts with percentages. The breakdown charts help you see which categories are under- or over-utilised so you can adjust allocations. Data is read-only here; make structural changes in Infrastructure.`,

  loyalty: `The marina's loyalty programme — points tiers, earning rules, redemption options, and member status tracking.

Loyalty Tiers define point thresholds and perks (e.g., Silver at 500 pts = 5% berth discount). The Member Status tab shows each boater's current tier and point balance. The Points Ledger gives an audit trail of every earn and redeem event. Referral tracking is also here.`,

  accounting: `General ledger, chart of accounts, cost centres, accounts-payable workflow, supplier management, and export to your external accounting system.

Journal Entries shows double-entry records generated automatically from invoices and payments. Chart of Accounts lets you map DocksBase categories to your accounting codes. The Payables tab manages supplier invoices through approval, and Sync pushes approved transactions to Xero, QuickBooks, or Sage.`,

  utilities: `Utility service bollards (electricity and water), wash-token dispensers, and OFGEM compliance reporting for marinas in Great Britain.

The Meters tab tracks electricity consumption per berth for billing purposes. Bollards shows live connection status per service pedestal. Wash Tokens manages token issuance and redemption. The OFGEM tab generates the regulatory report required for electricity resale compliance — exported as a PDF.`,

  communications: `Email templates, automated journey triggers, and audience segments for communicating with boaters.

The Templates tab holds reusable email layouts (arrival reminders, invoice notices, seasonal renewal prompts). Journeys link templates into multi-step sequences triggered by events like check-in or membership expiry. Segments let you filter your member list to target specific groups with tailored messages.`,

  charter: `Charter fleet management, bookings for marina-owned vessels, harbour dues for visiting commercial ships, shipping agents, and vessel calls.

The Fleet tab lists vessels the marina owns and rents out. Bookings manages individual charter reservations. Harbour Dues tracks port fees for cargo and cruise ship calls. Agents manages the shipping agent relationships that handle commercial vessels arriving at the marina.`,

  tenants: `Commercial lettings inside the marina — boatyard units, chandleries, cafés — plus a marketplace for berth subleasing between members.

The Units tab lists physical commercial spaces with current tenants and lease terms. Tenancies tracks active agreements with rent amounts and review dates. Rent Schedule shows upcoming payment milestones. The Marketplace lets berth holders list their berth for short-term sublease and take enquiries from other boaters.`,

  accessControl: `Physical security management — access zones, key cards, card readers, ANPR cameras, CCTV feeds, spend authorisation, and fraud alerts.

Zones define areas of the marina (main gate, fuel dock, private jetty) with which card types can enter. Cards tab lets you issue, suspend, or cancel access cards per person. Access Log shows a timestamped history of every gate event. ANPR and CCTV tabs are placeholders for future hardware integrations.`,

  sustainability: `Carbon footprint tracking and ESG reporting — Scope 1 (direct fuel), Scope 2 (electricity), and Scope 3 (fuel sold to vessels and supply chain).

Enter monthly fuel consumption and electricity readings to build your emissions ledger. The Carbon Offsets section links to Play It Green for purchasing verified offset credits. The ESG Report tab generates a PDF summary suitable for investor reporting or compliance submissions. This module must be enabled in Settings before it appears.`,
};
