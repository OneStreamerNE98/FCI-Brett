"use client";

import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import {
  type AdminAccessInvitationSummary,
  type AdminAccessOverview,
  type AdminAccessPersonSummary,
  type AdminAccessRoleKey,
  type AdminAccessRoleSummary,
} from "../../ports/admin-access-persistence";
import {
  AdminAccessClientError,
  changeAdminAccessPerson,
  disableAdminAccessPerson,
  inviteAdminAccessPerson,
  readAdminAccessOverview,
  revokeAdminAccessInvitation,
  signOutAdminAccessPerson,
} from "../../lib/admin-access-client";
import { AdminActivityPanel } from "./AdminActivityPanel";

type AccessDialog =
  | Readonly<{ kind: "invite" }>
  | Readonly<{ kind: "edit"; person: AdminAccessPersonSummary }>
  | Readonly<{ kind: "revoke"; invitation: AdminAccessInvitationSummary }>
  | Readonly<{ kind: "disable"; person: AdminAccessPersonSummary }>
  | Readonly<{ kind: "sign-out"; person: AdminAccessPersonSummary }>;

type RunMutation = (
  work: () => Promise<unknown>,
  successMessage: string,
) => Promise<void>;

type AccessSection = "people" | "activity";

declare global {
  interface Window {
    __FCI_E2E_ADMIN_CSRF_TOKEN__?: string;
  }
}

const ROLE_LABELS: Readonly<Record<AdminAccessRoleKey, string>> = Object.freeze({
  administrator: "Administrator",
  office_operations: "Office Operations",
  project_manager: "Project Manager",
});

const MAX_PROJECT_ASSIGNMENTS = 50;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function roleLabel(role: AdminAccessRoleKey) {
  return ROLE_LABELS[role];
}

