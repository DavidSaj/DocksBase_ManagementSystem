# DocksBase — Future Platform Features

**Document version:** 1.0
**Date:** 2026-04-24
**Status:** Roadmap
**Source:** Competitive analysis against Dockmaster (dockmaster.com) and general marina software landscape

---

## Purpose

This document lists features and capabilities identified during competitive analysis that **cannot be implemented in the DocksBase web frontend alone**. They require one or more of the following: a production backend API, native mobile apps (iOS/Android), hardware integrations, third-party AI services, or payment gateway infrastructure.

These are not descoped — they are planned for future development phases once the backend and app platforms are built.

---

## 1. Native Mobile Apps

### 1.1 Staff Field App (PWA / Native)

A dedicated mobile application for dock staff, yard technicians, fuel dock operators, and maintenance personnel. Referenced in features.md Module 14.3.

**Cannot implement in current web-only frontend because:**
- Requires persistent offline storage (IndexedDB / SQLite) with automatic sync on reconnect
- Requires native push notifications (FCM / APNs)
- Requires device camera access for in-field photo capture on work orders and incidents
- Requires barcode/QR scanner hardware access (camera API + ML barcode detection)
- Geofencing requires native geolocation APIs running as a background service
- Cannot guarantee reliable background sync in a browser tab

**Detailed capability list (from Dockmaster Mobile analysis):**

| Feature | Description |
|---|---|
| One-click clock in/out | Time clock with live running timer; validates against geofence before allowing clock-in |
| Geofencing | Configurable centre point + radius around the marina; clock-in/out restricted to within the fence; violations logged with GPS coordinates and timestamp |
| Schedule view | 6 AM–6 PM timeline showing all assigned jobs for the day; colour-coded by status and job type |
| Time card review | Daily summary showing WO numbers, operations, customer names, hours logged per entry |
| Manual time entry | Retroactive time logging in hours-only or start/stop mode; validates against open work orders |
| Vessel search | Look up vessel by name, owner name, or HIN; shows dimensions, propulsion, current location, service history |
| Parts checkout | Barcode scanner mode for hands-free inventory lookup; text search fallback; quantity tracking with price total shown |
| Photo/file attachments | Capture photos or upload files (up to 50 MB) directly to a work order or incident report; optional description field per attachment; GPS and timestamp embedded |
| Offline-first | Previously loaded schedules, time cards, vessel details, and work orders are cached locally; time entries, photos, and readings composed offline are queued and sync automatically on reconnect |
| Work order access | View and update work order status, notes, and time entries from any location without internet |
| Defect reporting | Log defect against asset by scanning asset QR code; photo and voice-to-text description |
| Meter reading entry | Enter electricity and water readings from berth; reading submitted directly to utility module |
| Multi-location switching | Staff working across multiple marina sites within a group can switch profile/location |
| Push notifications | Receive new task assignments, schedule changes, critical defect alerts, incoming vessel alerts |
| Language support | English, Spanish, Russian (expandable) |
| Dark mode | Automatic dark mode matching system preference; important for night-shift dock staff |
| PWA installation | Installable to the home screen from the browser without requiring an app store submission; alternative to building a fully native binary in Phase 1 |
| Permission tiers | Per-technician controls: enable/disable time clock, allow/deny manual entry, restrict part checkout, tiered attachment visibility |

---

### 1.2 Customer Boater App (iOS & Android Native)

A customer-facing app for marina guests and berth holders. Referenced in features.md Module 14.2.

**Cannot implement in current web-only frontend because:**
- Requires App Store and Google Play distribution for consumer adoption
- Requires native push notifications for time-sensitive alerts (storm warnings, invoice reminders, berth-ready notifications)
- "Arrival notification" feature requires background location access
- Offline berth map must be cached for use at sea with no data connection

**Detailed capability list:**

