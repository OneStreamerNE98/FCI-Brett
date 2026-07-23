export type FilingRuleAction = "suggest" | "review" | "ignore";

export type FilingRuleValues = {
  name: string;
  enabled: boolean;
  priority: number;
  matchSummary: string;
  action: FilingRuleAction;
  targetCategory: string;
  approvalRequired: boolean;
};

export type FilingRulePatchValues = Partial<Omit<FilingRuleValues, "approvalRequired">>;

export type FilingRuleRecord = FilingRuleValues & Readonly<{
  id: string;
  created_by?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}> & Readonly<Record<string, unknown>>;

type ValidationResult<T> =
  | { ok: true; values: T }
  | { ok: false; error: string };

function ruleText(value: unknown, name: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`${name} must be text.`);
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!text || text.length > maximum) throw new Error(`${name} is required and must be ${maximum} characters or fewer.`);
  return text;
}

function ruleBoolean(value: unknown, name: string) {
  if (typeof value !== "boolean") throw new Error(`${name} must be true or false.`);
  return value;
}

function rulePriority(value: unknown) {
  const priority = Number(value);
  if (!Number.isInteger(priority) || priority < 1 || priority > 999) throw new Error("priority must be between 1 and 999.");
  return priority;
}

function ruleAction(value: unknown): FilingRuleAction {
  if (value !== "suggest" && value !== "review" && value !== "ignore") throw new Error("Choose suggest, review, or ignore.");
  return value;
}

export function validateFilingRuleCreate(body: Record<string, unknown>): ValidationResult<FilingRuleValues> {
  try {
    return {
      ok: true,
      values: {
        name: ruleText(body.name, "name", 120),
        enabled: body.enabled === undefined ? true : ruleBoolean(body.enabled, "enabled"),
        priority: rulePriority(body.priority ?? 99),
        matchSummary: ruleText(body.matchSummary, "matching criteria", 600),
        action: ruleAction(body.action),
        targetCategory: ruleText(body.targetCategory, "destination", 160),
        approvalRequired: body.approvalRequired === undefined ? true : ruleBoolean(body.approvalRequired, "approvalRequired"),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Rule details are invalid." };
  }
}

export function validateFilingRulePatch(body: Record<string, unknown>): ValidationResult<FilingRulePatchValues> {
  try {
    const values: FilingRulePatchValues = {};
    if (body.enabled !== undefined) values.enabled = ruleBoolean(body.enabled, "enabled");
    if (body.priority !== undefined) values.priority = rulePriority(body.priority);
    if (body.name !== undefined) values.name = ruleText(body.name, "name", 120);
    if (body.matchSummary !== undefined) values.matchSummary = ruleText(body.matchSummary, "matching criteria", 600);
    if (body.action !== undefined) values.action = ruleAction(body.action);
    if (body.targetCategory !== undefined) values.targetCategory = ruleText(body.targetCategory, "destination", 160);
    return { ok: true, values };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Rule update is invalid." };
  }
}

/** Keep D1 column names for compatibility while exposing the camelCase API. */
export function normalizeStoredFilingRule(row: Record<string, unknown>): FilingRuleRecord {
  const {
    match_summary: storedMatchSummary,
    target_category: storedTargetCategory,
    approval_required: storedApprovalRequired,
    ...camelCaseRow
  } = row;
  return {
    ...camelCaseRow,
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    enabled: Boolean(row.enabled),
    priority: Number(row.priority),
    matchSummary: String(row.matchSummary ?? storedMatchSummary ?? ""),
    action: String(row.action ?? "") as FilingRuleAction,
    targetCategory: String(row.targetCategory ?? storedTargetCategory ?? ""),
    approvalRequired: Boolean(row.approvalRequired ?? storedApprovalRequired),
  };
}
