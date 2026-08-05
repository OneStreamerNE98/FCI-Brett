"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  CircleAlert,
  Clock3,
  Copy,
  Globe2,
  Mail,
  Settings,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { BUILD_INFORMATION } from "../../lib/build-information";
import { cachedGetJson } from "../../lib/client-get-cache";
import {
  useCachedGetSubscription,
  useClientLoadState,
} from "../../lib/client-get-hooks";
import { SettingsDataNotice } from "./SettingsDataNotice";
import styles from "./DataSecurityPanel.module.css";

const PhoneInstallPanel = dynamic(
  () => import("../../PhoneInstallPanel").then((module) => module.PhoneInstallPanel),
  { ssr: false, loading: () => <div className="phone-install-loading" role="status">Loading install guidance…</div> },
);

const DEVELOPMENT_ACCESS_URL = "/api/v1/settings/development-access";

type DevelopmentAccess = {
  officeEmails: string[];
  officeDomains: string[];
  adminEmails: string[];
};
type CopyState = "idle" | "copied" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIdentifierList(value: unknown) {
  if (!Array.isArray(value) || value.some((identifier) => typeof identifier !== "string" || !identifier)) {
    throw new Error("The server returned an invalid access list.");
  }
  return value as string[];
}

function parseDevelopmentAccess(value: unknown): DevelopmentAccess {
  if (!isRecord(value)) throw new Error("The server returned invalid access configuration.");
  return {
    officeEmails: parseIdentifierList(value.officeEmails),
    officeDomains: parseIdentifierList(value.officeDomains),
    adminEmails: parseIdentifierList(value.adminEmails),
  };
}

function IdentifierSummary({
  icon,
  label,
  identifiers,
}: {
  icon: React.ReactNode;
  label: string;
  identifiers: string[];
}) {
  return <div role="listitem">
    {icon}
    <span>
      <strong>{label}</strong>
      <small>{identifiers.length > 0 ? identifiers.join(", ") : "None configured"}</small>
    </span>
  </div>;
}

