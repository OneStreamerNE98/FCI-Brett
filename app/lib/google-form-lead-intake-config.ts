const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/u;

export const GOOGLE_FORM_LEAD_RESPONSE_SHEET_ENV =
  "GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID";

export type GoogleFormLeadIntakeConfig = Readonly<{
  configured: boolean;
  invalid: boolean;
  spreadsheetId: string | null;
  source: "simulation" | "environment" | "none";
}>;

/** Presence-only public state plus a server-only Sheet identifier. */
export function googleFormLeadIntakeConfig(
  environment: Readonly<Record<string, string | undefined>>,
  simulation: boolean,
): GoogleFormLeadIntakeConfig {
  if (simulation) {
    return Object.freeze({
      configured: true,
      invalid: false,
      spreadsheetId: "workspace-simulation-lead-form-sheet",
      source: "simulation",
    });
  }
  const candidate = (
    environment[GOOGLE_FORM_LEAD_RESPONSE_SHEET_ENV]
    ?? process.env[GOOGLE_FORM_LEAD_RESPONSE_SHEET_ENV]
    ?? ""
  ).trim();
  if (!candidate) {
    return Object.freeze({
      configured: false,
      invalid: false,
      spreadsheetId: null,
      source: "none",
    });
  }
  const valid = PROVIDER_ID_PATTERN.test(candidate);
  return Object.freeze({
    configured: valid,
    invalid: !valid,
    spreadsheetId: valid ? candidate : null,
    source: valid ? "environment" : "none",
  });
}
