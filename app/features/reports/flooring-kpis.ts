export const FLOORING_KPI_TIME_ZONE = "America/New_York";
export const FINANCIAL_RESTRICTION_LABEL = "Administrator only";
export const FLOORING_KPI_CATEGORIES = ["hardwood", "carpet", "luxury-vinyl", "tile-stone", "laminate", "specialty", "mixed"] as const;

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
  flooringCategory: string | null;
  squareFeet: number | null;
  contractValue: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}>;

export type FlooringKpiProductMix = Readonly<{
  category: string;
  jobCount: number;
  valuedJobCount: number;
  valueShare: number | null;
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
  bookedJobCount: number;
  bookedValue: number | null;
  averageJobValue: number | null;
  averageJobValueCount: number;
  averageSalesCycleDays: number | null;
  salesCycleLeadCount: number;
  backlogCount: number;
  backlogValue: number | null;
  backlogValueCount: number;
  jobsCompleted: number;
  productMix: FlooringKpiProductMix[];
  flooringCategoryCaptureCount: number;
  revenuePerSquareFoot: number | null;
  revenuePerSquareFootJobCount: number;
  squareFeetCaptureCount: number;
  estimateAccuracy: number | null;
  estimateAccuracyJobCount: number;
  contractValueCaptureCount: number;
}>;

function normalizedStatus(value: string) {
  return value.trim().toLowerCase();
}

function reportableAmount(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function reportableSquareFeet(value: number | null) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function reportableCategory(value: string | null) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (FLOORING_KPI_CATEGORIES as readonly string[]).includes(normalized) ? normalized : null;
}

function preferredProjectValue(project: FlooringKpiProject) {
  return reportableAmount(project.contractValue) ?? reportableAmount(project.estimatedValue);
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

  const bookedProjects = projects.filter((project) => timestampFallsInMonth(project.createdAt, selectedMonth, timeZone));
  const bookedValues = bookedProjects.map(preferredProjectValue).filter((value): value is number => value !== null);
  const projectValues = projects.map(preferredProjectValue).filter((value): value is number => value !== null);
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
  const productMixGroups = new Map<string, { jobCount: number; valuedJobCount: number; value: number }>();
  for (const project of bookedProjects) {
    const category = reportableCategory(project.flooringCategory);
    if (category === null) continue;
    const group = productMixGroups.get(category) ?? { jobCount: 0, valuedJobCount: 0, value: 0 };
    group.jobCount += 1;
    const value = preferredProjectValue(project);
    if (value !== null) {
      group.valuedJobCount += 1;
      group.value += value;
    }
    productMixGroups.set(category, group);
  }
  const productMixValueTotal = [...productMixGroups.values()].reduce((total, group) => total + group.value, 0);
  const productMix = FLOORING_KPI_CATEGORIES.flatMap((category) => {
    const group = productMixGroups.get(category);
    return group ? [{
      category,
      jobCount: group.jobCount,
      valuedJobCount: group.valuedJobCount,
      valueShare: group.valuedJobCount > 0 && productMixValueTotal > 0 ? group.value / productMixValueTotal : null,
    }] : [];
  });
  const squareFeetCaptureCount = bookedProjects.filter((project) => reportableSquareFeet(project.squareFeet) !== null).length;
  const revenuePerSquareFootValues = bookedProjects.flatMap((project) => {
    const squareFeet = reportableSquareFeet(project.squareFeet);
    const value = preferredProjectValue(project);
    return squareFeet !== null && value !== null ? [value / squareFeet] : [];
  });
  const contractValueCaptureCount = bookedProjects.filter((project) => reportableAmount(project.contractValue) !== null).length;
  const estimateAccuracyValues = bookedProjects.flatMap((project) => {
    const contractValue = reportableAmount(project.contractValue);
    const estimatedValue = reportableAmount(project.estimatedValue);
    return contractValue !== null && estimatedValue !== null && estimatedValue > 0 ? [contractValue / estimatedValue] : [];
  });

  return {
    selectedMonth,
    wonLeads: convertedLeads.length,
    decidedLeads: decidedLeads.length,
    winRate: decidedLeads.length > 0 ? convertedLeads.length / decidedLeads.length : null,
    winRateBySource: [...sourceGroups.entries()]
      .map(([source, result]) => ({ source, ...result, rate: result.won / result.decided }))
      .sort((left, right) => left.source.localeCompare(right.source)),
    bookedJobCount: bookedProjects.length,
    bookedValue: bookedProjects.length === 0 ? 0 : bookedValues.length > 0 ? bookedValues.reduce((total, value) => total + value, 0) : null,
    averageJobValue: average(projectValues),
    averageJobValueCount: projectValues.length,
    averageSalesCycleDays: average(salesCycleDays),
    salesCycleLeadCount: salesCycleDays.length,
    backlogCount: backlogProjects.length,
    backlogValue: backlogProjects.length === 0 ? 0 : backlogValues.length > 0 ? backlogValues.reduce((total, value) => total + value, 0) : null,
    backlogValueCount: backlogValues.length,
    jobsCompleted,
    productMix,
    flooringCategoryCaptureCount: productMix.reduce((total, category) => total + category.jobCount, 0),
    revenuePerSquareFoot: average(revenuePerSquareFootValues),
    revenuePerSquareFootJobCount: revenuePerSquareFootValues.length,
    squareFeetCaptureCount,
    estimateAccuracy: average(estimateAccuracyValues),
    estimateAccuracyJobCount: estimateAccuracyValues.length,
    contractValueCaptureCount,
  };
}