function canonicalProjectIds(role: AdminAccessRoleKey, projectIds: readonly string[]) {
  return role === "project_manager" ? [...new Set(projectIds)].sort() : [];
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function friendlyError(error: unknown) {
  if (!(error instanceof AdminAccessClientError)) {
    return "The request could not be completed. Review the connection and try again.";
  }
  if (error.code === "secure_session_not_ready") {
    return "Secure employee-session setup is not connected to this development screen yet.";
  }
  if (error.code === "final_active_administrator") {
    return "This is the final active Administrator. Add or restore another Administrator before reducing this access.";
  }
  if (error.code === "access_conflict") {
    return "That invitation or access record conflicts with an existing one. Refresh and review the current list.";
  }
  if (error.code === "invalid_admin_request") {
    return "Review the required company email, role, projects, and reason.";
  }
  if (error.status >= 500 || error.code === "invalid_server_response") {
    return "Access administration is temporarily unavailable. No change has been confirmed.";
  }
  return "The access change was not authorized or could not be confirmed.";
}

function projectScope(
  person: Pick<AdminAccessPersonSummary, "role" | "projectIds">,
  projectNames: ReadonlyMap<string, string>,
  compact = false,
) {
  if (person.role !== "project_manager") return "All company projects";
  if (person.projectIds.length === 0) return "No projects assigned";
  const names = person.projectIds.map((id) => projectNames.get(id) ?? "Project unavailable");
  if (compact && names.length > 2) {
    return `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
  }
  return names.join(", ");
}

function dialogIdentity(dialog: AccessDialog) {
  if (dialog.kind === "invite") return "invite";
  if (dialog.kind === "revoke") return `${dialog.kind}:${dialog.invitation.id}:${dialog.invitation.version}`;
  return `${dialog.kind}:${dialog.person.id}:${dialog.person.version}`;
}

export function AdminAccessPage({ csrfToken }: { csrfToken: string | null }) {
  const [hydrated, setHydrated] = useState(false);
  const [activeSection, setActiveSection] = useState<AccessSection>("people");
  const [overview, setOverview] = useState<AdminAccessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sessionEnded, setSessionEnded] = useState(false);
  const [dialog, setDialog] = useState<AccessDialog | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [browserTestCsrfToken, setBrowserTestCsrfToken] = useState<string | null>(null);
  const peopleHeadingRef = useRef<HTMLHeadingElement>(null);
  const invitationsHeadingRef = useRef<HTMLHeadingElement>(null);
  const peopleTabRef = useRef<HTMLButtonElement>(null);
  const activityTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Playwright supplies this value before hydration. It remains a test seam,
    // not an authorization bypass: the Cloud Run server still requires the
    // independently stored hash for the exact live employee session.
    const hostname = window.location.hostname.toLowerCase();
    const loopback = hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname === "[::1]";
    const testToken = window.__FCI_E2E_ADMIN_CSRF_TOKEN__;
    const timer = csrfToken === null && loopback && testToken
      ? window.setTimeout(() => setBrowserTestCsrfToken(testToken), 0)
      : undefined;
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [csrfToken]);

  const mutationCsrfToken = csrfToken ?? browserTestCsrfToken;
  const mutationsReady = mutationCsrfToken !== null;

  const loadOverview = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError("");
    try {
      const next = await readAdminAccessOverview();
      setOverview(next);
      setSessionEnded(false);
      return true;
    } catch (error) {
      if (error instanceof AdminAccessClientError && error.status === 401) {
        setSessionEnded(true);
        setOverview(null);
      } else if (error instanceof AdminAccessClientError && error.status === 403) {
        setLoadError("Only an active Administrator can view People & Access.");
        setOverview(null);
      } else {
        setLoadError("People and invitations could not be loaded. No access settings were changed.");
      }
      return false;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOverview();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOverview]);

  const projectNames = useMemo(() => new Map(
    overview?.projects.map((project) => [
      project.id,
      `${project.projectNumber} — ${project.name}`,
    ]) ?? [],
  ), [overview?.projects]);

  const runMutation: RunMutation = async (work, successMessage) => {
    setSubmitting(true);
    setActionError("");
    setNotice("");
    try {
      await work();
      const refreshed = await loadOverview(true);
      setDialog(null);
      setNotice(refreshed
        ? successMessage
        : `${successMessage} Refresh the list before making another change.`);
    } catch (error) {
      if (error instanceof AdminAccessClientError && error.status === 401) {
        setSessionEnded(true);
        setOverview(null);
        setDialog(null);
      } else if (
        error instanceof AdminAccessClientError
        && error.code === "access_state_stale"
      ) {
        await loadOverview(true);
        setDialog(null);
        setNotice("Someone else changed this access record. The list was refreshed; review it before trying again.");
      } else {
        setActionError(friendlyError(error));
      }
    } finally {
      setSubmitting(false);
    }
  };

  function openDialog(next: AccessDialog) {
    setActionError("");
    setNotice("");
    setDialog(next);
  }

  const endSession = useCallback(() => {
    setSessionEnded(true);
    setOverview(null);
    setDialog(null);
  }, []);

  function selectSection(section: AccessSection, focus = false) {
    setActiveSection(section);
    if (focus) {
      const ref = section === "people" ? peopleTabRef : activityTabRef;
      window.setTimeout(() => ref.current?.focus(), 0);
    }
  }

  function moveSection(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") {
      selectSection("people", true);
      return;
    }
    if (event.key === "End") {
      selectSection("activity", true);
      return;
    }
    selectSection(activeSection === "people" ? "activity" : "people", true);
  }

  return <main className="access-management-page">
    <header className="access-management-header">
      <div>
        <Link href="/" className="access-management-back">← Back to operations</Link>
        <p className="eyebrow">Management</p>
        <h1>People &amp; Access</h1>
        <span>Manage employee access and review security activity.</span>
      </div>
      {activeSection === "people" && <button
        type="button"
        className="primary-button"
        onClick={() => openDialog({ kind: "invite" })}
        disabled={!overview || sessionEnded || !mutationsReady}
      >Invite person</button>}
    </header>

    {activeSection === "people" && mutationCsrfToken === null && <section className="access-management-boundary" role="note">
      <strong>Development integration boundary</strong>
      <span>The screen and server contracts are implemented in source. Access changes remain unavailable until the employee session and CSRF bootstrap are composed on Cloud Run.</span>
    </section>}

    {activeSection === "people" && notice && <div className="access-management-notice" role="status" aria-live="polite">{notice}</div>}

    {sessionEnded ? <section className="panel access-management-state" role="alert">
      <h2>Your secure session has ended</h2>
      <p>Sign in again before reviewing or changing employee access.</p>
      <Link className="primary-button" href="/">Return to sign in</Link>
    </section> : <>
      <div className="access-management-tabs" role="tablist" aria-label="People and access sections">
        <button
          id="access-tab-people"
          ref={peopleTabRef}
          type="button"
          role="tab"
          aria-selected={activeSection === "people"}
          aria-controls="access-panel-people"
          tabIndex={activeSection === "people" ? 0 : -1}
          disabled={!hydrated}
          onClick={() => selectSection("people")}
          onKeyDown={moveSection}
        >People</button>
        <button
          id="access-tab-activity"
          ref={activityTabRef}
          type="button"
          role="tab"
          aria-selected={activeSection === "activity"}
          aria-controls="access-panel-activity"
          tabIndex={activeSection === "activity" ? 0 : -1}
          disabled={!hydrated}
          onClick={() => selectSection("activity")}
          onKeyDown={moveSection}
        >Activity</button>
      </div>

      <section
        id="access-panel-people"
        role="tabpanel"
        aria-labelledby="access-tab-people"
        hidden={activeSection !== "people"}
      >
      {loading ? <section className="panel access-management-state" role="status">
        <h2>Loading People &amp; Access…</h2>
        <p>Checking the current Administrator session and access records.</p>
      </section> : loadError || !overview ? <section className="panel access-management-state" role="alert">
        <h2>People &amp; Access is unavailable</h2>
        <p>{loadError || "The access projection could not be loaded."}</p>
        <button type="button" className="soft-button" onClick={() => void loadOverview()}>Retry</button>
      </section> : <>
      {overview.summary.activeAdministratorCount < 2 && <section className="access-management-warning" role="status">
        <strong>Administrator coverage needs attention</strong>
        <span>Keep at least two active Administrators. The server will not allow the final active Administrator to be disabled or moved to another role.</span>
      </section>}

      <section className="access-management-summary" aria-label="Access summary">
        <div className="panel"><span>Active people</span><strong>{overview.summary.activePeopleCount}</strong></div>
        <div className="panel"><span>Active Administrators</span><strong>{overview.summary.activeAdministratorCount}</strong></div>
        <div className="panel"><span>Pending invitations</span><strong>{overview.summary.pendingInvitationCount}</strong></div>
      </section>

      <section className="panel access-management-people" aria-labelledby="people-heading">
        <div className="access-management-section-heading">
          <div><p className="eyebrow">Employees</p><h2 id="people-heading" ref={peopleHeadingRef} tabIndex={-1}>People</h2></div>
          <span>{overview.people.length} total</span>
        </div>
        <div className="access-management-table-wrap">
          <table>
            <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Project scope</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{overview.people.map((person) => <tr key={person.id}>
              <td data-label="Person"><strong>{person.displayName}</strong><small>{person.email}</small></td>
              <td data-label="Role">{roleLabel(person.role)}</td>
              <td data-label="Project scope" className="access-management-scope">{projectScope(person, projectNames, true)}</td>
              <td data-label="Status"><span className={`access-management-status ${person.status}`}>{person.status === "active" ? "Active" : "Disabled"}</span></td>
              <td data-label="Last sign-in">{person.lastSignedInAt === null ? "Not yet" : dateFormatter.format(person.lastSignedInAt)}</td>
              <td data-label="Actions">{person.status === "active" ? <div className="access-management-actions">
                <button type="button" onClick={() => openDialog({ kind: "edit", person })} disabled={!mutationsReady}>Edit access</button>
                <button type="button" onClick={() => openDialog({ kind: "sign-out", person })} disabled={!mutationsReady}>Sign out everywhere</button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => openDialog({ kind: "disable", person })}
                  disabled={!mutationsReady || (person.role === "administrator" && overview.summary.activeAdministratorCount <= 1)}
                  title={person.role === "administrator" && overview.summary.activeAdministratorCount <= 1 ? "The final active Administrator cannot be disabled" : undefined}
                >Disable access</button>
              </div> : <span className="access-management-no-actions">No first-release actions</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <div className="access-management-lower-grid">
        <section className="panel access-management-invitations" aria-labelledby="invitations-heading">
          <div className="access-management-section-heading">
            <div><p className="eyebrow">Seven-day invitations</p><h2 id="invitations-heading" ref={invitationsHeadingRef} tabIndex={-1}>Pending invitations</h2></div>
          </div>
          {overview.invitations.length === 0 ? <p className="access-management-empty">No invitations are waiting.</p> : <ul>{overview.invitations.map((invitation) => <li key={invitation.id}>
            <div><strong>{invitation.email}</strong><span>{roleLabel(invitation.role)} · expires {dateFormatter.format(invitation.expiresAt)}</span>{invitation.role === "project_manager" && <small>{projectScope(invitation, projectNames, true)}</small>}</div>
            <button type="button" className="soft-button" onClick={() => openDialog({ kind: "revoke", invitation })} disabled={!mutationsReady}>Revoke</button>
          </li>)}</ul>}
        </section>

        <section className="panel access-management-role-guide" aria-labelledby="roles-heading">
          <div className="access-management-section-heading">
            <div><p className="eyebrow">Fixed policy</p><h2 id="roles-heading">What each role can do</h2></div>
          </div>
          <div>{overview.roles.map((role) => <article key={role.key}><strong>{role.displayName}</strong><p>{role.description}</p></article>)}</div>
          <p className="access-management-policy-note">Every employee requires an exact company invitation. Field Leads use future temporary links; subcontractors receive no account. Pricing, revenue, margins, project creation and assignment, Gmail filing, Calendar creation, file sharing, export, and audit viewing are Administrator-only.</p>
        </section>
      </div>
      </>}
      </section>

      <section
        id="access-panel-activity"
        role="tabpanel"
        aria-labelledby="access-tab-activity"
        hidden={activeSection !== "activity"}
      >
        <AdminActivityPanel
          active={activeSection === "activity"}
          onSessionEnded={endSession}
        />
      </section>
    </>}

    {dialog && overview && <AccessManagementDialog
      key={dialogIdentity(dialog)}
      dialog={dialog}
      overview={overview}
      csrfToken={mutationCsrfToken}
      fallbackFocusRef={dialog.kind === "revoke"
        ? invitationsHeadingRef
        : dialog.kind === "disable"
          ? peopleHeadingRef
          : undefined}
      submitting={submitting}
      error={actionError}
      onClose={() => !submitting && setDialog(null)}
      runMutation={runMutation}
    />}
  </main>;
}

function AccessManagementDialog({
  dialog,
  overview,
  csrfToken,
  fallbackFocusRef,
  submitting,
  error,
  onClose,
  runMutation,
}: {
  dialog: AccessDialog;
  overview: AdminAccessOverview;
  csrfToken: string | null;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  submitting: boolean;
  error: string;
  onClose: () => void;
  runMutation: RunMutation;
}) {
  const [role, setRole] = useState<AdminAccessRoleKey>(
    dialog.kind === "edit" ? dialog.person.role : "office_operations",
  );
  const [projectIds, setProjectIds] = useState<string[]>(
    dialog.kind === "edit" ? [...dialog.person.projectIds] : [],
  );
  const projectNames = useMemo(() => new Map(overview.projects.map((project) => [
    project.id,
    `${project.projectNumber} — ${project.name}`,
  ])), [overview.projects]);
  const proposedProjectIds = canonicalProjectIds(role, projectIds);
  const currentProjectIds = dialog.kind === "edit"
    ? canonicalProjectIds(dialog.person.role, dialog.person.projectIds)
    : [];
  const editHasChanges = dialog.kind !== "edit"
    || dialog.person.role !== role
    || !sameIds(currentProjectIds, proposedProjectIds);
  const addedProjects = dialog.kind === "edit"
    ? proposedProjectIds.filter((id) => !currentProjectIds.includes(id)).length
    : 0;
  const removedProjects = dialog.kind === "edit"
    ? currentProjectIds.filter((id) => !proposedProjectIds.includes(id)).length
    : 0;

  function toggleProject(projectId: string) {
    setProjectIds((current) => current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : current.length < MAX_PROJECT_ASSIGNMENTS ? [...current, projectId] : current);
  }

  const title = dialog.kind === "invite"
    ? "Invite person"
    : dialog.kind === "edit"
      ? `Edit ${dialog.person.displayName}`
      : dialog.kind === "revoke"
        ? "Revoke invitation"
        : dialog.kind === "disable"
          ? "Disable access"
          : "Sign out everywhere";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "").trim();
    const token = csrfToken ?? "";

    if (dialog.kind === "invite") {
      const email = String(form.get("email") ?? "").trim();
      await runMutation(
        () => inviteAdminAccessPerson(token, {
          email,
          role,
          projectIds: proposedProjectIds,
        }),
        `Invitation created for ${email}. Delivery remains deferred until employee sign-in is composed.`,
      );
      return;
    }
    if (dialog.kind === "edit") {
      await runMutation(
        () => changeAdminAccessPerson(token, dialog.person.id, {
          expectedVersion: dialog.person.version,
          role,
          projectIds: proposedProjectIds,
          reason,
        }),
        `${dialog.person.displayName}'s access was updated and prior sessions were invalidated.`,
      );
      return;
    }
    if (dialog.kind === "revoke") {
      await runMutation(
        () => revokeAdminAccessInvitation(
          token,
          dialog.invitation.id,
          dialog.invitation.version,
          reason,
        ),
        `The invitation for ${dialog.invitation.email} was revoked.`,
      );
      return;
    }
    if (dialog.kind === "disable") {
      await runMutation(
        () => disableAdminAccessPerson(
          token,
          dialog.person.id,
          dialog.person.version,
          reason,
        ),
        `${dialog.person.displayName}'s access was disabled and all sessions were invalidated.`,
      );
      return;
    }
    await runMutation(
      () => signOutAdminAccessPerson(
        token,
        dialog.person.id,
        dialog.person.version,
        reason,
      ),
      `${dialog.person.displayName} was signed out everywhere.`,
    );
  }

  const requiresProjects = (dialog.kind === "invite" || dialog.kind === "edit")
    && role === "project_manager";

  return <AccessibleOverlay
    ariaLabel={title}
    contentClassName="modal access-management-dialog"
    onClose={onClose}
    busy={submitting}
    fallbackFocusRef={fallbackFocusRef}
  >
    <header><div><p className="eyebrow">People &amp; Access</p><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close" disabled={submitting}>×</button></header>
    <form onSubmit={(event) => void submit(event)}>
      {dialog.kind === "invite" && <>
        <label>Exact company email<input data-overlay-initial-focus type="email" name="email" required autoComplete="off" placeholder="person@cherryhillfci.com" /></label>
        <RolePicker roles={overview.roles} role={role} onRole={(next) => { setRole(next); if (next !== "project_manager") setProjectIds([]); }} disabled={submitting} />
        <p className="access-management-impact">The invitation is single-use and expires after seven days. Every employee must be invited explicitly.</p>
      </>}
      {dialog.kind === "edit" && <>
        <RolePicker roles={overview.roles} role={role} onRole={(next) => { setRole(next); if (next !== "project_manager") setProjectIds([]); }} disabled={submitting} initialFocus />
        <div className="access-management-impact access-management-change-preview">
          <strong>Current: {roleLabel(dialog.person.role)} · {projectScope({ role: dialog.person.role, projectIds: currentProjectIds }, projectNames)}</strong>
          <span>Proposed: {roleLabel(role)} · {projectScope({ role, projectIds: proposedProjectIds }, projectNames)}</span>
          <small>{editHasChanges
            ? `${addedProjects} project${addedProjects === 1 ? "" : "s"} added · ${removedProjects} removed. Saving signs this person out everywhere.`
            : "No access change selected."}</small>
        </div>
      </>}
      {requiresProjects && <ProjectPicker overview={overview} selected={projectIds} onToggle={toggleProject} disabled={submitting} />}
      {dialog.kind !== "invite" && <label>Reason<textarea data-overlay-initial-focus={dialog.kind !== "edit" ? true : undefined} name="reason" required minLength={2} maxLength={500} placeholder="Brief business or security reason" disabled={submitting} /></label>}
      {dialog.kind === "revoke" && <p className="access-management-impact">The pending invitation for <strong>{dialog.invitation.email}</strong> will stop working. Its history and audit evidence remain.</p>}
      {dialog.kind === "disable" && <p className="access-management-impact danger">This disables <strong>{dialog.person.displayName}</strong> and invalidates every active session. The person is retained for history and cannot be re-enabled from this first-release page.</p>}
      {dialog.kind === "sign-out" && <p className="access-management-impact">This invalidates every current session for <strong>{dialog.person.displayName}</strong>. Their role and account status stay unchanged.</p>}
      {error && <div className="access-management-form-error" role="alert">{error}</div>}
      <footer><button type="button" className="soft-button" onClick={onClose} disabled={submitting}>Cancel</button><button type="submit" className="primary-button" disabled={submitting || (requiresProjects && projectIds.length === 0) || (dialog.kind === "edit" && !editHasChanges)}>{submitting ? "Saving…" : dialog.kind === "sign-out" ? "Sign out everywhere" : dialog.kind === "disable" ? "Disable access" : dialog.kind === "revoke" ? "Revoke invitation" : dialog.kind === "edit" ? "Save access" : "Create invitation"}</button></footer>
    </form>
  </AccessibleOverlay>;
}

