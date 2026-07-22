import type { WorkspaceBlueprintTemplate } from "./workspace-blueprint";

const GOOGLE_DOCUMENT_MIME_TYPE = "application/vnd.google-apps.document" as const;
const GOOGLE_SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet" as const;
const HTML_MEDIA_MIME_TYPE = "text/html" as const;
const CSV_MEDIA_MIME_TYPE = "text/csv" as const;

/**
 * This is the complete template-merge catalog. Additions require a deliberate
 * packet because every consumer must replace the same finite set in one pass.
 */
export const WORKSPACE_TEMPLATE_TOKEN_LEGEND = Object.freeze([
  Object.freeze({ token: "{{client_name}}", label: "Client name" }),
  Object.freeze({ token: "{{site_address}}", label: "Project site address" }),
  Object.freeze({ token: "{{total}}", label: "Project total" }),
] as const);

/** The five starter identities are pinned so growing the shipped catalog is explicit. */
export const WORKSPACE_TEMPLATE_SEED_KEYS = Object.freeze([
  "estimate-proposal",
  "installation-work-order",
  "change-order",
  "pre-install-checklist",
  "project-budget",
] as const);

type GoogleNativeTemplateMimeType = typeof GOOGLE_DOCUMENT_MIME_TYPE | typeof GOOGLE_SPREADSHEET_MIME_TYPE;
type WorkspaceTemplateMediaMimeType = typeof HTML_MEDIA_MIME_TYPE | typeof CSV_MEDIA_MIME_TYPE;

export type RenderedWorkspaceTemplate = Readonly<{
  body: string;
  bytes: Uint8Array;
  metadataMimeType: GoogleNativeTemplateMimeType;
  mediaMimeType: WorkspaceTemplateMediaMimeType;
}>;

