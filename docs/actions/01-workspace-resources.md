# Action: Create Google Workspace resources

Owner: Google Workspace administrator

Status: Not started

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
- [ ] Record the Shared Drive ID in the hosted configuration inventory; do not create the application folder tree manually.

## Directory spreadsheet

- [ ] Inside the Shared Drive, create a Google Sheet named `FCI Operations Directory`.
- [ ] Leave the workbook empty so the application can maintain its tabs.
- [ ] Record the spreadsheet ID.

## Company calendars

- [ ] Create `FCI • Client Appointments` in desktop Google Calendar.
- [ ] Create `FCI • Field Schedule`.
- [ ] Give the operations account permission to make changes and manage sharing.
- [ ] Share each calendar only with the approved people or Google Group.
- [ ] Record both Calendar IDs.

## Completion result

This action is complete when the operations account can access the Shared Drive, spreadsheet, and both calendars, and their non-secret IDs are ready for hosted configuration.

For click-by-click administrator instructions, see [the full rollout guide](../google-workspace-rollout-guide.md#part-1-set-up-the-google-workspace-organization).
