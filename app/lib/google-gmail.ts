import { GoogleIntegrationError, type GoogleRuntimeConfig } from "./google-oauth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_MESSAGE_RESULTS = 20;
const MAX_SEARCH_QUERY_LENGTH = 240;
const MAX_ARCHIVE_MESSAGE_PARTS = 160;
const MEBIBYTE = 1024 * 1024;

// Archive retrieval happens in the request path for the connected Workspace mailbox.
// Keep the hard caps here (rather than trusting a caller) so a malformed message
// cannot make the worker fetch an unbounded attachment tree.
export const GMAIL_ARCHIVE_LIMITS = {
  maxRawBytes: 20 * MEBIBYTE,
  maxAttachmentCount: 20,
  maxAttachmentBytes: 15 * MEBIBYTE,
  maxTotalAttachmentBytes: 20 * MEBIBYTE,
} as const;

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

type GmailHeader = { name?: string; value?: string };

type GmailMessageBody = {
  attachmentId?: string;
  data?: string;
  size?: number;
};

type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailMessageBody;
  parts?: GmailMessagePart[];
};

type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  raw?: string;
  payload?: GmailMessagePart;
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

export type GmailArchiveFetchOptions = {
  /** Optional lower limits for a particular filing action. Values can never exceed GMAIL_ARCHIVE_LIMITS. */
  maxRawBytes?: number;
  maxAttachmentCount?: number;
  maxAttachmentBytes?: number;
  maxTotalAttachmentBytes?: number;
};

export type GmailRawMessage = {
  id: string;
  threadId: string | null;
  bytes: Uint8Array;
};

export type GmailAttachment = {
  /** The original Gmail filename when present. Keep it for audit metadata, not for a local filesystem path. */
  originalFilename: string | null;
  /** A deterministic filename safe to use as a Google Drive display name. */
  filename: string;
  mimeType: string;
  partId: string | null;
  attachmentId: string | null;
  bytes: Uint8Array;
};

export type GmailMessageArchive = {
  id: string;
  threadId: string | null;
  summary: GmailMessageSummary;
  raw: GmailRawMessage;
  attachments: GmailAttachment[];
};

export type GmailReplyContext = {
  messageId: string;
  threadId: string;
  recipient: string;
  subject: string;
  inReplyTo: string | null;
  references: string | null;
};

export type GmailReplyDraft = {
  id: string;
  messageId: string | null;
  threadId: string | null;
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

function header(headers: GmailHeader[] | undefined, name: string) {
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

function archiveLimitError(message: string) {
  return new GoogleIntegrationError("gmail_archive_too_large", message, 413);
}

function archiveResponseError(message: string) {
  return new GoogleIntegrationError("gmail_archive_invalid_response", message, 503);
}

function limitedOption(value: number | undefined, fallback: number, maximum: number, label: string) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GoogleIntegrationError("invalid_gmail_archive_limit", `${label} must be a positive whole number.`, 400);
  }
  return Math.min(value, maximum);
}

function resolveArchiveLimits(input: GmailArchiveFetchOptions = {}) {
  return {
    maxRawBytes: limitedOption(input.maxRawBytes, GMAIL_ARCHIVE_LIMITS.maxRawBytes, GMAIL_ARCHIVE_LIMITS.maxRawBytes, "The raw email limit"),
    maxAttachmentCount: limitedOption(input.maxAttachmentCount, GMAIL_ARCHIVE_LIMITS.maxAttachmentCount, GMAIL_ARCHIVE_LIMITS.maxAttachmentCount, "The attachment-count limit"),
    maxAttachmentBytes: limitedOption(input.maxAttachmentBytes, GMAIL_ARCHIVE_LIMITS.maxAttachmentBytes, GMAIL_ARCHIVE_LIMITS.maxAttachmentBytes, "The attachment-size limit"),
    maxTotalAttachmentBytes: limitedOption(input.maxTotalAttachmentBytes, GMAIL_ARCHIVE_LIMITS.maxTotalAttachmentBytes, GMAIL_ARCHIVE_LIMITS.maxTotalAttachmentBytes, "The total attachment limit"),
  };
}

function decodeGmailBase64Url(value: unknown, maximumBytes: number, label: string) {
  if (typeof value !== "string" || !value) throw archiveResponseError(`Gmail returned ${label} without encoded content.`);
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) throw archiveResponseError(`Gmail returned ${label} with invalid base64url content.`);
  // Base64 expands to at most four characters for every three bytes. Reject before
  // decoding to keep the test worker from allocating an oversized archive payload.
  if (value.length > Math.ceil(maximumBytes / 3) * 4 + 4) {
    throw archiveLimitError(`${label} exceeds the configured archive size limit.`);
  }
  try {
    const unpadded = value.replace(/=+$/g, "").replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (unpadded.length % 4)) % 4);
    const binary = atob(`${unpadded}${padding}`);
    if (binary.length > maximumBytes) throw archiveLimitError(`${label} exceeds the configured archive size limit.`);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch (error) {
    if (error instanceof GoogleIntegrationError) throw error;
    throw archiveResponseError(`Gmail returned ${label} with invalid encoded content.`);
  }
}