function renderText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${label} must be non-empty printable text no longer than 120 characters.`);
  }
  return normalized;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tokenLegendHtml() {
  return `<section><h2>Template fields</h2><p>Keep these exact fields for document creation:</p><ul>${WORKSPACE_TEMPLATE_TOKEN_LEGEND.map(({ token, label }) => `<li><code>${escapeHtml(token)}</code> — ${escapeHtml(label)}</li>`).join("")}</ul></section>`;
}

function htmlDocument(title: string, businessDisplayName: string, body: string) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    `<header><p>${escapeHtml(businessDisplayName)}</p><h1>${escapeHtml(title)}</h1></header>`,
    body,
    tokenLegendHtml(),
    "</body>",
    "</html>",
  ].join("\n");
}

function estimateProposalBody(title: string, businessDisplayName: string) {
  return htmlDocument(title, businessDisplayName, [
    "<section><h2>Prepared for</h2>",
    "<p><strong>Client:</strong> {{client_name}}</p>",
    "<p><strong>Project site:</strong> {{site_address}}</p></section>",
    "<section><h2>Flooring proposal</h2><p>Describe the approved flooring scope, rooms, materials, preparation, installation, exclusions, and schedule.</p></section>",
    "<section><h2>Investment</h2><p><strong>Project total:</strong> {{total}}</p></section>",
    "<section><h2>Approval</h2><p>Client acceptance: ____________________</p><p>Date: ____________________</p></section>",
  ].join("\n"));
}

function installationWorkOrderBody(title: string, businessDisplayName: string) {
  return htmlDocument(title, businessDisplayName, [
    "<section><h2>Job details</h2>",
    "<p><strong>Client:</strong> {{client_name}}</p>",
    "<p><strong>Project site:</strong> {{site_address}}</p>",
    "<p><strong>Project total:</strong> {{total}}</p></section>",
    "<section><h2>Installation scope</h2><p>Record areas, materials, quantities, transitions, demolition, floor preparation, and special instructions.</p></section>",
    "<section><h2>Field checklist</h2><ul><li>Confirm site access and protection.</li><li>Verify materials before installation.</li><li>Record exceptions and completion evidence.</li></ul></section>",
  ].join("\n"));
}

function changeOrderBody(title: string, businessDisplayName: string) {
  return htmlDocument(title, businessDisplayName, [
    "<section><h2>Project</h2>",
    "<p><strong>Client:</strong> {{client_name}}</p>",
    "<p><strong>Project site:</strong> {{site_address}}</p></section>",
    "<section><h2>Requested change</h2><p>Describe the changed scope, reason, schedule impact, and exclusions.</p></section>",
    "<section><h2>Revised total</h2><p><strong>Project total after this change:</strong> {{total}}</p></section>",
    "<section><h2>Approval</h2><p>Client acceptance: ____________________</p><p>Date: ____________________</p></section>",
  ].join("\n"));
}

function preInstallChecklistBody(title: string, businessDisplayName: string) {
  return htmlDocument(title, businessDisplayName, [
    "<section><h2>Project</h2>",
    "<p><strong>Client:</strong> {{client_name}}</p>",
    "<p><strong>Project site:</strong> {{site_address}}</p>",
    "<p><strong>Project total:</strong> {{total}}</p></section>",
    "<section><h2>Before installation</h2><ul><li>Confirm product, color, quantity, and lot.</li><li>Confirm site access, parking, and material staging.</li><li>Confirm furniture, appliance, and demolition responsibilities.</li><li>Confirm substrate, moisture, acclimation, and floor-preparation requirements.</li><li>Confirm client contact and installation-day expectations.</li></ul></section>",
    "<section><h2>Exceptions</h2><p>Record anything requiring follow-up before the crew is released.</p></section>",
  ].join("\n"));
}

function csvCell(value: string) {
  const safeValue = /^[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function csvRows(rows: readonly (readonly string[])[]) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function projectBudgetBody(title: string, businessDisplayName: string) {
  return csvRows([
    [businessDisplayName, title, ""],
    ["Client", "{{client_name}}", ""],
    ["Project site", "{{site_address}}", ""],
    ["Project total", "{{total}}", ""],
    ["", "", ""],
    ["Budget category", "Planned amount", "Notes"],
    ["Materials", "", ""],
    ["Labor", "", ""],
    ["Floor preparation", "", ""],
    ["Freight and delivery", "", ""],
    ["Other", "", ""],
    ["", "", ""],
    ["Template field", "Meaning", "Keep exact"],
    ...WORKSPACE_TEMPLATE_TOKEN_LEGEND.map(({ token, label }) => [token, label, "Yes"] as const),
  ]);
}

function ownerDocShell(title: string, businessDisplayName: string) {
  return htmlDocument(
    title,
    businessDisplayName,
    "<section><h2>Owner-authored template</h2><p>This starter shell is ready to edit in Google Docs. Keep any template fields that should be filled when a project document is created.</p></section>",
  );
}

function ownerSheetShell(title: string, businessDisplayName: string) {
  return csvRows([
    [businessDisplayName, title, ""],
    ["Owner-authored template", "Edit this starter shell in Google Sheets.", ""],
    ["", "", ""],
    ["Template field", "Meaning", "Keep exact"],
    ...WORKSPACE_TEMPLATE_TOKEN_LEGEND.map(({ token, label }) => [token, label, "Yes"] as const),
  ]);
}

/**
 * Renders upload-conversion source bytes for one sanitized blueprint template.
 * Owner-added entries intentionally receive only a titled shell; content remains
 * owner-authored in Google after setup creates the native file.
 */
export function renderWorkspaceTemplate(
  template: WorkspaceBlueprintTemplate,
  businessDisplayName: string,
): RenderedWorkspaceTemplate {
  const title = renderText(template.name, "Template name");
  const businessName = renderText(businessDisplayName, "Business display name");
  let body: string;
  let metadataMimeType: GoogleNativeTemplateMimeType;
  let mediaMimeType: WorkspaceTemplateMediaMimeType;

  if (template.kind === "doc") {
    metadataMimeType = GOOGLE_DOCUMENT_MIME_TYPE;
    mediaMimeType = HTML_MEDIA_MIME_TYPE;
    if (template.key === "estimate-proposal") body = estimateProposalBody(title, businessName);
    else if (template.key === "installation-work-order") body = installationWorkOrderBody(title, businessName);
    else if (template.key === "change-order") body = changeOrderBody(title, businessName);
    else if (template.key === "pre-install-checklist") body = preInstallChecklistBody(title, businessName);
    else body = ownerDocShell(title, businessName);
  } else if (template.kind === "sheet") {
    metadataMimeType = GOOGLE_SPREADSHEET_MIME_TYPE;
    mediaMimeType = CSV_MEDIA_MIME_TYPE;
    body = template.key === "project-budget"
      ? projectBudgetBody(title, businessName)
      : ownerSheetShell(title, businessName);
  } else {
    throw new Error(`Unsupported Workspace template kind: ${String(template.kind)}.`);
  }

  return Object.freeze({
    body,
    bytes: new TextEncoder().encode(body),
    metadataMimeType,
    mediaMimeType,
  });
}
