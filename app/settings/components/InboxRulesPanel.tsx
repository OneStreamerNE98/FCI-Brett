"use client";

import { type FormEvent, useState } from "react";
import { Mail, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { OperationsDataTable, OperationsDataTableCell } from "../../components/operations/OperationsDataTable";
import { Status } from "../../components/operations/OperationsPrimitives";
import { DRIVE_BLUEPRINT, type FilingRuleDraft } from "../../lib/google-workspace";

const INBOX_RULE_COLUMNS = [
  { key: "priority", label: "Priority" },
  { key: "rule", label: "Rule" },
  { key: "match", label: "When it matches" },
  { key: "action", label: "Action" },
  { key: "destination", label: "Destination" },
] as const;

export function InboxRulesPanel({ rules, onAddRule, onUpdateRule, onDeleteRule }: { rules: FilingRuleDraft[]; onAddRule: () => void; onUpdateRule: (rule: FilingRuleDraft, patch: Partial<Pick<FilingRuleDraft, "enabled" | "priority">>) => Promise<void>; onDeleteRule: (rule: FilingRuleDraft) => Promise<void> }) {
  return <section aria-labelledby="inbox-rules-heading" className="panel rule-settings">
        <div className="settings-heading"><div><p className="eyebrow">Gmail intake rules</p><h2 id="inbox-rules-heading">Inbox & file rules</h2><p>Rules run in priority order. Paused rules do not influence suggestions, and every filing still requires approval.</p></div><button className="primary-button" onClick={onAddRule}><Plus size={16} /> Add rule</button></div>
        <div className="rule-callout"><ShieldCheck size={19} /><p><strong>Multi-project protection</strong><br />A project number is the safest match. A client with multiple independent projects is always kept in review until you choose the exact job.</p></div>
        <OperationsDataTable className="rules-data-table" columns={INBOX_RULE_COLUMNS} labelledBy="inbox-rules-heading">
          {rules.map((rule) => <tr key={rule.id ?? rule.name}>
            <OperationsDataTableCell label="Priority"><span className="rule-priority">{rule.priority}</span></OperationsDataTableCell>
            <OperationsDataTableCell label="Rule"><div className="rule-name"><strong>{rule.name}</strong><small>{rule.enabled ? "Enabled" : "Paused"} · approval required</small><div className="rule-inline-actions"><button className="soft-button" onClick={() => void onUpdateRule(rule, { enabled: !rule.enabled })}>{rule.enabled ? "Pause" : "Enable"}</button>{rule.id && <button className="icon-text-button danger" aria-label={`Delete ${rule.name}`} onClick={() => { if (window.confirm(`Delete the email rule “${rule.name}”?`)) void onDeleteRule(rule); }}><Trash2 size={14} /> Delete</button>}</div></div></OperationsDataTableCell>
            <OperationsDataTableCell label="When it matches">{rule.matchSummary}</OperationsDataTableCell>
            <OperationsDataTableCell label="Action"><Status text={rule.action === "review" ? "Needs review" : rule.action === "ignore" ? "Ignored" : "Suggest"} /></OperationsDataTableCell>
            <OperationsDataTableCell label="Destination">{rule.targetCategory}</OperationsDataTableCell>
          </tr>)}
        </OperationsDataTable>
        <div className="rule-footnote"><Mail size={15} /><span>Custom rules are saved as review-first policies until a supported matcher is added. Keep Gmail simple: use only <b>{DRIVE_BLUEPRINT.gmailLabels.join(", ")}</b>. The project’s Drive folder—not a Gmail label per project—is the permanent filing location.</span></div>
      </section>;
}

export function RuleModal({ onClose, onSave }: { onClose: () => void; onSave: (rule: FilingRuleDraft) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); try { await onSave({ name: String(form.get("name")), enabled: true, priority: Number(form.get("priority")), matchSummary: String(form.get("matchSummary")), action: String(form.get("action")) as FilingRuleDraft["action"], targetCategory: String(form.get("targetCategory")), approvalRequired: true }); } finally { setSaving(false); } }
  return <AccessibleOverlay ariaLabel="Add an email filing rule" contentClassName="modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">Gmail intake</p><h2>Add an email filing rule</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}><label>Rule name<input data-overlay-initial-focus name="name" required placeholder="e.g. Estimator bid invitations" /></label><div className="form-row"><label>Priority<input name="priority" type="number" min="1" defaultValue="10" required /></label><label>Action<select name="action"><option value="suggest">Suggest a project</option><option value="review">Send to review</option><option value="ignore">Ignore</option></select></label></div><label>When this matches<textarea name="matchSummary" required placeholder="Example: sender is estimator@builder.com and subject contains BID" /></label><label>Default Drive destination<input name="targetCategory" required defaultValue="05_Correspondence / Email Archive" /></label><p className="form-help"><ShieldCheck size={14} /> New rules always require review before Gmail labels, email archives, or attachments are changed.</p><footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add rule"}</button></footer></form></AccessibleOverlay>;
}