| Feature | Description |
|---|---|
| Arrival notification | Tap to notify marina of approach; enter ETA; dock master receives alert |
| My berth | View assigned berth number; visual pier map with own berth highlighted; walking directions from marina entrance |
| Active booking | Current booking summary, check-out date, outstanding balance |
| Pay invoice | Pay outstanding invoices from the app using stored card (Stripe SDK) |
| Fuel request | Request fuel delivery to berth; specify fuel type and quantity; dock staff notified |
| Report a problem | Submit defect report with photo; creates defect record in staff system |
| Marina services | Facilities directory, opening hours, contact numbers, WiFi password |
| Restaurant | View current menu, make a table reservation, view and manage existing reservation |
| Weather | Current conditions and 5-day forecast for the marina location |
| Push notifications | Arrival reminders, invoice reminders, storm warnings, facility outage alerts, event announcements |
| Offline berth map | Berth map and marina layout cached for use without connectivity |

---

## 2. AI-Powered Features

### 2.1 BLU Voice Agent

**Source:** Dockmaster's BLU Voice Agent product.

An AI phone agent that handles inbound customer calls 24/7 without a human operator. When a customer calls the marina outside office hours (or during peak periods when staff are on the dock), BLU intercepts the call and handles common requests autonomously.

**Cannot implement because:** Requires telephony integration (SIP/VoIP provider), a large language model hosted with real-time inference latency requirements, voice-to-text (Whisper or equivalent), text-to-voice synthesis, and a stateful conversation runtime connected to the live booking database. Entirely a backend + AI infrastructure concern.

**Capability list:**
- Slip reservation booking — takes caller details, vessel dimensions, requested dates; checks availability; creates a reservation and sends confirmation by SMS/email
- Work order enquiry status — caller asks about their repair; BLU retrieves the current WO status and reads it back
- Estimate creation — caller requests a service estimate; BLU captures vessel details and job description and creates a draft estimate for staff review
- General marina information — hours, facilities, directions, rates; answered from a configurable knowledge base
- Call escalation — when BLU cannot resolve a request, it captures a callback number and creates a task for staff follow-up; or it transfers to the on-call duty number if configured
- 24/7 availability — no off-hours calls go unanswered; all call transcripts logged against the member record

---

### 2.2 AI Work Order Scheduling

**Source:** Dockmaster's AI-powered scheduling feature.

True machine-learning based technician assignment rather than rule-based suggestions. The current features.md Module 9.2 describes this, but calls it "AI-assisted" — the actual implementation requires:

- A trained model built on historical work order completion time data per technician per job category
- Real-time optimisation considering: open WOs, their deadlines, technician skills and certifications, current workload, yard equipment availability, parts availability
- Conflict-free scheduling that re-optimises when a technician calls in sick or a job overruns

**Cannot implement because:** Requires a trained ML model, historical data corpus, inference infrastructure, and integration with live operational data via backend API. Not achievable in a static frontend.

---

## 3. Hardware Integrations

### 3.1 FuelCloud Pay-at-Pump

**Source:** Dockmaster + FuelCloud integration.

Allows boaters to initiate and pay for fuel directly at the pump without staff involvement. A FuelCloud hardware controller is attached to each pump; customers authenticate via NFC card, marina account QR code, or credit card swipe at the pump head.

**Cannot implement because:** Requires physical FuelCloud hardware installed at the fuel dock, and a backend API integration with FuelCloud's pump controller cloud service. The web frontend can display fuel sales records (already implemented) but cannot initiate or authorise pump dispense events.

**Capability list:**
- Customer initiates fuel request at the pump (NFC tap, card swipe, or QR scan)
- Pump is unlocked remotely by FuelCloud via backend authorisation
- Dispense volume reported to DocksBase in real time as the fuel flows
- Charge automatically posted to the vessel's open invoice on completion
- No staff intervention required for standard transactions
- Pump locked automatically if the vessel account is suspended or has a credit hold

---

### 3.2 MarineSync Automated Meter Readings

**Source:** Dockmaster + MarineSync integration.

Hardware electricity and water sub-meters installed at each berth send readings automatically to the cloud, eliminating the need for dock staff to walk the pontoons with a clipboard.

**Cannot implement because:** Requires physical MarineSync meter hardware at each berth, and a backend API connection to the MarineSync cloud service. The frontend can display readings (already implemented) but cannot receive automated meter data without a backend listener.