function attachmentFallbackName(partId: string | null, mimeType: string) {
  const normalizedPartId = partId?.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "file";
  const extension = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "text/plain": ".txt",
  }[mimeType.toLowerCase()] ?? "";
  return `attachment-${normalizedPartId}${extension}`;
}

/**
 * Makes a Gmail-provided filename safe for use as a Drive display name. This does
 * not create a filesystem path, and intentionally strips separators/control chars.
 */
export function sanitizeGmailAttachmentFilename(value: string | undefined, fallback = "attachment") {
  const clean = (candidate: string) => candidate
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 180)
    .replace(/[.\s]+$/g, "");
  return clean(value ?? "") || clean(fallback) || "attachment";
}

function hasAttachmentDisposition(part: GmailMessagePart) {
  const disposition = header(part.headers, "Content-Disposition");
  return Boolean(disposition && /(?:^|[;\s])(attachment|inline)(?:$|[;\s])/i.test(disposition));
}

function hasInlineBinaryContent(part: GmailMessagePart) {
  return Boolean(header(part.headers, "Content-ID") && part.mimeType?.toLowerCase().startsWith("image/"));
}

type GmailAttachmentCandidate = {
  partId: string | null;
  attachmentId: string | null;
  inlineData: string | null;
  originalFilename: string | null;
  filename: string;
  mimeType: string;
  declaredSize: number | null;
};

function collectAttachmentCandidates(payload: GmailMessagePart | undefined) {
  if (!payload) return [] as GmailAttachmentCandidate[];
  const candidates: GmailAttachmentCandidate[] = [];
  const pending: GmailMessagePart[] = [payload];
  let inspected = 0;
  while (pending.length) {
    const part = pending.pop();
    if (!part) continue;
    inspected += 1;
    if (inspected > MAX_ARCHIVE_MESSAGE_PARTS) {
      throw new GoogleIntegrationError("gmail_message_too_complex", "This Gmail message has too many MIME parts to archive safely.", 413);
    }
    for (const child of part.parts ?? []) pending.push(child);

    const attachmentId = typeof part.body?.attachmentId === "string" && part.body.attachmentId ? part.body.attachmentId : null;
    const inlineData = typeof part.body?.data === "string" && part.body.data ? part.body.data : null;
    const originalFilename = typeof part.filename === "string" && part.filename.trim() ? part.filename.trim() : null;
    if (!attachmentId && !inlineData) continue;
    if (!originalFilename && !hasAttachmentDisposition(part) && !hasInlineBinaryContent(part)) continue;
    const partId = typeof part.partId === "string" && part.partId ? part.partId : null;
    const mimeType = typeof part.mimeType === "string" && part.mimeType.trim() ? part.mimeType.trim().toLowerCase() : "application/octet-stream";
    const declaredSize = typeof part.body?.size === "number" && Number.isSafeInteger(part.body.size) && part.body.size >= 0 ? part.body.size : null;
    candidates.push({
      partId,
      attachmentId,
      inlineData,
      originalFilename,
      filename: sanitizeGmailAttachmentFilename(originalFilename ?? attachmentFallbackName(partId, mimeType)),
      mimeType,
      declaredSize,
    });
  }
  return candidates;
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

export function assertWorkspaceGmailConnection(config: GoogleRuntimeConfig) {
  if (!config.oauthReady) {
    throw new GoogleIntegrationError("google_configuration_required", "Complete the Google Workspace setup before using Gmail.", 409);
  }
  if (!config.gmailEnabled) {
    throw new GoogleIntegrationError("gmail_not_enabled", "Enable Gmail for the Google Workspace connection, then reconnect Google to approve its permissions.", 409);
  }
}

export function validateWorkspaceRecipient(value: unknown, config: GoogleRuntimeConfig) {
  if (config.simulation) return "workspace-simulation@fci.example";
  if (value === undefined && config.intakeMailbox) return config.intakeMailbox;
  if (value === undefined && config.expectedGoogleEmails.length === 1) {
    return config.expectedGoogleEmails[0];
  }
  if (typeof value !== "string") {
    throw new GoogleIntegrationError("invalid_workspace_recipient", "Choose an approved Google Workspace email address.", 400);
  }
  const recipient = value.trim().toLowerCase();
  const domain = recipient.split("@")[1] ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || (!config.expectedGoogleEmails.includes(recipient) && !config.allowedDomains.includes(domain))) {
    throw new GoogleIntegrationError("invalid_workspace_recipient", "Test messages can only be sent inside the approved Google Workspace domain.", 403);
  }
  return recipient;
}

