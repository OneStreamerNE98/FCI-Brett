import { GoogleIntegrationError, type GoogleRuntimeConfig } from "./google-oauth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_MESSAGE_RESULTS = 20;
const MAX_SEARCH_QUERY_LENGTH = 240;

export const FCI_GMAIL_LABELS = {
  root: "FCI",
  intake: "FCI/Intake",
  needsReview: "FCI/Needs Review",
  filed: "FCI/Filed",
} as const;

type GmailLabel = {
  id: string;
  name: string;
  type?: string;
};

type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
  };
};

export type GmailMessageSummary = {
  id: string;
  threadId: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  date: string | null;
  snippet: string;
  labelIds: string[];
};

export type GmailLabelSummary = {
  id: string;
  name: string;
};

export type GmailListBucket = "inbox" | "intake" | "needs-review" | "filed";

const LABEL_NAME_BY_BUCKET: Record<GmailListBucket, string | null> = {
  inbox: null,
  intake: FCI_GMAIL_LABELS.intake,
  "needs-review": FCI_GMAIL_LABELS.needsReview,
  filed: FCI_GMAIL_LABELS.filed,
};

function compactText(value: string | undefined, maximum: number) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function header(headers: GmailMessage["payload"]["headers"], name: string) {
  return compactText(headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value, 500) || null;
}