**Capability list:**
- Readings polled automatically every 15/30/60 minutes (configurable)
- Data pushed to DocksBase utility module without any manual entry
- Unusual usage anomalies (>3× rolling average) trigger an automatic alert with the reading timestamp and deviation percentage
- Historical hourly trend data available per berth per booking
- Outage detection — if a berth meter stops reporting, a connectivity alert is generated

---

### 3.3 Gate & Barrier Control Hardware

**Source:** Features.md Module 15.2.

Remotely open and lock marina access gates from the staff interface.

**Cannot implement because:** Requires backend MQTT or proprietary API connection to the gate controller hardware (e.g. BFT, FAAC, CAME). The web frontend can display the gate status and log access events but cannot send open/close commands without a backend relay service.

---

### 3.4 CCTV Live Feed (WebRTC)

**Source:** Features.md Module 15.3.

View live camera feeds within the DocksBase interface.

**Cannot implement because:** Requires a backend WebRTC proxy/TURN server to relay the camera stream from the marina's NVR (which is on a private LAN) to the browser. The frontend can display a video element but cannot establish the signalling connection without a backend.

---

## 4. Payment Infrastructure

### 4.1 Stripe Payment Processing (Backend Webhooks)

**Source:** Features.md Module 17.3 and 5.3.

**Cannot implement fully because:** Online invoice payments require:
- A backend server to create Stripe Payment Intents server-side (never client-side — publishable key only)
- Stripe webhook endpoint to receive `payment_intent.succeeded`, `charge.refunded`, and `dispute.created` events and update invoice statuses in the database
- Stripe Terminal pairing requires a backend terminal connection token

The frontend POS and billing screens are implemented as UI prototypes. Real transaction processing requires a Node/Python/Go backend with Stripe SDK.

### 4.2 ACH / BACS Direct Debit

**Source:** Features.md Module 5.7.

Automated direct debit collection for seasonal and annual berth fees.

**Cannot implement because:** ACH (US) and BACS (UK) mandate setup requires:
- Customer bank account verification (micro-deposits or instant bank verification via Plaid/TrueLayer)
- Scheduled debit execution on a specific future date — requires a cron job and database scheduler on the backend
- Notification emails sent in advance of each debit per regulation

### 4.3 Payment Links (Email-Delivered)

**Source:** Dockmaster Payments product; features.md Module 5.3.

Generate a unique payment link per invoice, delivered by email, that allows the customer to pay without logging into the portal.

**Cannot implement because:** Requires backend generation of a signed, time-limited, tamper-proof URL; a payment session hosted page; and a webhook receiver to update the invoice on payment. The email delivery itself requires a backend email queue.

---

## 5. Authentication & Customer Portal Backend

### 5.1 Customer Self-Service Portal

**Source:** Features.md Module 14.1; Dockmaster Web.

**Cannot implement because:** Requires:
- User authentication (JWTs issued by backend, refresh token rotation)
- Customer-facing database queries (view own invoices, own bookings, own vessel records)
- Document upload to server storage (S3 / Azure Blob)
- Two-factor authentication (TOTP server-side verification)
- Magic-link / passwordless login (backend generates signed short-lived token)
- Real-time sync between customer portal actions and staff dashboard

The staff-facing web app is a frontend prototype using mock data. A real customer portal requires a full API backend.

### 5.2 eSignature Audit Trail (Backend)

**Source:** Module 20 (native eSignature).

**Cannot implement fully in frontend because:** The tamper-evident signed PDF with embedded audit certificate requires:
- Server-side PDF generation (puppeteer, wkhtmltopdf, or a PDF library)
- Cryptographic signing of the completed document (server-managed private key)
- Secure storage of the completed PDF (object storage, not localStorage)
- IP geolocation lookup at signing time (server-side)

The eSignature workflow UI (document list, status tracking, template library) can be fully implemented in the frontend. The actual signing completion and PDF generation requires a backend.

---

## 6. Accounting Backend Operations

### 6.1 Xero / QuickBooks Push Integration

**Source:** Features.md Module 17.4.

**Cannot implement because:** OAuth 2.0 flows with Xero/QuickBooks require a backend to hold the refresh token securely and make API calls without exposing credentials to the browser.

### 6.2 Year-End Close / Period Lock

