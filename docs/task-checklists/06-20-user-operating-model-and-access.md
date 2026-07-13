# Task checklist: Approve the 20-user operating model and Google access

Owner: Business owner and Google Workspace administrator

Status: Waiting on owner decisions

Depends on: [Setup inputs and decisions](00-setup-inputs.md)

The application role and the person’s direct Google Workspace access must be approved together. Removing a button in the app does not remove access that Google Groups, Shared Drive, Gmail delegation, Calendar sharing, or Sheets sharing grants directly.

## Owner decisions

- [ ] Name two initial Administrators. Recommended: two trained people, not one shared login.
- [ ] Decide whether Sales/Estimator belongs to Office Operations or needs a separate role.
- [ ] Decide whether field/crew leads receive full accounts or expiring assignment links. Recommended first rollout: links unless they need sustained project work.
- [ ] Decide whether subcontractors ever receive accounts. Recommended default: no.
- [ ] Require an explicit invitation for every app user, even when the user belongs to the company domain.
- [ ] Define who may view pricing, revenue, margin, and reports.
- [ ] Define who can create projects, change assignments, file Gmail, create Calendar events, share files, export data, and view the audit log.
- [ ] Record the approved development access group and phased staff rollout order.

## Proposed application roles

| Role | Default scope | Sensitive capabilities |
| --- | --- | --- |
| Administrator | Company-wide | Users, roles, connector, audit, recovery, configuration |
| Office Operations | Company-wide operations | Approved Gmail, Calendar, Drive, and directory actions; no user or connector administration |
| Project Manager | Assigned projects | Project actions within assigned records only |
| Field/Crew Lead, if approved | Assigned schedule/project field records only | Acknowledge work, field notes/photos, issue reporting; no client directory or company inbox |

Use granular capabilities on the server. Do not treat an `isAdmin` Boolean or a hidden navigation item as the authorization model.

## Cross-system access matrix to approve

Replace each Proposed value with the owner’s approved value.

| Resource or action | Admin | Office | Project Manager | Field/Crew | External worker |
| --- | --- | --- | --- | --- | --- |
| Application company records | All | All operational | Assigned projects | Assigned field records | None/link only |
| User/role/connector administration | Yes | No | No | No | No |
| Intake Gmail mailbox | Admin/recovery | Proposed: delegated | No | No | No |
| Review and copy Gmail to project | Yes | Proposed: yes | Proposed: assigned only | No | No |
| Shared Drive root | Manager as required | Contributor/content manager as approved | No root access | No | No |
| Assigned project Drive folder | Yes | Yes | Proposed: limited folder | Only when needed | No by default |
| Client Appointments calendar | Yes | Edit | View or assigned events | No | No |
| Field Schedule calendar | Yes | Edit | Assigned/project view | Assigned schedule view | Link only |
| Directory Sheet | Yes | Edit | No direct access by default | No | No |
| Financial reports/exports | Owner decision | Owner decision | Owner decision | No | No |
| Audit and recovery tools | Yes | No by default | No | No | No |

Shared Drive membership normally exposes all content in that drive; use Google Groups and limited-access project folders deliberately. Avoid sharing the Shared Drive root with Project Managers or field staff when their application scope is narrower.

## Google Groups and lifecycle

- [ ] Create role-aligned Google Groups only after the access matrix is approved, for example `fci-app-admins@`, `fci-office@`, `fci-project-managers@`, and `fci-field-leads@`.
- [ ] Assign a business owner to every group and document who may change membership.
- [ ] Use individual accounts; never shared staff passwords.
- [ ] Document the joiner workflow: create Workspace account, assign groups, invite to app, assign role/projects, verify least access.
- [ ] Document the mover workflow: change role/groups/project memberships and verify old access is gone.
- [ ] Document the leaver workflow: disable app sessions immediately, suspend Workspace account, remove groups/shares, reassign owned items, and retain evidence.
- [ ] Review group membership and app roles quarterly.
- [ ] Test that disabling a user or removing a project membership blocks both existing sessions and new requests.

## Completion result

This action is complete when the owner has approved the role definitions, the matrix has no Proposed/TBD entries, groups and lifecycle owners are named, and the decisions are reflected in authorization tests and Google resource sharing.
