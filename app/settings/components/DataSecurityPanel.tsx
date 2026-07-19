"use client";

import dynamic from "next/dynamic";
import { Building2, Settings, ShieldCheck, Users } from "lucide-react";

const PhoneInstallPanel = dynamic(
  () => import("../../PhoneInstallPanel").then((module) => module.PhoneInstallPanel),
  { ssr: false, loading: () => <div className="phone-install-loading" role="status">Loading install guidance…</div> },
);

export function DataSecurityPanel() {
  return <section className="panel settings-form-panel"><div className="settings-heading"><div><p className="eyebrow">Safety & access</p><h2>Data & security</h2><p>These safeguards protect the development workspace and identify what must be completed before staff-wide production use.</p></div></div><div className="settings-security-list"><div><ShieldCheck size={18} /><span><strong>Review-first email filing</strong><small>Messages retain Inbox; project copies and FCI/Filed occur only after a direct approval.</small></span></div><div><Users size={18} /><span><strong>One administrator-approved Workspace connection</strong><small>The company connection supplies Gmail, Calendar, Shared Drive, and Sheets. Consumer Google accounts are rejected in live mode.</small></span></div><div><Building2 size={18} /><span><strong>Local Workspace simulation is isolated</strong><small>Simulation uses local sample data, creates no OAuth tokens, and never sends requests to Google services.</small></span></div><div><Settings size={18} /><span><strong>Installable development web app</strong><small>This development site includes a web-app manifest. The future production app will be installed from its Google Cloud address.</small></span></div></div><PhoneInstallPanel /></section>;
}