export function validateWorkspaceMessageInput(input: Record<string, unknown>) {
  const subject = input.subject === undefined ? "FCI Workspace integration test" : input.subject;
  const body = input.body === undefined
    ? "This is a safe test message from Floor Coverings International Operations."
    : input.body;
  if (typeof subject !== "string" || typeof body !== "string") {
    throw new GoogleIntegrationError("invalid_workspace_message", "The test subject and message must be text.", 400);
  }
  if (subject.length > 180 || body.length > 4_000 || /[\r\n]/.test(subject)) {
    throw new GoogleIntegrationError("invalid_workspace_message", "Use a single-line subject of 180 characters or fewer and a message of 4,000 characters or fewer.", 400);
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

function extractEmailAddress(value: string | null) {
  if (!value) return null;
  const bracketed = value.match(/<([^<>\s@]+@[^<>\s@]+)>/);
  const candidate = (bracketed?.[1] ?? value.match(/\b[^\s@<>]+@[^\s@<>]+\b/)?.[0] ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function replyHeader(value: string | null) {
  if (!value) return null;
  const compact = value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return compact && compact.length <= 500 ? compact : null;
}

function replySubject(value: string | null) {
  const base = (value ?? "").replace(/^\s*(?:re\s*:\s*)+/i, "").replace(/[\r\n\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "Message";
  return `Re: ${base}`;
}

export function validateReplyDraftBody(value: unknown) {
  if (typeof value !== "string") throw new GoogleIntegrationError("invalid_reply_draft", "Write a reply before saving a Gmail draft.", 400);
  const body = value.replace(/\r\n/g, "\n").trim();
  if (!body || body.length > 6_000 || /\u0000/.test(body)) {
    throw new GoogleIntegrationError("invalid_reply_draft", "Reply text is required and must be 6,000 characters or fewer.", 400);
  }
  return body;
}

export function createReplyDraftRaw(input: { recipient: string; subject: string; body: string; inReplyTo: string | null; references: string | null }) {
  const headers = [
    `To: ${input.recipient}`,
    `Subject: ${encodedHeader(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references ? [`References: ${input.references}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64MimeLines(input.body),
  ];
  return base64Url(new TextEncoder().encode(headers.join("\r\n")));
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
      throw new GoogleIntegrationError("gmail_permission_denied", "The Google Workspace account did not grant Gmail permission. Reconnect and approve Gmail access.", 403);
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
      .map((label): GmailLabel => ({ id: label.id, name: label.name, ...(label.type ? { type: label.type } : {}) }));
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

  private async getFullMessage(messageId: string) {
    const safeMessageId = validateGmailMessageId(messageId);
    const parameters = new URLSearchParams({ format: "full" });
    const message = await this.request<GmailMessage>(`messages/${encodeURIComponent(safeMessageId)}?${parameters.toString()}`);
    if (message.id !== safeMessageId) {
      throw archiveResponseError("Gmail returned an unexpected message while preparing the archive.");
    }
    return message;
  }

  /** Retrieves the original RFC 822 representation as bytes for an `.eml` archive. */
  async getRawMessage(messageId: string, options: GmailArchiveFetchOptions = {}): Promise<GmailRawMessage> {
    const safeMessageId = validateGmailMessageId(messageId);
    const limits = resolveArchiveLimits(options);
    const parameters = new URLSearchParams({ format: "raw" });
    const message = await this.request<GmailMessage>(`messages/${encodeURIComponent(safeMessageId)}?${parameters.toString()}`);
    if (message.id !== safeMessageId) {
      throw archiveResponseError("Gmail returned an unexpected message while retrieving the RFC 822 archive.");
    }
    return {
      id: message.id,
      threadId: message.threadId ?? null,
      bytes: decodeGmailBase64Url(message.raw, limits.maxRawBytes, "the raw email"),
    };
  }

  private async attachmentBytes(messageId: string, candidate: GmailAttachmentCandidate, maximumBytes: number) {
    if (candidate.inlineData) return decodeGmailBase64Url(candidate.inlineData, maximumBytes, `attachment ${candidate.filename}`);
    if (!candidate.attachmentId || candidate.attachmentId.length > 1_024 || /[\u0000-\u001f\u007f]/.test(candidate.attachmentId)) {
      throw archiveResponseError("Gmail returned an attachment without a valid identifier.");
    }
    const response = await this.request<{ data?: string }>(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(candidate.attachmentId)}`);
    return decodeGmailBase64Url(response.data, maximumBytes, `attachment ${candidate.filename}`);
  }

  private async attachmentsFromFullMessage(messageId: string, message: GmailMessage, options: GmailArchiveFetchOptions) {
    const limits = resolveArchiveLimits(options);
    const candidates = collectAttachmentCandidates(message.payload);
    if (candidates.length > limits.maxAttachmentCount) {
      throw archiveLimitError(`This Gmail message has more than ${limits.maxAttachmentCount} archiveable attachments.`);
    }

    let totalBytes = 0;
    const attachments: GmailAttachment[] = [];
    for (const candidate of candidates) {
      if (candidate.declaredSize !== null && candidate.declaredSize > limits.maxAttachmentBytes) {
        throw archiveLimitError(`Attachment ${candidate.filename} exceeds the configured attachment size limit.`);
      }
      if (candidate.declaredSize !== null && totalBytes + candidate.declaredSize > limits.maxTotalAttachmentBytes) {
        throw archiveLimitError("The Gmail message attachments exceed the configured total archive size limit.");
      }
      const bytes = await this.attachmentBytes(messageId, candidate, limits.maxAttachmentBytes);
      if (totalBytes + bytes.byteLength > limits.maxTotalAttachmentBytes) {
        throw archiveLimitError("The Gmail message attachments exceed the configured total archive size limit.");
      }
      totalBytes += bytes.byteLength;
      attachments.push({
        originalFilename: candidate.originalFilename,
        filename: candidate.filename,
        mimeType: candidate.mimeType,
        partId: candidate.partId,
        attachmentId: candidate.attachmentId,
        bytes,
      });
    }
    return attachments;
  }

  /** Recursively finds and retrieves archiveable Gmail attachments, without changing Gmail labels or message state. */
  async getMessageAttachments(messageId: string, options: GmailArchiveFetchOptions = {}): Promise<GmailAttachment[]> {
    const safeMessageId = validateGmailMessageId(messageId);
    const message = await this.getFullMessage(safeMessageId);
    return this.attachmentsFromFullMessage(safeMessageId, message, options);
  }

  /**
   * Fetches both the original `.eml` bytes and separate attachment bytes. It is
   * read-only against Gmail; the coordinator decides whether to upload or label it.
   */
  async getMessageArchive(messageId: string, options: GmailArchiveFetchOptions = {}): Promise<GmailMessageArchive> {
    const safeMessageId = validateGmailMessageId(messageId);
    const [raw, full] = await Promise.all([
      this.getRawMessage(safeMessageId, options),
      this.getFullMessage(safeMessageId),
    ]);
    const attachments = await this.attachmentsFromFullMessage(safeMessageId, full, options);
    return {
      id: safeMessageId,
      threadId: full.threadId ?? raw.threadId,
      summary: mapMessage(full),
      raw,
      attachments,
    };
  }

  /** Returns only the server-derived headers needed to save a safe reply draft. */
  async getReplyContext(messageId: string): Promise<GmailReplyContext> {
    const safeMessageId = validateGmailMessageId(messageId);
    const message = await this.getFullMessage(safeMessageId);
    const summary = mapMessage(message);
    const recipient = extractEmailAddress(summary.from);
    const threadId = message.threadId ?? null;
    if (!recipient || !threadId) {
      throw new GoogleIntegrationError("gmail_reply_context_missing", "Gmail did not return the sender or thread information needed for a reply draft.", 409);
    }
    const inReplyTo = replyHeader(header(message.payload?.headers, "Message-ID"));
    const references = replyHeader(header(message.payload?.headers, "References")) ?? inReplyTo;
    return {
      messageId: safeMessageId,
      threadId,
      recipient,
      subject: replySubject(summary.subject),
      inReplyTo,
      references,
    };
  }

  /** Creates an unsent Gmail draft in the original message thread. Sending remains a separate user action in Gmail. */
  async createReplyDraft(input: GmailReplyContext & { body: string }): Promise<GmailReplyDraft> {
    const response = await this.request<{ id?: string; message?: GmailMessage }>("drafts", {
      method: "POST",
      body: JSON.stringify({
        message: {
          threadId: input.threadId,
          raw: createReplyDraftRaw(input),
        },
      }),
    });
    if (!response.id) throw archiveResponseError("Gmail did not return a draft identifier.");
    return {
      id: response.id,
      messageId: response.message?.id ?? null,
      threadId: response.message?.threadId ?? input.threadId,
    };
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