function toIsoDate(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64MimeLines(value: string) {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function encodedHeader(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

export function validateGmailMessageId(messageId: string) {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(messageId)) {
    throw new GoogleIntegrationError("invalid_gmail_message", "The Gmail message identifier is invalid.", 400);
  }
  return messageId;
}

function mapMessage(message: GmailMessage): GmailMessageSummary {
  return {
    id: message.id,
    threadId: message.threadId ?? null,
    from: header(message.payload?.headers, "From"),
    to: header(message.payload?.headers, "To"),
    subject: header(message.payload?.headers, "Subject"),
    date: header(message.payload?.headers, "Date") ?? toIsoDate(message.internalDate),
    snippet: compactText(message.snippet, 600),
    labelIds: (message.labelIds ?? []).filter((labelId) => typeof labelId === "string").slice(0, 30),
  };
}

export function normalizeGmailBucket(value: string | null): GmailListBucket {
  if (!value) return "inbox";
  if (value === "inbox" || value === "intake" || value === "needs-review" || value === "filed") return value;
  throw new GoogleIntegrationError("invalid_gmail_bucket", "Choose Inbox, Intake, Needs Review, or Filed.", 400);
}

export function normalizeGmailSearch(value: string | null) {
  if (!value) return undefined;
  const query = value.trim().replace(/\s+/g, " ");
  if (!query) return undefined;
  if (query.length > MAX_SEARCH_QUERY_LENGTH || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new GoogleIntegrationError("invalid_gmail_search", `Gmail searches must be ${MAX_SEARCH_QUERY_LENGTH} characters or fewer.`, 400);
  }
  return query;
}

export function assertTestGmailConnection(config: GoogleRuntimeConfig) {
  if (config.environment !== "test") {
    throw new GoogleIntegrationError("gmail_test_only", "Gmail actions are available only for the isolated personal test profile.", 403);
  }
  if (!config.oauthReady) {
    throw new GoogleIntegrationError("google_configuration_required", "Complete the Google test setup before using Gmail.", 409);
  }
  if (!config.gmailEnabled) {
    throw new GoogleIntegrationError("gmail_test_not_enabled", "Enable Gmail for the personal test profile, then reconnect Google to approve its permissions.", 409);
  }
}

export function validateTestRecipient(value: unknown, config: GoogleRuntimeConfig) {
  if (value === undefined && config.expectedGoogleEmails.length === 1) {
    return config.expectedGoogleEmails[0];
  }
  if (typeof value !== "string") {
    throw new GoogleIntegrationError("invalid_test_recipient", "Choose an approved personal test email address.", 400);
  }
  const recipient = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || !config.expectedGoogleEmails.includes(recipient)) {
    throw new GoogleIntegrationError("invalid_test_recipient", "Test messages can only be sent to the approved personal Google account.", 403);
  }
  return recipient;
}

export function validateTestMessageInput(input: Record<string, unknown>) {
  const subject = input.subject === undefined ? "FCI Gmail integration test" : input.subject;
  const body = input.body === undefined
    ? "This is a safe test message from Floor Coverings International Operations."
    : input.body;
  if (typeof subject !== "string" || typeof body !== "string") {
    throw new GoogleIntegrationError("invalid_test_message", "The test subject and message must be text.", 400);
  }
  if (subject.length > 180 || body.length > 4_000 || /[\r\n]/.test(subject)) {
    throw new GoogleIntegrationError("invalid_test_message", "Use a single-line subject of 180 characters or fewer and a message of 4,000 characters or fewer.", 400);
  }
  return { subject: subject.trim(), body: body.trim() };
}

export function createTestMessageRaw(recipient: string, subject: string, body: string) {
  const mime = [
    `To: ${recipient}`,
    `Subject: ${encodedHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64MimeLines(body),
  ].join("\r\n");
  return base64Url(new TextEncoder().encode(mime));
}

export class GoogleGmailClient {
  constructor(private readonly accessToken: string) {}

  private async request<T>(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetch(`${GMAIL_API}/${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new GoogleIntegrationError("gmail_unavailable", "Gmail is temporarily unavailable. Try again.", 503);
    }

    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && data) return data as T;
    if (response.status === 401) {
      throw new GoogleIntegrationError("gmail_reauthorization_required", "Google authorization needs to be reconnected.", 409);
    }
    if (response.status === 403) {
      throw new GoogleIntegrationError("gmail_permission_denied", "The personal test account did not grant Gmail permission. Reconnect and approve Gmail access.", 403);
    }
    if (response.status === 404) {
      throw new GoogleIntegrationError("gmail_not_found", "The requested Gmail message or label was not found.", 404);
    }
    if (response.status === 429) {
      throw new GoogleIntegrationError("gmail_rate_limited", "Gmail is temporarily rate-limited. Try again shortly.", 429);
    }
    if (response.status >= 400 && response.status < 500) {
      throw new GoogleIntegrationError("gmail_request_rejected", "Gmail could not process that request.", 400);
    }
    throw new GoogleIntegrationError("gmail_request_failed", "Gmail could not complete that operation. Try again.", 503);
  }

  async listLabels() {
    const response = await this.request<{ labels?: GmailLabel[] }>("labels");
    return (response.labels ?? [])
      .filter((label): label is GmailLabel => Boolean(label.id && label.name))
      .map((label) => ({ id: label.id, name: label.name, type: label.type }));
  }

  private uniqueLabel(labels: GmailLabel[], name: string) {
    const matches = labels.filter((label) => label.name === name);
    if (matches.length > 1) {
      throw new GoogleIntegrationError("gmail_label_ambiguous", `More than one Gmail label is named ${name}.`, 409);
    }
    return matches[0] ?? null;
  }

  async findLabelByName(name: string) {
    return this.uniqueLabel(await this.listLabels(), name);
  }

  private async createLabel(name: string) {
    return this.request<GmailLabel>("labels", {
      method: "POST",
      body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
    });
  }

  async prepareFciLabels() {
    const labels = await this.listLabels();
    const ensure = async (name: string) => {
      const existing = this.uniqueLabel(labels, name);
      if (existing) return existing;
      const created = await this.createLabel(name);
      labels.push(created);
      return created;
    };
    const root = await ensure(FCI_GMAIL_LABELS.root);
    const intake = await ensure(FCI_GMAIL_LABELS.intake);
    const needsReview = await ensure(FCI_GMAIL_LABELS.needsReview);
    const filed = await ensure(FCI_GMAIL_LABELS.filed);
    return { root, intake, needsReview, filed };
  }

  async labelIdForBucket(bucket: GmailListBucket) {
    if (bucket === "inbox") return "INBOX";
    const name = LABEL_NAME_BY_BUCKET[bucket];
    const label = name ? await this.findLabelByName(name) : null;
    return label?.id ?? null;
  }

  async listMessages(input: { labelId: string; search?: string }) {
    const parameters = new URLSearchParams({ maxResults: String(MAX_MESSAGE_RESULTS), labelIds: input.labelId });
    if (input.search) parameters.set("q", input.search);
    const response = await this.request<{ messages?: Array<Pick<GmailMessage, "id" | "threadId">> }>(`messages?${parameters.toString()}`);
    const references = (response.messages ?? []).slice(0, MAX_MESSAGE_RESULTS);
    const messages = await Promise.all(references.map((reference) => this.getMessageMetadata(reference.id)));
    return messages;
  }

  private async getMessageMetadata(messageId: string) {
    const parameters = new URLSearchParams({ format: "metadata" });
    for (const headerName of ["From", "To", "Subject", "Date"]) parameters.append("metadataHeaders", headerName);
    const message = await this.request<GmailMessage>(`messages/${encodeURIComponent(validateGmailMessageId(messageId))}?${parameters.toString()}`);
    return mapMessage(message);
  }

  async applyFiledLabel(messageId: string) {
    const labels = await this.prepareFciLabels();
    const response = await this.request<Pick<GmailMessage, "id" | "threadId" | "labelIds">>(`messages/${encodeURIComponent(validateGmailMessageId(messageId))}/modify`, {
      method: "POST",
      // This deliberately does not remove INBOX or any other label: filing is a visible, reversible label action.
      body: JSON.stringify({ addLabelIds: [labels.filed.id] }),
    });
    return { id: response.id, threadId: response.threadId ?? null, labelIds: response.labelIds ?? [], label: { id: labels.filed.id, name: labels.filed.name } };
  }

  async sendTestMessage(input: { recipient: string; subject: string; body: string }) {
    const response = await this.request<Pick<GmailMessage, "id" | "threadId" | "labelIds">>("messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: createTestMessageRaw(input.recipient, input.subject, input.body) }),
    });
    return { id: response.id, threadId: response.threadId ?? null, labelIds: response.labelIds ?? [] };
  }
}

export function summarizeFciLabels(labels: Awaited<ReturnType<GoogleGmailClient["prepareFciLabels"]>>) {
  return Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, { id: label.id, name: label.name }])) as Record<string, GmailLabelSummary>;
}
