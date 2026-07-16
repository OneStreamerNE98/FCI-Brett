# Task checklist: Approve the 20-user operating model and Google access

Owner: Business owner and Google Workspace administrator

Status: Initial owner decisions recorded; full role responsibilities, rollout order, direct Google access, Groups, and lifecycle setup remain pending

Initial decisions recorded: July 15, 2026

Depends on: [Setup inputs and decisions](00-setup-inputs.md)

The application role and the person’s direct Google Workspace access must be approved together. Removing a button in the app does not remove access that Google Groups, Shared Drive, Gmail delegation, Calendar sharing, or Sheets sharing grants directly.

## Owner decisions

- [x] Initial Administrators: `admincrm@cherryhillfci.com` and `brett@cherryhillfci.com`.
- [ ] Verify both Administrator identities are individual managed accounts assigned to named people; `admincrm@cherryhillfci.com` must not become a shared password or generic staff login.
- [x] Sales/Estimator is excluded from the first rollout. Decide its eventual role before admitting a sales or estimating user.
- [x] Field/crew leads receive expiring, assignment-specific links rather than employee accounts in the first field release.
- [x] Subcontractors receive no application accounts.
- [x] Every employee requires an explicit application invitation, including users in `cherryhillfci.com`.
- [x] Only Administrators may view pricing, revenue, margins, or financial reports during the first rollout.
- [x] Only Administrators may create projects, change assignments, file Gmail, create Calendar events, share files, export data, or view security audit records during the first rollout.
- [ ] Decide the phased employee rollout order. Naming two initial Administrators does not authorize either account, exclude Office Operations or Project Managers from a later rollout, or relax the existing one-live-user development gate.

## Conservative simulation roles and rollout status

| Role/access type | Scope used by authorization simulation | Current status |
| --- | --- | --- |
| Administrator | Company-wide records and every currently approved sensitive capability | Two initial identities selected; live admission remains gated |
| Office Operations | Provisional least-access default: company-wide nonfinancial operational reads; no approved sensitive Google, financial, export, audit, assignment, project-creation, user, or connector capability | Fake local principal only; complete responsibilities and rollout timing remain open |
| Project Manager | Provisional least-access default: nonfinancial reads for explicitly assigned projects plus minimum related client/contact context | Fake local principal only; complete responsibilities, visibility rules, and rollout timing remain open |
| Field/Crew Lead | No employee role or session; simulate a future expiring link restricted to one exact assignment | No employee account; field-link actions beyond opening the exact assignment remain unapproved |
| Sales/Estimator | No approved role mapping | Excluded from the first rollout |
| Subcontractor | No application account or employee session | No account or current access; any future link policy remains open |

Use granular capabilities on the server. Do not treat an `isAdmin` Boolean or a hidden navigation item as the authorization model.

## Recorded decisions and deny-by-default simulation matrix

"Simulated only" means the policy can be tested locally without creating or inviting that user. It does not authorize a live account, Google Group, Drive share, calendar share, deployment, or second-user access.

| Resource or action | Admin | Office (simulated only) | Project Manager (simulated only) | Field/Crew link (future) | Subcontractor |
| --- | --- | --- | --- | --- | --- |
| Dashboard, search, and application operational records | Company-wide | Company-wide with financial fields and administrator-only actions removed | Assigned projects and required related client/contact context, with financial fields removed | No global dashboard or search; exact assignment only after the link feature is approved and built | None |
| Create projects or change assignments | Yes | No | No | No | No |
| Pricing, revenue, margins, and financial reports | Yes | No | No | No | No |
| User, role, invitation, session, or connector administration | Not approved | No | No | No | No |
| Review and copy Gmail to a project | Yes | No | No | No | No |
| Share or provision files | Yes | No | No | No | No |
| Create Calendar events | Yes | No | No | No | No |
| Export data | Yes | No | No | No | No |
| View security audit records | Yes | No | No | No | No |

The Office and Project Manager operational-read rows are conservative simulation defaults pending approval, not final responsibilities. The owner has not yet approved user/role/invitation/session/connector administration, mailbox reading or delegation, Calendar viewing, file viewing/download, Shared Drive root membership, Directory Sheet access, routine Office/Project Manager writes, job retry, or recovery authority. The local policy must deny those actions until each is decided. The Admin audit-view capability may be modeled now, but the accepted production runtime remains insert-only on `audit_events`; an actual viewer needs a separately reviewed least-privilege read boundary.

Shared Drive membership normally exposes all content in that drive; use Google Groups and limited-access project folders deliberately. Avoid sharing the Shared Drive root with Project Managers or field staff when their application scope is narrower.

## Google Groups and lifecycle

- [ ] Create role-aligned employee Google Groups only when direct Google access and rollout order are approved, for example `fci-app-admins@`, `fci-office@`, and `fci-project-managers@`. Do not create a Field Lead employee group for link-only access.
- [ ] Assign a business owner to every group and document who may change membership.
- [ ] Use individual accounts; never shared staff passwords.
- [ ] Document the joiner workflow: create Workspace account, assign groups, invite to app, assign role/projects, verify least access.
- [ ] Document the mover workflow: change role/groups/project memberships and verify old access is gone.
- [ ] Document the leaver workflow: disable app sessions immediately, suspend Workspace account, remove groups/shares, reassign owned items, and retain evidence.
- [ ] Review group membership and app roles quarterly.
- [x] Prove in the source simulator that disabling a user or expiring/removing project membership blocks subsequent authorization/database requests; live Google and route-composed verification remains open.

## Completion result

The policy is sufficient for local authorization simulation when every unapproved capability remains deny-by-default. This checklist is fully complete only after account ownership, rollout order, direct Google read/access decisions, Google Groups, and lifecycle owners are approved; authorization tests reflect the final decisions; and later Google resource sharing is verified. The existing one-user development restriction remains in force.
