# Task checklist: Google-native quick wins (no code)

Owner: business owner + Workspace administrator

Status: Open — created July 21, 2026 with the adopted
[Google integration opportunities](../google-integration-opportunities.md); tracked as
packet WS-16 in the [agent execution plan](../agent-plan-architecture-workspace-and-setup.md)

Depends on: [Workspace resources](01-workspace-resources.md) (accounts, calendars, and
the directory sheet must exist)

These are owner setup clicks in Google's own products — no application code, no new
OAuth scopes, and no cost beyond the existing Workspace Business license. Budget
context: the owner integration budget is ≤$50/month; everything on this page is $0.

## Client self-booking page

- [ ] In Google Calendar (desktop, signed in as the connection account), create an
      **appointment schedule** on `FCI • Client Appointments` for site-visit and
      measurement slots (booking-page name, meeting length, availability windows).
- [ ] Confirm booked slots appear as events with the client as attendee (the app reads
      this calendar already; GI-01/lead matching consumes the attendee email later).
- [ ] Record the booking-page link in the configuration inventory and start including
      it in estimate follow-up emails.

## Professional outbound identity (`ops@`)

- [ ] In Gmail (connection account) → Settings → Accounts → **Send mail as**, add and
      verify the `ops@<company-domain>` alias.
- [ ] Record that the alias is verified; app-sent mail can then use it as the From
      address with no scope change.

## Weekly KPI dashboard (Looker Studio, free)

- [ ] Open Looker Studio with an owner/administrator account and create a data source
      from the `FCI Operations Directory` spreadsheet (Sheets connector, free).
- [ ] Build the first dashboard page: lead pipeline by stage, jobs by status, and
      closeout aging from the Client Directory and Project Register tabs.
- [ ] Share it view-only with the office team. (Looker Studio Pro is deliberately not
      purchased — the free tier covers this use.)

## App-like installs for office staff (PWA)

- [ ] Enroll the office Chrome browsers in **Chrome Enterprise Core** (free) if not
      already managed.
- [ ] Force-install/pin the FCI Operations PWA (the app already ships the manifest) for
      the office organizational unit so staff get a desktop app window and shortcut.

## Holidays and closure days as a calendar

- [ ] Create an **`FCI Holidays`** calendar (desktop Google Calendar) and add company
      holidays/closure days.
- [ ] Share it read-only with the team; record its Calendar ID. Future scheduling
      features read it as configuration (config-as-calendar — no app UI needed).

## Supporting confirmations

- [ ] Confirm the Workspace edition in the Admin console is **Business Standard or
      higher** and record it (gates the GI-06 Drive Labels packet and premium
      appointment-schedule options).
- [ ] Review the Shared Drive external-sharing setting while in the Admin console
      (verify-only; the app never changes it).

## Completion result

This checklist is complete when the booking link is in use, the `ops@` alias is
verified, the Looker Studio dashboard is shared, office browsers pin the PWA, the
holidays calendar exists with its ID recorded, and the Workspace edition is recorded.
Nothing on this page changes application code, hosted configuration, scopes, or
deployment state.