function BuildInformationCard() {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  async function copyBuildInformation() {
    if (!BUILD_INFORMATION) return;

    try {
      await navigator.clipboard.writeText(
        `Commit: ${BUILD_INFORMATION.commitSha}\nBuild time: ${BUILD_INFORMATION.builtAt}`,
      );
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return <section className={`panel settings-form-panel ${styles.buildInformation}`} aria-labelledby="build-information-heading">
    <div className="settings-heading">
      <div>
        <p className="eyebrow">Deployment reference</p>
        <h2 id="build-information-heading">Build information</h2>
        <p>Use this read-only identifier when recording or checking a deployment in GitHub issue #258.</p>
      </div>
      <Clock3 size={22} aria-hidden="true" />
    </div>

    {BUILD_INFORMATION ? <div className={`settings-data-notice ${styles.buildData}`} role="note">
      <Settings size={19} aria-hidden="true" />
      <div>
        <strong>Commit <code>{BUILD_INFORMATION.commitSha}</code></strong>
        <span>Built <time dateTime={BUILD_INFORMATION.builtAt}>{BUILD_INFORMATION.builtAt}</time></span>
        <span className="sr-only" role="status" aria-live="polite">
          {copyState === "copied"
            ? "Build information copied."
            : copyState === "error"
              ? "Build information could not be copied."
              : ""}
        </span>
      </div>
      <button type="button" className="soft-button" onClick={() => void copyBuildInformation()}>
        <Copy size={14} aria-hidden="true" />
        {copyState === "copied" ? "Copied" : "Copy build details"}
      </button>
    </div> : <div className={`settings-data-notice ${styles.buildData}`} role="status">
      <CircleAlert size={19} aria-hidden="true" />
      <div>
        <strong>Build identifier unavailable</strong>
        <span>This local build was not supplied verified commit and build-time metadata.</span>
      </div>
    </div>}
  </section>;
}

function WhoHasAccessCard() {
  const [access, setAccess] = useState<DevelopmentAccess | null>(null);
  const { state: loadState, error: loadError, run: runLoad } = useClientLoadState(
    "Development access configuration could not be loaded.",
  );

  const loadAccess = useCallback((force = false, silent = false) => runLoad(
    () => cachedGetJson<unknown>(DEVELOPMENT_ACCESS_URL, { force }).then(parseDevelopmentAccess),
    {
      onSuccess: setAccess,
      onFailure: () => setAccess(null),
    },
    { silent },
  ), [runLoad]);

  useEffect(() => {
    void Promise.resolve().then(() => loadAccess());
  }, [loadAccess]);

  useCachedGetSubscription([DEVELOPMENT_ACCESS_URL], () => loadAccess(false, true));

  const officeAccessConfigured = Boolean(
    access && (access.officeEmails.length > 0 || access.officeDomains.length > 0),
  );

  return <section className="panel settings-form-panel" aria-labelledby="development-access-heading">
    <div className="settings-heading">
      <div>
        <p className="eyebrow">Development sign-in gate</p>
        <h2 id="development-access-heading">Who has access</h2>
        <p>Review the hosted email, domain, and Administrator identifiers that control this development app.</p>
      </div>
      <UserRoundCheck size={22} aria-hidden="true" />
    </div>

    {loadState !== "ready" || !access ? <SettingsDataNotice
      state={loadState === "ready" ? "error" : loadState}
      error={loadError || "Development access configuration could not be loaded."}
      onRetry={() => void loadAccess(true)}
      loadingTitle="Checking development access…"
      loadingDetail="Reading the hosted identifier lists without exposing secrets."
      errorTitle="Access configuration could not be loaded"
    /> : <>
      {!officeAccessConfigured && <div className="settings-data-notice error" role="status">
        <CircleAlert size={19} aria-hidden="true" />
        <div>
          <strong>Office access is not configured — the app denies everyone</strong>
          <span>Add an approved office email or domain in hosting configuration before using the hosted app.</span>
        </div>
      </div>}

      <div className="settings-security-list" role="list" aria-label="Configured development access identifiers">
        <IdentifierSummary
          icon={<Mail size={18} aria-hidden="true" />}
          label="Office emails"
          identifiers={access.officeEmails}
        />
        <IdentifierSummary
          icon={<Globe2 size={18} aria-hidden="true" />}
          label="Office domains"
          identifiers={access.officeDomains}
        />
        <IdentifierSummary
          icon={<ShieldCheck size={18} aria-hidden="true" />}
          label="Administrator emails"
          identifiers={access.adminEmails}
        />
      </div>

      <div className="settings-static-row" role="note">
        <Settings size={17} aria-hidden="true" />
        <div>
          <strong>Hosting configuration owns this development list</strong>
          <span>Maintain these identifiers in hosting configuration. When live Google login is activated, manage people and roles in People &amp; Access.</span>
        </div>
      </div>
    </>}
  </section>;
}

export function DataSecurityPanel() {
  return <>
    <section className="panel settings-form-panel"><div className="settings-heading"><div><p className="eyebrow">Safety & access</p><h2>Data & security</h2><p>These safeguards protect the development workspace and identify what must be completed before staff-wide production use.</p></div></div><div className="settings-security-list"><div><ShieldCheck size={18} /><span><strong>Review-first email filing</strong><small>Messages retain Inbox; project copies and FCI/Filed occur only after a direct approval.</small></span></div><div><Users size={18} /><span><strong>One administrator-approved Workspace connection</strong><small>The company connection supplies Gmail, Calendar, Shared Drive, and Sheets. Consumer Google accounts are rejected in live mode.</small></span></div><div><Building2 size={18} /><span><strong>Local Workspace simulation is isolated</strong><small>Simulation uses local sample data, creates no OAuth tokens, and never sends requests to Google services.</small></span></div><div><Settings size={18} /><span><strong>Installable development web app</strong><small>This development site includes a web-app manifest. The future production app will be installed from its Google Cloud address.</small></span></div></div><PhoneInstallPanel /></section>
    <WhoHasAccessCard />
    <BuildInformationCard />
  </>;
}