function RolePicker({ roles, role, onRole, disabled, initialFocus = false }: {
  roles: readonly AdminAccessRoleSummary[];
  role: AdminAccessRoleKey;
  onRole: (role: AdminAccessRoleKey) => void;
  disabled: boolean;
  initialFocus?: boolean;
}) {
  return <label>Role<select data-overlay-initial-focus={initialFocus || undefined} value={role} onChange={(event) => onRole(event.target.value as AdminAccessRoleKey)} disabled={disabled}>{roles.map(({ key, displayName }) => <option key={key} value={key}>{displayName}</option>)}</select></label>;
}

function ProjectPicker({ overview, selected, onToggle, disabled }: {
  overview: AdminAccessOverview;
  selected: readonly string[];
  onToggle: (projectId: string) => void;
  disabled: boolean;
}) {
  return <fieldset className="access-management-project-picker"><legend>Assigned projects</legend><p>{selected.length} of {MAX_PROJECT_ASSIGNMENTS} selected. Select the exact projects this Project Manager can access.</p>{overview.projects.length === 0
    ? <p className="access-management-project-empty">No assignable projects are available. Choose another role or create a project first.</p>
    : <div>{overview.projects.map((project) => {
      const checked = selected.includes(project.id);
      return <label key={project.id}><input type="checkbox" checked={checked} onChange={() => onToggle(project.id)} disabled={disabled || (!checked && selected.length >= MAX_PROJECT_ASSIGNMENTS)} /><span><strong>{project.projectNumber}</strong>{project.name}<small>{project.status}</small></span></label>;
    })}</div>}</fieldset>;
}
