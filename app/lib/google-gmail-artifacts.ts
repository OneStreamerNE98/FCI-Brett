const SAFE_GMAIL_PART_ID = /^[A-Za-z0-9._-]{1,90}$/;
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/;

export function gmailAttachmentArtifactKey(partId: string | null | undefined, contentSha256: string) {
  const stablePartId = partId?.trim();
  if (stablePartId && SAFE_GMAIL_PART_ID.test(stablePartId)) {
    return `attachment-part-${stablePartId}`;
  }
  if (!SHA256_BASE64URL.test(contentSha256)) {
    throw new Error("A valid SHA-256 content identity is required for a Gmail attachment.");
  }
  return `attachment-sha256-${contentSha256}`;
}
