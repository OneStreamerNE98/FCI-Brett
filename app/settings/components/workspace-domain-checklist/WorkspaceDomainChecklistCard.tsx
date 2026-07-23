"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { OperationsDataTable, OperationsDataTableCell } from "../../../components/operations/OperationsDataTable";
import { Status } from "../../../components/operations/OperationsPrimitives";
import { WorkspaceInfoHint } from "../workspace-setup-shell/WorkspaceInfoHint";
import styles from "./WorkspaceDomainChecklistCard.module.css";
import {
  deriveWorkspaceDomainChecklist,
  missingWorkspaceDotenvTemplate,
  visibleWorkspacePrerequisites,
  WORKSPACE_OAUTH_REDIRECT_URI,
  WORKSPACE_TOKEN_KEY_COMMAND,
  workspaceCopyHelperState,
  workspaceDomainChecklistDisplayStatus,
  workspaceDomainChecklistStatusClass,
  workspaceSharedDriveRestrictionStatus,
  type WorkspaceChecklistLoadState,
  type WorkspaceChecklistMissingDetail,
  type WorkspaceChecklistResourceSource,
  type WorkspaceDomainChecklistKey,
} from "./workspace-domain-checklist";

type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;

export type WorkspaceDomainChecklistCardProps = {
  isAdmin: boolean;
  simulation: boolean;
  readinessState: WorkspaceChecklistLoadState;
  missingDetails: readonly WorkspaceChecklistMissingDetail[];
  resourcesState: WorkspaceChecklistLoadState;
  resourcesAvailable: boolean;
  resources: readonly WorkspaceChecklistResourceSource[];
  connectReady: boolean;
  allowedDomainCount: number;
  intakeMailboxMatches: boolean | null;
  hasConnectionAccount: boolean;
  connectionState: WorkspaceChecklistLoadState;
  connectionStatus: string | null;
  requiresReauthorization: boolean;
  sharedDriveDomainUsersOnly: boolean | null;
  environmentNotes: ReactNode;
  notify: Notify;
};

const WORKSPACE_PREREQUISITE_COLUMNS = [
  { key: "requirement", label: "Requirement" },
  { key: "environment", label: "Environment key" },
  { key: "origin", label: "Origin" },
] as const;

const DOMAIN_CHECKLIST_ITEMS: readonly {
  key: WorkspaceDomainChecklistKey;
  title: string;
  instruction: string;
  href?: string;
  linkLabel?: string;
}[] = [
  {
    key: "domain",
    title: "Company domain",
    instruction: "Verify the company domain in Google Admin, then keep only the approved Workspace domain in hosted configuration.",
    href: "https://admin.google.com/ac/domains/manage",
    linkLabel: "Open Domains",
  },
  {
    key: "operations-account",
    title: "Operations account",
    instruction: "Confirm one company-owned operations user and use that exact address for both the authorized connection account and intake mailbox.",
    href: "https://admin.google.com/ac/users",
    linkLabel: "Open Users",
  },
  {
    key: "apis",
    title: "Workspace APIs",
    instruction: "In the approved development Cloud project, enable Drive, Gmail, Calendar, and Sheets, and keep Pub/Sub disabled.",
    href: "https://console.cloud.google.com/apis/library",
    linkLabel: "Open API Library",
  },
  {
    key: "oauth",
    title: "OAuth web client",
    instruction: "Use the development Web application client and add the displayed redirect URI character-for-character.",
    href: "https://console.cloud.google.com/apis/credentials",
    linkLabel: "Open Credentials",
  },
  {
    key: "secrets",
    title: "Hosted secrets",
    instruction: "Open this Site's settings and store the OAuth client secret and token-encryption key only in runtime settings marked as secrets.",
    href: "https://chatgpt.com/sites",
    linkLabel: "Open Sites",
  },
  {
    key: "groups",
    title: "Role-aligned Google Groups",
    instruction: "Create role-aligned Google Groups and review least-privilege membership manually before staff launch.",
    href: "https://admin.google.com/ac/groups",
    linkLabel: "Open Groups",
  },
];

