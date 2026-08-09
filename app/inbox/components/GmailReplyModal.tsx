"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Mail, Reply, ShieldCheck, Sparkles, X } from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { cachedGetJson, isTerminalCachedGetError } from "../../lib/client-get-cache";
import { useCachedGetSubscription } from "../../lib/client-get-hooks";
import type { WorkspaceMessage } from "../../settings/components/GoogleWorkspacePanel";

type AssistantReplyConfiguration = {
  keyState: "Configured" | "Missing";
  features: { replyDrafts: boolean };
};

const ASSISTANT_CONFIG_URL = "/api/v1/assistant/config";

export function GmailReplyModal({ mailboxEmail, message, body, saving, onBody, onSave, onClose }: { mailboxEmail?: string | null; message: WorkspaceMessage; body: string; saving: boolean; onBody: (value: string) => void; onSave: () => void; onClose: () => void }) {
  const [configuration, setConfiguration] = useState<AssistantReplyConfiguration | null>(null);
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  // A draft that arrived after the human typed is held here until they confirm;
  // it is never written into the composer on its own.
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);

  const gateNoteId = useId();
  // AI-05 idiom (InboxView's triageRequestIdRef): only the newest request may
  // apply its result. The message id is carried alongside so a response can
  // never land in a composer that has moved on to a different message.
  const draftRequestIdRef = useRef(0);
  const draftAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const composingMessageIdRef = useRef(message.id);
  const bodyRef = useRef(body);
  // The composer opens pre-filled by InboxView with the saved reply signature
  // (`\n\n${replySignature}`) or with "". An untouched body is byte-identical to
  // that pre-fill, so a saved signature must not count as text the human wrote.
  const prefilledBodyRef = useRef(body);
  const prefilledMessageIdRef = useRef(message.id);
  const confirmRef = useRef<HTMLDivElement>(null);
  const focusConfirmRef = useRef(false);

  useEffect(() => { bodyRef.current = body; }, [body]);
  useEffect(() => { composingMessageIdRef.current = message.id; }, [message.id]);

  useEffect(() => {
    if (prefilledMessageIdRef.current === message.id) return;
    prefilledMessageIdRef.current = message.id;
    prefilledBodyRef.current = body;
  }, [message.id, body]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Closing the modal supersedes any in-flight draft and abandons its fetch.
      draftRequestIdRef.current += 1;
      draftAbortRef.current?.abort();
    };
  }, []);

  // AI-07 AssistantView idiom: move focus to the block that just appeared so a
  // screen-reader user hears the confirmation instead of losing their place.
  useEffect(() => {
    if (!confirmingReplace || !focusConfirmRef.current) return;
    focusConfirmRef.current = false;
    confirmRef.current?.focus();
  }, [confirmingReplace]);

  const loadConfiguration = useCallback(async () => {
    try {
      const data = await cachedGetJson<{
        keyState?: unknown;
        features?: { replyDrafts?: unknown };
      }>(ASSISTANT_CONFIG_URL);
      if (data.keyState === "Configured" || data.keyState === "Missing") {
        setConfiguration({
          keyState: data.keyState,
          features: { replyDrafts: data.features?.replyDrafts === true },
        });
      }
    } catch (error) {
      // Availability is a non-blocking enhancement; a failure leaves the AI
      // action honestly disabled rather than breaking the human reply flow.
      if (isTerminalCachedGetError(error)) setConfiguration(null);
    } finally {
      setConfigurationLoaded(true);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadConfiguration);
  }, [loadConfiguration]);

  useCachedGetSubscription([ASSISTANT_CONFIG_URL], loadConfiguration);

  const replyDraftsReady = configuration?.keyState === "Configured" && configuration.features.replyDrafts;
  const gateNote = !configurationLoaded
    ? "Checking whether AI reply drafting is available…"
    : configuration?.keyState === "Missing"
      ? "AI reply drafting is unavailable until OPENAI_API_KEY is configured for the workspace."
      : replyDraftsReady
        ? null
        : "AI reply drafting is turned off in AI settings.";
  const draftBlocked = saving || drafting || !replyDraftsReady;

  // Exact comparison, never a fuzzy match: blank, or byte-identical to the
  // signature pre-fill this composer was opened with.
  function bodyIsUntouched(value: string) {
    return value.trim() === "" || value === prefilledBodyRef.current;
  }

  function isCurrentDraftRequest(requestId: number, requestMessageId: string) {
    return mountedRef.current
      && requestId === draftRequestIdRef.current
      && requestMessageId === composingMessageIdRef.current;
  }

  async function requestDraft() {
    setConfirmingReplace(false);
    setPendingDraft(null);
    setDrafting(true);
    setDraftError(null);
    const requestId = ++draftRequestIdRef.current;
    const requestMessageId = message.id;
    const requestBody = body;
    draftAbortRef.current?.abort();
    const controller = new AbortController();
    draftAbortRef.current = controller;
    try {
      const mailboxQuery = mailboxEmail
        ? `?mailbox=${encodeURIComponent(mailboxEmail)}`
        : "";
      const response = await fetch(`/api/v1/assistant/reply-draft${mailboxQuery}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: requestMessageId }), signal: controller.signal });
      const data = await response.json().catch(() => ({})) as { draft?: string; error?: string };
      // A superseded request, or one whose message is no longer the composed
      // message, is discarded silently — it must never reach another recipient.
      if (!isCurrentDraftRequest(requestId, requestMessageId)) return;
      if (!response.ok || typeof data.draft !== "string") throw new Error(data.error ?? "AI reply drafting is temporarily unavailable.");
      // Text typed while the draft was in flight is held for the same confirm
      // the click-time check applies, never clobbered.
      if (bodyRef.current !== requestBody && !bodyIsUntouched(bodyRef.current)) {
        setPendingDraft(data.draft);
        focusConfirmRef.current = true;
        setConfirmingReplace(true);
        return;
      }
      onBody(data.draft);
    } catch (error) {
      if (!isCurrentDraftRequest(requestId, requestMessageId)) return;
      setDraftError(error instanceof Error ? error.message : "AI reply drafting is temporarily unavailable.");
    } finally {
      if (isCurrentDraftRequest(requestId, requestMessageId)) setDrafting(false);
    }
  }

  function onDraftWithAi() {
    // aria-disabled keeps the gate note reachable, so the click is a no-op here.
    if (draftBlocked) return;
    setDraftError(null);
    setPendingDraft(null);
    // Confirm before overwriting anything the human already wrote.
    if (!bodyIsUntouched(body)) {
      focusConfirmRef.current = true;
      setConfirmingReplace(true);
      return;
    }
    void requestDraft();
  }

  function keepMyText() {
    setConfirmingReplace(false);
    setPendingDraft(null);
  }

  function replaceWithAiDraft() {
    const ready = pendingDraft;
    if (ready !== null) {
      setConfirmingReplace(false);
      setPendingDraft(null);
      onBody(ready);
      return;
    }
    void requestDraft();
  }

  return <AccessibleOverlay ariaLabel="Save a Gmail reply draft" contentClassName="modal gmail-reply-modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">Workspace Gmail draft</p><h2>Save a reply draft</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={(event) => { event.preventDefault(); onSave(); }}><div className="modal-detail"><div className="filing-message-summary"><Mail size={17} /><div><strong>{message.subject || "(No subject)"}</strong><span>Reply target: {message.from || "original sender"}</span></div></div><div className="reply-ai-draft" aria-busy={drafting || undefined}><button type="button" className="soft-button" onClick={onDraftWithAi} aria-disabled={draftBlocked || undefined} aria-describedby={gateNote ? gateNoteId : undefined}><Sparkles size={15} aria-hidden="true" /> {drafting ? "Drafting…" : "Draft with AI"}</button>{gateNote && <span className="form-help" id={gateNoteId}>{gateNote}</span>}</div>{confirmingReplace && <div className="reply-ai-confirm" ref={confirmRef} tabIndex={-1} role="group" aria-label="Confirm AI draft replacement"><span className="form-help">Replace your current reply text with an AI draft? Your saved records answer what they can; the rest is left as [...] for you to complete.</span><div className="reply-ai-confirm-actions"><button type="button" className="soft-button" onClick={keepMyText} disabled={drafting}>Keep my text</button><button type="button" className="soft-button" onClick={replaceWithAiDraft} disabled={drafting}>Replace with AI draft</button></div></div>}{draftError && <p className="reply-ai-error" role="alert">{draftError}</p>}<label>Reply message<textarea data-overlay-initial-focus value={body} onChange={(event) => onBody(event.target.value)} placeholder="Write your reply…" maxLength={6000} required disabled={saving} /></label><p className="form-help"><ShieldCheck size={14} /> Live mode saves an unsent draft in the original Workspace Gmail thread. Simulation stores a local draft only. Sending remains a separate, deliberate action.</p></div><footer className="modal-footer"><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !body.trim()}>{saving ? "Saving…" : <><Reply size={16} /> Save draft</>}</button></footer></form></AccessibleOverlay>;
}
