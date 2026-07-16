# Task checklist: Approve the 20-user operating model and Google access

Owner: Business owner and Google Workspace administrator

Status: First-rollout application role policy approved; rollout order, direct Google access, Groups, and lifecycle setup remain pending

Decisions recorded: July 15–16, 2026

Depends on: [Setup inputs and decisions](00-setup-inputs.md)

The application role and the person’s direct Google Workspace access must be approved together. Removing a button in the app does not remove access that Google Groups, Shared Drive, Gmail delegation, Calendar sharing, or Sheets sharing grants directly.

## Owner decisions

- [x] Initial Administrators: `admincrm@cherryhillfci.com` and `brett@cherryhillfci.com`.
- [x] Owner confirmed `admincrm@cherryhillfci.com` is individual and not shared.
- [ ] Before live login, verify AdminCRM's managed Workspace status and immutable issuer/`sub`; verify Brett is an individual managed account and bind his immutable identity.
- [x] Sales/Estimator is excluded from the first rollout. Decide its eventual role before admitting a sales or estimating user.
- [x] Field/crew leads receive read-only, exact-project links rather than employee accounts: seven days by default, fourteen days at most, and immediately revocable.
- [x] Subcontractors receive no application accounts or employee role; any future subcontractor link remains a separate decision.
- [x] Every employee requires a single-use explicit application invitation for one exact email and role, including users in `cherryhillfci.com`; invitations expire after seven days.
- [x] Employee sessions use a 30-minute inactivity timeout and eight-hour absolute lifetime.
- [x] Every employee has exactly one supported role; per-user capability overrides are prohibited.
- [x] Only Administrators may view pricing, revenue, margins, or financial reports during the first rollout.
- [x] Only Administrators may create projects, change assignments, file Gmail, create Calendar events, share files, export data, or view security audit records during the first rollout.
- [x] Administrators may invite/revoke invitations, disable users, assign roles/projects, revoke sessions, manage Field links, and adjust the global Office/Project Manager permission settings within the fixed approved capability ceiling.
- [x] Office may create/update leads, clients, and contacts and update existing project status, tasks, meetings, and notes company-wide; Office may view/upload nonfinancial files.
- [x] Project Managers may update status, tasks, meetings, and notes and view/upload nonfinancial files only for assigned projects; related client/contact context is read-only.
- [ ] Decide the phased employee rollout order. Naming two initial Administrators does not authorize either account, exclude Office Operations or Project Managers from a later rollout, or relax the existing one-live-user development gate.

## Approved application roles and rollout status

| Role/access type | Scope used by authorization simulation | Current status |
| --- | --- | --- |
| Administrator | Company-wide operational/financial records plus approved sensitive and access-administration capabilities | Two initial identities selected; live admission remains gated |
| Office Operations | Company-wide nonfinancial reads and approved operational mutations/file view-upload | Fake local principal only; rollout timing remains open |
| Project Manager | Nonfinancial reads and approved operational mutations/file view-upload for explicitly assigned projects plus minimum related client/contact context | Fake local principal only; rollout timing remains open |
| Field/Crew Lead | No employee role/session; future read-only link restricted to one exact project | No link issuance or route exists yet |
| Sales/Estimator | No approved role mapping | Excluded from the first rollout |
| Subcontractor | No application account or employee session | No current access; any future link remains unapproved |

Use granular capabilities on the server. Do not treat an `isAdmin` Boolean or a hidden navigation item as the authorization model.

## Recorded decisions and deny-by-default simulation matrix

"Simulated only" means the policy can be tested locally without creating or inviting that user. It does not authorize a live account, Google Group, Drive share, calendar share, deployment, or second-user access.

| Resource or action | Admin | Office (simulated only) | Project Manager (simulated only) | Field/Crew link (future) | Subcontractor |
| --- | --- | --- | --- | --- | --- |
| Dashboard, search, and application operational records | Company-wide | Company-wide with financial fields and administrator-only actions removed | Assigned projects and required related client/contact context, with financial fields removed | No global dashboard or search; exact assignment only after the link feature is approved and built | None |
| Create/update leads, clients, and contacts | Yes | Yes, company-wide and nonfinancial | No; related context is read-only | No | No |
| Update existing project status, tasks, meetings, and notes | Yes | Yes, company-wide and nonfinancial | Assigned projects only | No | No |
| View/upload application files | Yes | Yes, company-wide and nonfinancial | Assigned projects only and nonfinancial | No | No |
| Create projects or change assignments | Yes | No | No | No | No |
| Pricing, revenue, margins, and financial reports | Yes | No | No | No | No |
| Invitation, user-disable, role/project assignment, session revocation, Field-link, and Office/PM policy administration | Yes, within fixed safeguards | No | No | No | No |
| Connector administration, job retry, recovery, or arbitrary/per-user capability grants | No | No | No | No | No |
| Review and copy Gmail to a project | Yes | No | No | No | No |
| Share files | Yes | No | No | No | No |
| Create Calendar events | Yes | No | No | No | No |
| Export data | Yes | No | No | No | No |
| View security audit records | Yes | No | No | No | No |

The application capability ceiling above is approved, but it does not grant direct Google resource access or make an unimplemented route available. Mailbox reading/delegation, Calendar viewing, Shared Drive root membership, Directory Sheet access, connector administration, job retry, recovery, arbitrary capabilities, per-user exceptions, and all deletes remain denied. The accepted runtime remains insert-only on `audit_events`; an Administrator audit viewer still needs a separately reviewed least-privilege read boundary.

File view/upload approval does not permit pricing leakage through documents. Production file metadata, classification, storage, and download queries must enforce both project scope and the nonfinancial boundary before Office or Project Manager file access goes live. The same caution applies to free-text notes and meeting content.

Shared Drive membership normally exposes all content in that drive; use Google Groups and limited-access project folders deliberately. Avoid sharing the Shared Drive root with Project Managers or field staff when their application scope is narrower.

## Google Groups and lifecycle

- [ ] Create role-aligned employee Google Groups only when direct Google access and rollout order are approved, for example `fci-app-admins@`, `fci-office@`, and `fci-project-managers@`. Do not create a Field Lead employee group for link-only access.
- [ ] Assign a business owner to every group and document who may change membership.
- [ ] Use individual accounts; never shared staff passwords.
- [ ] Document the joiner workflow: create Workspace account, assign groups, invite to app, assign role/projects, verify least access.
- [ ] Document the mover workflow: change role/groups/project memberships and verify old access is gone.
- [ ] Document the leaver workflow: disable app sessions immediately, suspend Workspace account, remove groups/shares, reassign owned items, and retain evidence.
- [ ] Review group membership and app roles quarterly.
- [x] Prove in source that disabling a user or expiring/removing project membership blocks subsequent authorization/database requests and that sensitive assigned-project capability checks recheck exact membership; live Google verification remains open.

## Completion result

The application policy is sufficient for source-only authorization and route composition when every unapproved capability remains deny-by-default. This checklist is fully complete only after managed identity ownership, rollout order, direct Google read/access decisions, Google Groups, lifecycle owners, durable admission, and later Google resource sharing are verified. The existing one-user development restriction remains in force.