export function WorkspaceDomainChecklistCard({
  isAdmin,
  simulation,
  readinessState,
  missingDetails,
  resourcesState,
  resourcesAvailable,
  resources,
  connectReady,
  allowedDomainCount,
  intakeMailboxMatches,
  hasConnectionAccount,
  connectionState,
  connectionStatus,
  requiresReauthorization,
  sharedDriveDomainUsersOnly,
  environmentNotes,
  notify,
}: WorkspaceDomainChecklistCardProps) {
  const results = deriveWorkspaceDomainChecklist({
    isAdmin,
    simulation,
    readinessKnown: readinessState === "ready",
    missingDetails,
    resourcesKnown: resourcesState === "ready" && resourcesAvailable,
    connectReady,
    allowedDomainCount,
    intakeMailboxMatches,
    hasConnectionAccount,
    connectionKnown: connectionState === "ready",
    connectionStatus,
    requiresReauthorization,
  });
  const statusByKey = new Map(results.map((result) => [result.key, result.status]));
  const displayedMissingDetails = visibleWorkspacePrerequisites(missingDetails, resources);
  const dotenvTemplate = missingWorkspaceDotenvTemplate(missingDetails, resources, simulation);
  const copyState = workspaceCopyHelperState(readinessState, resourcesState, resourcesAvailable);
  const sharedDriveRestrictionStatus = workspaceSharedDriveRestrictionStatus(
    resourcesState === "ready" && resourcesAvailable ? sharedDriveDomainUsersOnly : null,
  );

  async function copySetupHelper(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copied.`, "success");
    } catch {
      notify(`${label} could not be copied. Select the text and copy it manually.`, "error");
    }
  }

  return <section className={`workspace-prerequisites ${styles.card}`} aria-labelledby="workspace-domain-checklist-heading">
    <header>
      <div><p className="eyebrow">Manual tenant setup</p><h3 id="workspace-domain-checklist-heading">Domain & tenant checklist</h3></div>
    </header>
    <p>Use this guide for the Google Admin, Cloud Console, and hosting steps that remain manual. Confirm the correct company tenant and development project before making changes.</p>
    <div id="workspace-domain-checklist-content">
      {!isAdmin && <p className="workspace-admin-readonly"><ShieldCheck size={15} /><span>An Administrator completes tenant setup. This Office view is informational and makes no administrator setup request.</span></p>}
      <ol className={styles.list}>
        {DOMAIN_CHECKLIST_ITEMS.map((item) => {
          const status = statusByKey.get(item.key) ?? "Unavailable";
          const displayStatus = workspaceDomainChecklistDisplayStatus(status);
          return <li key={item.key}>
            <div className={styles.copy}>
              <strong>{item.title}</strong>
              <WorkspaceInfoHint
                label={`About ${item.title}`}
                text={`${item.instruction} Current check: ${status}.`}
              />
            </div>
            <span className={`${styles.status} ${styles[displayStatus === "DONE" ? "done" : "missing"]}`}>{displayStatus}</span>
            {isAdmin && item.href && <a className={`soft-button ${styles.link}`} href={item.href} target="_blank" rel="noreferrer">{item.linkLabel}<ExternalLink size={13} aria-hidden="true" /></a>}
          </li>;
        })}
      </ol>
      {!simulation && isAdmin && <section className={styles.hostedPrerequisites} aria-labelledby="workspace-prerequisites-heading">
        <div className={styles.hostedPrerequisitesHeading}><div><h4 id="workspace-prerequisites-heading">Hosted Workspace configuration</h4><p>Configured in the hosting environment, not this app. Only presence or absence is shown; configured values and secrets are never returned.</p></div><Status text={readinessState === "error" ? "Unavailable" : readinessState !== "ready" ? "Loading" : displayedMissingDetails.length ? connectReady ? "Connection ready" : "Setup required" : "Complete"} /></div>
        {readinessState === "error" ? <p className="workspace-resources-message" role="alert">Hosted configuration presence is unavailable. Retry the readiness check before treating a missing row as complete.</p> : readinessState !== "ready" ? <p className="workspace-resources-message" role="status">Loading hosted configuration presence…</p> : displayedMissingDetails.length > 0 ? <OperationsDataTable className="workspace-prerequisite-table" columns={WORKSPACE_PREREQUISITE_COLUMNS} labelledBy="workspace-prerequisites-heading">
          {displayedMissingDetails.map((detail) => <tr key={`${detail.label}-${detail.envVar}`}>
            <OperationsDataTableCell label="Requirement"><strong>{detail.label}</strong></OperationsDataTableCell>
            <OperationsDataTableCell label="Environment key"><code>{detail.envVar}</code></OperationsDataTableCell>
            <OperationsDataTableCell label="Origin"><span className={`workspace-origin-tag ${detail.secret ? "secret" : "value"}`}>{detail.secret ? "Hosted secret — never in the app or Git" : "Hosted environment value"}</span></OperationsDataTableCell>
          </tr>)}
        </OperationsDataTable> : <p className="workspace-prerequisites-ready"><CheckCircle2 size={15} /> All required hosted values are present.</p>}
      </section>}
      {isAdmin && <div className="workspace-copy-helpers" aria-labelledby="workspace-copy-helpers-heading">
        <div><h4 id="workspace-copy-helpers-heading">Copy-exact setup helpers</h4><p>These helpers contain names and safe placeholders only. They never copy a configured value, OAuth secret, encryption key, or token.</p></div>
        <article>
          <div><strong>OAuth redirect URI</strong><span>Paste this URI character-for-character into the development OAuth web client.</span></div>
          <div className="workspace-copy-value"><code>{WORKSPACE_OAUTH_REDIRECT_URI}</code><button className="soft-button" type="button" onClick={() => void copySetupHelper(WORKSPACE_OAUTH_REDIRECT_URI, "OAuth redirect URI")}><Copy size={14} /> Copy URI</button></div>
        </article>
        <article>
          <div><strong>Missing hosted keys</strong><span>Paste the template into hosted runtime settings, then replace every placeholder in approved secret storage.</span></div>
          {copyState === "ready" && dotenvTemplate ? <><pre><code>{dotenvTemplate}</code></pre><button className="soft-button" type="button" onClick={() => void copySetupHelper(dotenvTemplate, "Missing-key dotenv template")}><Copy size={14} /> Copy missing-key template</button></> : copyState === "ready" ? <p className="workspace-copy-empty"><CheckCircle2 size={14} /> No hosted configuration keys are currently missing.</p> : <p className="workspace-resources-message" role="status">{copyState === "unavailable" ? "Missing-key status is unavailable. Retry the readiness and Resources checks before copying configuration." : "Loading missing-key status…"}</p>}
        </article>
        <article>
          <div><strong>Generate the token-encryption key</strong><span>Run this command on a trusted computer; store its output only as a hosted secret.</span></div>
          <div className="workspace-copy-value"><code>{WORKSPACE_TOKEN_KEY_COMMAND}</code><button className="soft-button" type="button" onClick={() => void copySetupHelper(WORKSPACE_TOKEN_KEY_COMMAND, "Encryption-key command")}><Copy size={14} /> Copy command</button></div>
        </article>
      </div>}
      {isAdmin && environmentNotes}
      {isAdmin && <p className={styles.restrictions}><strong>Shared Drive external sharing</strong><span className={`${styles.status} ${styles[workspaceDomainChecklistStatusClass(sharedDriveRestrictionStatus)]}`}>{sharedDriveRestrictionStatus}</span></p>}
      <p className={styles.safeguards}><ShieldCheck size={15} aria-hidden="true" /><span>{simulation ? "Use only seeded sample data; no OAuth account or Google token is connected. Keep Gmail filing review-first and project-specific, and verify both shared calendars and the Sheets mirror before staff launch." : "Keep authorization restricted to the approved Workspace domain. Keep Gmail filing review-first and project-specific; before staff launch, verify the company-owned Shared Drive and sender mailbox, both shared calendars, and the Sheets mirror."}</span></p>
    </div>
  </section>;
}
