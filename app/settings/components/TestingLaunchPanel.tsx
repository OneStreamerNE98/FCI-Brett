"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  Clock3,
  KeyRound,
  Link2,
  LockKeyhole,
  ShieldCheck,
  Users,
} from "lucide-react";
import { readAdminAccessOverview } from "../../lib/admin-access-client";

const EMPLOYEE_LOGIN_REQUIREMENT_NAMES = [
  "FCI_EMPLOYEE_OIDC_CLIENT_ID",
  "FCI_EMPLOYEE_OIDC_CLIENT_SECRET or FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE",
  "FCI_EMPLOYEE_OIDC_REDIRECT_URI",
  "FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN",
] as const;

const ROLE_POLICY_REASON = "The first-release roles are fixed so server authorization stays consistent; People & Access assigns one role instead of editing capabilities.";
const SESSION_POLICY_REASON = "The session limits are fixed so sign-out and expiry are enforced consistently for every employee.";

type EmployeeLoginConfigurationState = "unconfigured" | "partial" | "ready";
type EmployeeLoginReadiness = Readonly<{
  configuration: Readonly<{
    state: EmployeeLoginConfigurationState;
    configuredCount: number;
    totalCount: number;
    requirements: readonly Readonly<{ name: string; configured: boolean }>[];
  }>;
  activationGate: Readonly<{
    state: "owner-approval-required";
    active: false;
  }>;
}>;
type PendingInvitationState = "loading" | "ready" | "unavailable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseEmployeeLoginReadiness(value: unknown): EmployeeLoginReadiness | null {
  if (!isRecord(value) || !isRecord(value.employeeLogin)) return null;
  const configuration = value.employeeLogin.configuration;
  const activationGate = value.employeeLogin.activationGate;
  if (!isRecord(configuration) || !isRecord(activationGate)) return null;
  if (!["unconfigured", "partial", "ready"].includes(String(configuration.state))) return null;
  if (!Array.isArray(configuration.requirements)) return null;
  const requirements = configuration.requirements;
  if (requirements.length !== EMPLOYEE_LOGIN_REQUIREMENT_NAMES.length) return null;
  for (const [index, requirement] of requirements.entries()) {
    if (
      !isRecord(requirement)
      || requirement.name !== EMPLOYEE_LOGIN_REQUIREMENT_NAMES[index]
      || typeof requirement.configured !== "boolean"
    ) return null;
  }
  if (
    configuration.totalCount !== EMPLOYEE_LOGIN_REQUIREMENT_NAMES.length
    || typeof configuration.configuredCount !== "number"
    || !Number.isInteger(configuration.configuredCount)
    || configuration.configuredCount < 0
    || configuration.configuredCount > EMPLOYEE_LOGIN_REQUIREMENT_NAMES.length
    || activationGate.state !== "owner-approval-required"
    || activationGate.active !== false
  ) return null;
  return {
    configuration: {
      state: configuration.state as EmployeeLoginConfigurationState,
      configuredCount: configuration.configuredCount,
      totalCount: configuration.totalCount,
      requirements: requirements as Readonly<{ name: string; configured: boolean }>[],
    },
    activationGate: {
      state: "owner-approval-required",
      active: false,
    },
  };
}

function configurationHeadline(readiness: EmployeeLoginReadiness | null, failed: boolean) {
  if (failed) return "Employee-login configuration is unavailable";
  if (!readiness) return "Checking employee-login configuration…";
  if (readiness.configuration.state === "ready") return "Employee-login configuration is present";
  if (readiness.configuration.state === "partial") {
    return `${readiness.configuration.configuredCount} of ${readiness.configuration.totalCount} login requirements are present`;
  }
  return "Employee login is not configured";
}

function invitationCopy(state: PendingInvitationState, count: number | null) {
  if (state === "loading") return "Checking the existing People & Access projection…";
  if (state === "ready" && count !== null) {
    return count === 1 ? "1 open invitation" : `${count} open invitations`;
  }
  return "Unavailable until the secure People & Access projection is active.";
}