**Source:** Features.md Module 5.7.

**Cannot implement because:** Locking an accounting period against modification requires all write operations to validate the period lock status on the server before executing a database write. This is a backend constraint enforcement concern.

### 6.3 Bank Statement Import & Auto-Reconciliation

**Source:** Features.md Module 5.7.

**Cannot implement because:** Parsing OFX/QIF/CSV bank statement files and fuzzy-matching imported transactions against GL entries using amount, date, and reference is a server-side data processing task. The results can be surfaced in the frontend UI.

### 6.4 1099 Form Generation and IRS Filing

**Source:** Features.md Module 5.7; Dockmaster Financial Management.

**Cannot implement because:** IRS 1099 electronic filing requires a FIRE (Filing Information Returns Electronically) compliant file format generated server-side, and submission via SFTP to the IRS FIRE system.

---

## 7. Third-Party Channel Integrations (API-Level)

The following integrations require backend API credentials management and server-side data sync that cannot be achieved from a browser frontend:

| Integration | Why Backend Required |
|---|---|
| **AIS (MarineTraffic / AISHub)** | Requires persistent WebSocket or polling connection to AIS feed; vessel position data stored in time-series DB; matching algorithm runs server-side |
| **Weather API (OpenWeatherMap / Met Office)** | API key must not be exposed client-side; data should be cached server-side to avoid rate limits; push alerts triggered by server-side threshold evaluation |
| **Online Booking Channels (Noforeignland, Navily, MarineTraffic)** | Channel manager two-way sync requires server-side availability API and inbound webhook receiver |
| **DocuSign / HelloSign** | OAuth tokens and envelope creation must be server-side; signed document delivery via webhook |
| **SendGrid / Mailgun** | Email delivery requires server-side API key and mail queue |
| **Twilio / Vonage** | SMS delivery and two-way reply handling require server-side webhook endpoint |
| **PartSmart** | Parts catalog API credentials managed server-side; catalog data cached in DocksBase database |
| **BoatCloud** | Reservation sync requires server-side API and bidirectional availability calendar management |
| **SpeedyDock** | Launch request inbound webhook received by DocksBase backend; status pushed back via SpeedyDock API |
| **DealerSpike** | Lead import from DealerSpike requires inbound webhook or scheduled API poll server-side |
| **Credco** | Credit report requests must be made server-side (PII must not pass through browser to third party) |
| **Supreme BI** | Data export to BI platform requires scheduled server-side data pipeline |
| **TeamMarine (Salesforce)** | Salesforce API OAuth and data sync require server-side Salesforce SDK |
| **Kenect** | Inbound SMS reply webhooks received server-side; two-way message threading requires server-side state |
| **FuelCloud** | Pump dispense event webhooks received server-side; real-time tank level from FuelCloud hardware API |
| **MarineSync** | Meter reading push from MarineSync hardware received by server-side listener |
| **Stripe Webhooks** | Payment events (success, failure, refund, dispute) received by server-side webhook endpoint |

---

## Development Phase Roadmap

| Phase | Deliverable | Enables |
|---|---|---|
| **Phase 1 (current)** | Frontend prototype with mock data | UI/UX validation, investor demo, stakeholder review |
| **Phase 2** | Backend API (Node.js / PostgreSQL) + authentication | Real data, customer portal login, invoice generation |
| **Phase 3** | Payment processing (Stripe) + email/SMS (SendGrid/Twilio) | Live billing, payment collection, automated notifications |
| **Phase 4** | Staff PWA (offline-capable, geofencing) | Field operations, mobile time tracking, parts scanning |
| **Phase 5** | Customer boater app (iOS/Android) | Consumer-facing booking, arrival notification, pay-from-app |
| **Phase 6** | Hardware integrations (FuelCloud, MarineSync, gate control) | Automated metering, pay-at-pump, access control |
| **Phase 7** | AI features (scheduling optimisation, BLU Voice Agent) | 24/7 voice reception, ML-driven yard scheduling |
| **Phase 8** | Third-party channel integrations (AIS, booking channels, accounting push) | Full platform connectivity |

---

*End of DocksBase Future Platform Features v1.0*
