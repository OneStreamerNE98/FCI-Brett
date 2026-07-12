import { env } from "cloudflare:workers";
import {
  FCI_GMAIL_LABELS,
  type GmailListBucket,
  type GmailMessageArchive,
  type GmailMessageSummary,
  type GmailReplyContext,
  type GmailReplyDraft,
} from "./google-gmail";

const STATE_ID = "fci-workspace";
const SIMULATION_ACCOUNT = "workspace-simulation@fci.example";

type SimulationAttachment = {
  filename: string;
  mimeType: string;
  body: string;
};

type SimulationMessage = GmailMessageSummary & {
  body: string;
  attachments: SimulationAttachment[];
};

type SimulationEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
};

type SimulationState = {
  labelsPrepared: boolean;
  messages: SimulationMessage[];
  calendarEvents: SimulationEvent[];
  drafts: Array<{ id: string; messageId: string; threadId: string; recipient: string; body: string; createdAt: string }>;
};

type StateRow = { state_json: string };

function atOffset(days: number, hour: number, minute = 0) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, minute, 0, 0);
  return value.toISOString();
}

function seedState(): SimulationState {
  return {
    labelsPrepared: true,
    messages: [
      {
        id: "sim-msg-westport",
        threadId: "sim-thread-westport",
        from: "Sarah Kim <sarah.kim@atlas.example>",
        to: SIMULATION_ACCOUNT,
        subject: "CF-2026-041 — revised phasing plan",
        date: atOffset(0, 9, 12),
        snippet: "Attached is the revised phasing plan for the Westport Medical Center installation.",
        labelIds: ["INBOX", "FCI_INTAKE"],
        body: "Please review the revised phasing plan before tomorrow's site walk.",
        attachments: [{ filename: "Westport-Phasing-Plan.pdf", mimeType: "application/pdf", body: "Simulated PDF attachment" }],
      },
      {
        id: "sim-msg-harbor",
        threadId: "sim-thread-harbor",
        from: "Devin Ross <devin.ross@morgan.example>",
        to: SIMULATION_ACCOUNT,
        subject: "One Harbor Plaza dock access",
        date: atOffset(-1, 15, 40),
        snippet: "Dock B will be available beginning at 6:30 AM. Please confirm the delivery contact.",
        labelIds: ["INBOX", "FCI_REVIEW"],
        body: "Dock B will be available beginning at 6:30 AM. Please confirm the delivery contact.",
        attachments: [],
      },
      {
        id: "sim-msg-northpoint",
        threadId: "sim-thread-northpoint",
        from: "Sarah Kim <sarah.kim@atlas.example>",
        to: SIMULATION_ACCOUNT,
        subject: "Northpoint Imaging Suite finish schedule",
        date: atOffset(-2, 11, 5),
        snippet: "The latest finish schedule and room matrix are ready for review.",
        labelIds: ["INBOX"],
        body: "The latest finish schedule and room matrix are ready for review.",
        attachments: [{ filename: "Northpoint-Room-Matrix.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: "Simulated workbook attachment" }],
      },
    ],
    calendarEvents: [
      { id: "sim-event-site-walk", title: "Site walk · Westport Medical", start: atOffset(1, 8, 30), end: atOffset(1, 9, 30) },
      { id: "sim-event-scope-review", title: "Client scope review · Hudson Retail", start: atOffset(2, 13, 30), end: atOffset(2, 14, 15) },
    ],
    drafts: [],
  };
}

function parseState(value: string): SimulationState {
  try {
    const parsed = JSON.parse(value) as SimulationState;
    if (Array.isArray(parsed.messages) && Array.isArray(parsed.calendarEvents) && Array.isArray(parsed.drafts)) return parsed;
  } catch {
    // Fall through to a clean deterministic seed.
  }
  return seedState();
}

async function writeState(state: SimulationState) {
  await env.DB.prepare("INSERT INTO workspace_simulation_state (id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at")
    .bind(STATE_ID, JSON.stringify(state), Date.now())
    .run();
}

export async function getSimulationState() {
  const row = await env.DB.prepare("SELECT state_json FROM workspace_simulation_state WHERE id = ?").bind(STATE_ID).first<StateRow>();
  if (row) return parseState(row.state_json);
  const state = seedState();
  await writeState(state);
  return state;
}

export async function resetWorkspaceSimulation() {
  const state = seedState();
  await writeState(state);
  return { reset: true, messages: state.messages.length, events: state.calendarEvents.length };
}

function labelForBucket(bucket: GmailListBucket) {
  if (bucket === "inbox") return "INBOX";
  if (bucket === "intake") return "FCI_INTAKE";
  if (bucket === "needs-review") return "FCI_REVIEW";
  return "FCI_FILED";
}

function searchTerms(value: string | undefined) {
  return (value ?? "")
    .replace(/\b(?:from|subject):/gi, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export class WorkspaceSimulationGmailClient {
  async prepareFciLabels() {
    const state = await getSimulationState();
    state.labelsPrepared = true;
    await writeState(state);
    return {
      root: { id: "FCI_ROOT", name: FCI_GMAIL_LABELS.root },
      intake: { id: "FCI_INTAKE", name: FCI_GMAIL_LABELS.intake },
      needsReview: { id: "FCI_REVIEW", name: FCI_GMAIL_LABELS.needsReview },
      filed: { id: "FCI_FILED", name: FCI_GMAIL_LABELS.filed },
    };
  }

  async labelIdForBucket(bucket: GmailListBucket) {
    const state = await getSimulationState();
    return bucket === "inbox" || state.labelsPrepared ? labelForBucket(bucket) : null;
  }

  async listMessages(input: { labelId: string; search?: string }) {
    const state = await getSimulationState();
    const terms = searchTerms(input.search);
    return state.messages
      .filter((message) => message.labelIds.includes(input.labelId))
      .filter((message) => {
        if (!terms.length) return true;
        const searchable = [message.from, message.to, message.subject, message.snippet].join(" ").toLowerCase();
        return terms.every((term) => searchable.includes(term));
      })
      .slice(0, 20)
      .map((message) => ({ id: message.id, threadId: message.threadId, from: message.from, to: message.to, subject: message.subject, date: message.date, snippet: message.snippet, labelIds: message.labelIds }));
  }

  async getMessageArchive(messageId: string): Promise<GmailMessageArchive> {
    const state = await getSimulationState();
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) throw new Error("Simulated message not found.");
    const rawBytes = new TextEncoder().encode(`From: ${message.from}\r\nTo: ${message.to}\r\nSubject: ${message.subject}\r\n\r\n${message.body}`);
    return {
      id: message.id,
      threadId: message.threadId,
      summary: { id: message.id, threadId: message.threadId, from: message.from, to: message.to, subject: message.subject, date: message.date, snippet: message.snippet, labelIds: message.labelIds },
      raw: { id: message.id, threadId: message.threadId, bytes: rawBytes },
      attachments: message.attachments.map((attachment, index) => ({
        originalFilename: attachment.filename,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        partId: `sim-part-${index + 1}`,
        attachmentId: `sim-attachment-${index + 1}`,
        bytes: new TextEncoder().encode(attachment.body),
      })),
    };
  }

  async getReplyContext(messageId: string): Promise<GmailReplyContext> {
    const archive = await this.getMessageArchive(messageId);
    const recipient = archive.summary.from?.match(/<([^>]+)>/)?.[1] ?? archive.summary.from ?? SIMULATION_ACCOUNT;
    return { messageId, threadId: archive.threadId ?? `sim-thread-${messageId}`, recipient, subject: `Re: ${archive.summary.subject ?? "Message"}`, inReplyTo: null, references: null };
  }

  async createReplyDraft(input: GmailReplyContext & { body: string }): Promise<GmailReplyDraft> {
    const state = await getSimulationState();
    const id = `sim-draft-${crypto.randomUUID()}`;
    state.drafts.push({ id, messageId: input.messageId, threadId: input.threadId, recipient: input.recipient, body: input.body, createdAt: new Date().toISOString() });
    await writeState(state);
    return { id, messageId: input.messageId, threadId: input.threadId };
  }

  async applyFiledLabel(messageId: string) {
    const state = await getSimulationState();
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) throw new Error("Simulated message not found.");
    if (!message.labelIds.includes("FCI_FILED")) message.labelIds.push("FCI_FILED");
    await writeState(state);
    return { id: message.id, threadId: message.threadId, labelIds: message.labelIds, label: { id: "FCI_FILED", name: FCI_GMAIL_LABELS.filed } };
  }

  async sendTestMessage(input: { recipient: string; subject: string; body: string }) {
    const state = await getSimulationState();
    const id = `sim-msg-${crypto.randomUUID()}`;
    state.messages.unshift({
      id,
      threadId: `sim-thread-${crypto.randomUUID()}`,
      from: `FCI Workspace Simulation <${SIMULATION_ACCOUNT}>`,
      to: input.recipient,
      subject: input.subject,
      date: new Date().toISOString(),
      snippet: input.body.slice(0, 240),
      labelIds: ["INBOX", "FCI_INTAKE"],
      body: input.body,
      attachments: [],
    });
    await writeState(state);
    return { id, threadId: state.messages[0].threadId, labelIds: state.messages[0].labelIds };
  }
}

export async function listSimulationCalendarEvents() {
  const state = await getSimulationState();
  return { events: state.calendarEvents, timeZone: "America/New_York", windowDays: 7, simulated: true };
}

export async function createSimulationCalendarHold(start: Date) {
  const state = await getSimulationState();
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const event = { id: `sim-event-${crypto.randomUUID()}`, title: "FCI Workspace simulation hold", start: start.toISOString(), end: end.toISOString() };
  state.calendarEvents.push(event);
  await writeState(state);
  return event;
}

export const WORKSPACE_SIMULATION_ACCOUNT = SIMULATION_ACCOUNT;
