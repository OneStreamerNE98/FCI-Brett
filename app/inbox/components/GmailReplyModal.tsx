"use client";

import { useEffect, useState } from "react";
import { Mail, Reply, ShieldCheck, Sparkles, X } from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import type { WorkspaceMessage } from "../../settings/components/GoogleWorkspacePanel";

type AssistantReplyConfiguration = {
  keyState: "Configured" | "Missing";
  features: { replyDrafts: boolean };
};

export function GmailReplyModal({ message, body, saving, onBody, onSave, onClose }: { message: WorkspaceMessage; body: string; saving: boolean; onBody: (value: string) => void; onSave: () => void; onClose: () => void }) {
  const [configuration, setConfiguration] = useState<AssistantReplyConfiguration | null>(null);
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/v1/assistant/config", { headers: { Accept: "application/json" } });
        const data = await response.json().catch(() => null) as { keyState?: unknown; features?: { replyDrafts?: unknown } } | null;
        if (active && response.ok && data && (data.keyState === "Configured" || data.keyState === "Missing")) {
          setConfiguration({ keyState: data.keyState, features: { replyDrafts: data.features?.replyDrafts === true } });
        }
      } catch {
        // Availability is a non-blocking enhancement; a failure leaves the AI
        // action honestly disabled rather than breaking the human reply flow.
      } finally {
        if (active) setConfigurationLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);

  const replyDraftsReady = configuration?.keyState === "Configured" && configuration.features.replyDrafts;
  const gateNote = !configurationLoaded
    ? "Checking whether AI reply drafting is available…"
    : configuration?.keyState === "Missing"
      ? "AI reply drafting is unavailable until OPENAI_API_KEY is configured for the workspace."
      : replyDraftsReady
        ? null
        : "AI reply drafting is turned off in AI settings.";

  async function requestDraft() {
    setConfirmingReplace(false);
    setDrafting(true);
    setDraftError(null);
    try {
      const response = await fetch("/api/v1/assistant/reply-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: message.id }) });
      const data = await response.json().catch(() => ({})) as { draft?: string; error?: string };
      if (!response.ok || typeof data.draft !== "string") throw new Error(data.error ?? "AI reply drafting is temporarily unavailable.");
      onBody(data.draft);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "AI reply drafting is temporarily unavailable.");
    } finally {
      setDrafting(false);
    }
  }

  function onDraftWithAi() {
    setDraftError(null);
    // Confirm before overwriting anything the human already wrote.
    if (body.trim()) { setConfirmingReplace(true); return; }
    void requestDraft();
  }

  return <AccessibleOverlay ariaLabel="Save a Gmail reply draft" contentClassName="modal gmail-reply-modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">Workspace Gmail draft</p><h2>Save a reply draft</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={(event) => { event.preventDefault(); onSave(); }}><div className="modal-detail"><div className="filing-message-summary"><Mail size={17} /><div><strong>{message.subject || "(No subject)"}</strong><span>Reply target: {message.from || "original sender"}</span></div></div><div className="reply-ai-draft"><button type="button" className="soft-button" onClick={onDraftWithAi} disabled={saving || drafting || !replyDraftsReady}><Sparkles size={15} /> {drafting ? "Drafting…" : "Draft with AI"}</button>{gateNote && <span className="form-help">{gateNote}</span>}</div>{confirmingReplace && <div className="reply-ai-confirm" role="group" aria-label="Confirm AI draft replacement"><span className="form-help">Replace your current reply text with an AI draft? Your saved records answer what they can; the rest is left as [...] for you to complete.</span><button type="button" className="soft-button" onClick={() => setConfirmingReplace(false)} disabled={drafting}>Keep my text</button><button type="button" className="soft-button" onClick={() => void requestDraft()} disabled={drafting}>Replace with AI draft</button></div>}{draftError && <p className="reply-ai-error" role="alert">{draftError}</p>}<label>Reply message<textarea data-overlay-initial-focus value={body} onChange={(event) => onBody(event.target.value)} placeholder="Write your reply…" maxLength={6000} required disabled={saving} /></label><p className="form-help"><ShieldCheck size={14} /> Live mode saves an unsent draft in the original Workspace Gmail thread. Simulation stores a local draft only. Sending remains a separate, deliberate action.</p></div><footer className="modal-footer"><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !body.trim()}>{saving ? "Saving…" : <><Reply size={16} /> Save draft</>}</button></footer></form></AccessibleOverlay>;
}