export function TestingLaunchPanel({ onGoogleSetup }: { onGoogleSetup: () => void }) {
  void onGoogleSetup;
  const [readiness, setReadiness] = useState<EmployeeLoginReadiness | null>(null);
  const [readinessFailed, setReadinessFailed] = useState(false);
  const [pendingInvitationCount, setPendingInvitationCount] = useState<number | null>(null);
  const [pendingInvitationState, setPendingInvitationState] = useState<PendingInvitationState>("loading");

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const readinessRequest = fetch("/api/v1/settings/employee-login-readiness", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("employee_login_readiness_unavailable");
      const parsed = parseEmployeeLoginReadiness(await response.json());
      if (!parsed) throw new Error("employee_login_readiness_invalid");
      return parsed;
    });
    // Pending invitations stay owned by the existing secure access projection. This
    // panel does not duplicate its SQL or invent a development-only invitation count.
    const invitationRequest = readAdminAccessOverview(true).then((overview) => {
      const count = overview.summary.pendingInvitationCount;
      if (!Number.isInteger(count) || count < 0) throw new Error("pending_invitation_count_invalid");
      return count;
    });

    void Promise.allSettled([readinessRequest, invitationRequest]).then(([readinessResult, invitationResult]) => {
      if (!current) return;
      if (readinessResult.status === "fulfilled") {
        setReadiness(readinessResult.value);
      } else {
        setReadinessFailed(true);
      }
      if (invitationResult.status === "fulfilled") {
        setPendingInvitationCount(invitationResult.value);
        setPendingInvitationState("ready");
      } else {
        setPendingInvitationState("unavailable");
      }
    });

    return () => {
      current = false;
      controller.abort();
    };
  }, []);

  const configurationReady = readiness?.configuration.state === "ready";
  const configurationChip = readinessFailed
    ? "Unavailable"
    : !readiness
      ? "Checking"
      : configurationReady
        ? "Configuration ready"
        : "Setup required";

  return <div className="settings-panel-stack">
    <section className="panel test-launch">
      <div className="settings-heading">
        <div><p className="eyebrow">Development verification</p><h2>Test & launch checklist</h2><p>Use this working development copy to verify durable workflows before the Google Cloud production environment is opened to staff.</p></div>
        <a className="primary-button" href="/settings?section=google-workspace#workspace-stage-4">Open Google Workspace setup</a>
      </div>
      <ol className="test-checklist">
        <li><strong>Environment boundary:</strong> this Sites deployment is the working development copy. Production will run on Cloud Run and Cloud SQL PostgreSQL.</li>
        <li><strong>Clients and projects:</strong> add a test client, create two independent projects, create their folders, refresh, and verify the relationships persist.</li>
        <li><strong>Meetings:</strong> save an Otter-linked summary with decisions and action items, reload it, and ask the assistant about the meeting.</li>
        <li><strong>Inbox:</strong> connect the approved test Workspace mailbox, prepare labels, save a reply draft, and review-file one message to the exact project.</li>
        <li><strong>Calendar:</strong> verify connected calendar readiness. Shift, crew, conflict, publishing, and acknowledgement tests remain blocked until those durable models exist.</li>
        <li><strong>AI:</strong> ask a project question and open every cited source. Configure OpenAI separately before evaluating generated answers.</li>
        <li><strong>Production readiness:</strong> verify Google Cloud deployment, Workspace OIDC, backups, audit access, Shared Drive, mailbox, Sheet, calendars, OAuth client, and allowed domain before staff launch.</li>
      </ol>
    </section>

    <section className="panel settings-form-panel" aria-labelledby="employee-login-readiness-heading">
      <div className="settings-heading">
        <div><p className="eyebrow">Employee access</p><h2 id="employee-login-readiness-heading">Employee-login readiness</h2><p>Presence checks only: this card shows configuration names and access readiness without exposing any configured value.</p></div>
        <span className={`status ${configurationReady ? "status-connected" : "status-inactive"}`}>{configurationChip}</span>
      </div>
      <div className={`settings-connection ${configurationReady ? "ready" : ""}`} role="status">
        <KeyRound size={18} aria-hidden="true" />
        <div>
          <strong>{configurationHeadline(readiness, readinessFailed)}</strong>
          <span>Employee login uses a separate authentication-only Google client; it never shares the Gmail, Calendar, Drive, or Sheets connector.</span>
        </div>
      </div>
      <div className="settings-security-list" aria-label="Employee login readiness details">
        {(readiness?.configuration.requirements ?? EMPLOYEE_LOGIN_REQUIREMENT_NAMES.map((name) => ({ name, configured: false }))).map((requirement) => <div key={requirement.name}>
          {readiness && requirement.configured ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleDashed size={18} aria-hidden="true" />}
          <span><strong>{requirement.name}</strong><small>{readiness ? (requirement.configured ? "Present" : "Missing") : readinessFailed ? "Unavailable" : "Checking presence…"}</small></span>
        </div>)}
        <div>
          <Users size={18} aria-hidden="true" />
          <span><strong>Pending People &amp; Access invitations</strong><small>{invitationCopy(pendingInvitationState, pendingInvitationCount)}</small></span>
        </div>
        <div>
          <LockKeyhole size={18} aria-hidden="true" />
          <span><strong>Owner activation gate</strong><small>Not activated — owner approval, production migration and grants, live OIDC configuration, and deployment are still required.</small></span>
        </div>
      </div>
    </section>

    <section className="panel settings-form-panel" aria-labelledby="role-policy-heading">
      <div className="settings-heading">
        <div><p className="eyebrow">Read-only access policy</p><h2 id="role-policy-heading">What each role can do</h2><p>The first release uses four fixed access shapes with no custom roles or per-user capability overrides.</p></div>
        <span className="status status-inactive" title={ROLE_POLICY_REASON}>Fixed policy</span>
      </div>
      <div className="settings-security-list">
        <div><ShieldCheck size={18} aria-hidden="true" /><span><strong>Administrator</strong><small>Company-wide operations and financial visibility, plus project assignment, sensitive Google actions, exports, audit, and access administration.</small></span></div>
        <div><Users size={18} aria-hidden="true" /><span><strong>Office Operations</strong><small>Company-wide nonfinancial operations, including leads, clients, contacts, and updates to existing project work.</small></span></div>
        <div><Users size={18} aria-hidden="true" /><span><strong>Project Manager</strong><small>Nonfinancial operations only for explicitly assigned projects and their related client context.</small></span></div>
        <div><Link2 size={18} aria-hidden="true" /><span><strong>Field link</strong><small>Future read-only access to one exact project through an expiring, revocable link; no employee account.</small></span></div>
      </div>
      <p className="form-help"><LockKeyhole size={14} aria-hidden="true" /> {ROLE_POLICY_REASON}</p>
    </section>

    <section className="panel settings-form-panel" aria-labelledby="session-policy-heading">
      <div className="settings-heading">
        <div><p className="eyebrow">Read-only session policy</p><h2 id="session-policy-heading">Employee session limits</h2><p>Every employee session follows the same server-enforced expiration policy.</p></div>
        <span className="status status-inactive" title={SESSION_POLICY_REASON}>Fixed policy</span>
      </div>
      <div className="settings-security-list">
        <div><Clock3 size={18} aria-hidden="true" /><span><strong>30-minute idle limit</strong><small>A session expires after 30 minutes without activity.</small></span></div>
        <div><Clock3 size={18} aria-hidden="true" /><span><strong>8-hour absolute limit</strong><small>A session expires after eight hours even when the employee remains active.</small></span></div>
      </div>
      <p className="form-help"><LockKeyhole size={14} aria-hidden="true" /> {SESSION_POLICY_REASON}</p>
    </section>
  </div>;
}
