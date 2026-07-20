export const FLOORING_KPI_TIME_ZONE = "America/New_York";
export const FINANCIAL_RESTRICTION_LABEL = "Administrator only";

const MILLISECONDS_PER_DAY = 86_400_000;
const backlogStatuses = new Set(["planning", "mobilizing", "installation", "closeout"]);
const monthFormatters = new Map<string, Intl.DateTimeFormat>();

export type FlooringKpiLead = Readonly<{
  status: string;
  source: string;
  estimatedValue: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}>;

export type FlooringKpiProject = Readonly<{
  status: string;
  estimatedValue: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}>;

export type FlooringKpiSourceWinRate = Readonly<{
  source: string;
  won: number;
  decided: number;
  rate: number;
}>;

export type FlooringKpiResult = Readonly<{
  selectedMonth: string;
  wonLeads: number;
  decidedLeads: number;
  winRate: number | null;
  winRateBySource: FlooringKpiSourceWinRate[];
  bookedLeadCount: number;
  bookedValue: number;
  averageConvertedLeadValue: number | null;
  convertedLeadValueCount: number;
  averageCreatedProjectValue: number | null;
  createdProjectValueCount: number;
  averageSalesCycleDays: number | null;
  salesCycleLeadCount: number;
  backlogCount: number;
  backlogValue: number | null;
  backlogValueCount: number;
  jobsCompleted: number;
}>;

function normalizedStatus(value: string) {
  return value.trim().toLowerCase();
}

function reportableAmount(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function reportableTimestamp(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function monthFormatter(timeZone: string) {
  const existing = monthFormatters.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });
  monthFormatters.set(timeZone, formatter);
  return formatter;
}

export function monthKeyForTimestamp(timestamp: number, timeZone = FLOORING_KPI_TIME_ZONE) {
  if (!Number.isFinite(timestamp) || timestamp < 0) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const parts = monthFormatter(timeZone).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : null;
}

function timestampFallsInMonth(timestamp: number | null | undefined, month: string, timeZone: string) {
  const value = reportableTimestamp(timestamp);
  return value !== null && monthKeyForTimestamp(value, timeZone) === month;
}

export function calculateFlooringKpis(
  leads: readonly FlooringKpiLead[],
  projects: readonly FlooringKpiProject[],
  selectedMonth: string,
  timeZone = FLOORING_KPI_TIME_ZONE,
): FlooringKpiResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) {
    throw new RangeError("selectedMonth must use YYYY-MM format.");
  }

  const decidedLeads = leads.filter((lead) => {
    const status = normalizedStatus(lead.status);
    return status === "converted" || status === "lost";
  });
  const convertedLeads = decidedLeads.filter((lead) => normalizedStatus(lead.status) === "converted");
  const sourceGroups = new Map<string, { won: number; decided: number }>();

  for (const lead of decidedLeads) {
    const source = lead.source.trim() || "Unspecified";
    const group = sourceGroups.get(source) ?? { won: 0, decided: 0 };
    group.decided += 1;
    if (normalizedStatus(lead.status) === "converted") group.won += 1;
    sourceGroups.set(source, group);
  }

  const bookedLeads = convertedLeads.filter((lead) => timestampFallsInMonth(lead.updatedAt, selectedMonth, timeZone));
  const bookedValues = bookedLeads.map((lead) => reportableAmount(lead.estimatedValue)).filter((value): value is number => value !== null);
  const convertedLeadValues = convertedLeads.map((lead) => reportableAmount(lead.estimatedValue)).filter((value): value is number => value !== null);
  const createdProjectValues = projects.map((project) => reportableAmount(project.estimatedValue)).filter((value): value is number => value !== null);
  const salesCycleDays = convertedLeads.flatMap((lead) => {
    const createdAt = reportableTimestamp(lead.createdAt);
    const convertedAt = reportableTimestamp(lead.updatedAt);
    return createdAt !== null && convertedAt !== null && convertedAt >= createdAt
      ? [(convertedAt - createdAt) / MILLISECONDS_PER_DAY]
      : [];
  });
  const backlogProjects = projects.filter((project) => backlogStatuses.has(normalizedStatus(project.status)));
  const backlogValues = backlogProjects.map((project) => reportableAmount(project.estimatedValue)).filter((value): value is number => value !== null);
  const jobsCompleted = projects.filter((project) => normalizedStatus(project.status) === "completed" && timestampFallsInMonth(project.updatedAt, selectedMonth, timeZone)).length;

  return {
    selectedMonth,
    wonLeads: convertedLeads.length,
    decidedLeads: decidedLeads.length,
    winRate: decidedLeads.length > 0 ? convertedLeads.length / decidedLeads.length : null,
    winRateBySource: [...sourceGroups.entries()]
      .map(([source, result]) => ({ source, ...result, rate: result.won / result.decided }))
      .sort((left, right) => left.source.localeCompare(right.source)),
    bookedLeadCount: bookedLeads.length,
    bookedValue: bookedValues.reduce((total, value) => total + value, 0),
    averageConvertedLeadValue: average(convertedLeadValues),
    convertedLeadValueCount: convertedLeadValues.length,
    averageCreatedProjectValue: average(createdProjectValues),
    createdProjectValueCount: createdProjectValues.length,
    averageSalesCycleDays: average(salesCycleDays),
    salesCycleLeadCount: salesCycleDays.length,
    backlogCount: backlogProjects.length,
    backlogValue: backlogProjects.length === 0 ? 0 : backlogValues.length > 0 ? backlogValues.reduce((total, value) => total + value, 0) : null,
    backlogValueCount: backlogValues.length,
    jobsCompleted,
  };
}
