# Task checklist: Create Google Workspace resources

Owner: Google Workspace administrator

Status: Workspace administrator verification pending — no completed resource inventory is recorded

Depends on: [Setup inputs](00-setup-inputs.md)

Use the `cherryhillfci.com` Workspace tenant and proposed operations connection account from the setup inputs.

## Accounts and services

- [ ] Confirm `cherryhillfci.com` is verified and controlled by the business in Google Admin.
- [ ] Create or select the operations connection account.
- [ ] Confirm Gmail, Calendar, Drive and Docs, and Sheets are enabled for its organizational unit.
- [ ] Confirm the Workspace edition supports Shared Drives.
- [ ] Do not use a personal `@gmail.com` account for the live company connection.

## Shared Drive

- [ ] Create a Shared Drive named `FCI Operations`.
- [ ] Give the operations account Manager access.
- [ ] Review external-sharing restrictions.
- [ ] Record the Shared Drive ID in the hosted configuration inventory; do not create the application folder tree manually. (Shared Drive creation stays manual; once dashboard setup lands, adopt it from Settings afterwards and the folder tree becomes a dashboard action.)

## Directory spreadsheet

Once dashboard setup lands (SET-16), the application can create this spreadsheet from
Settings; the manual path below remains valid.

- [ ] Inside the Shared Drive, create a Google Sheet named `FCI Operations Directory`.
- [ ] Leave the workbook empty so the application can maintain its tabs.
- [ ] Record the spreadsheet ID.

## Company calendars

Once dashboard setup lands and the WS-14 calendar-scope review is approved (SET-20),
the application can create these calendars from Settings; the manual path below
remains valid.

- [ ] Create `FCI • Client Appointments` in desktop Google Calendar.
- [ ] Create `FCI • Field Schedule`.
- [ ] Give the operations account permission to make changes and manage sharing.
- [ ] Share each calendar only with the approved people or Google Group.
- [ ] Record both Calendar IDs.
- [ ] Optional (WS-16): create an `FCI Holidays` calendar for closure days and record its ID (see [Google-native quick wins](11-google-quick-wins.md)).

## Operations mailbox alias

- [ ] Verify an `ops@` **Send mail as** alias on the connection account in Gmail settings so app-sent mail can use the company identity (see [Google-native quick wins](11-google-quick-wins.md)).

## Completion result

This action is complete when the operations account can access the Shared Drive, spreadsheet, and both calendars, and their non-secret IDs are ready for hosted configuration.

For click-by-click administrator instructions, see [the full rollout guide](../google-workspace-rollout-guide.md#part-1-set-up-the-google-workspace-organization).
