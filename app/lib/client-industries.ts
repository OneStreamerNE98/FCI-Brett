export const CLIENT_INDUSTRY_OPTIONS = [
  "General contractor",
  "Healthcare",
  "Retail",
  "Hospitality",
  "Property management",
  "Other commercial",
  "Residential",
] as const;

export type ClientIndustryCount = {
  industry: string;
  count: number;
};

export type ClientIndustryReportState = {
  subtitle: string;
  rows: ClientIndustryCount[];
  emptyMessage: string | null;
};

const canonicalIndustryLabels = new Map(
  CLIENT_INDUSTRY_OPTIONS.map((industry) => [industry.toLowerCase(), industry]),
);

function displayIndustry(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Unspecified";
  return canonicalIndustryLabels.get(trimmed.toLowerCase()) ?? trimmed;
}

export function summarizeClientsByIndustry(clients: readonly { industry: string }[]): ClientIndustryCount[] {
  const counts = new Map<string, ClientIndustryCount>();
  for (const client of clients) {
    const industry = displayIndustry(client.industry);
    const key = industry.toLowerCase();
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { industry, count: 1 });
  }
  return [...counts.values()].sort((left, right) =>
    right.count - left.count || left.industry.localeCompare(right.industry),
  );
}

export function clientIndustryReportState(
  clients: readonly { industry: string }[],
  state: "loading" | "ready" | "error",
): ClientIndustryReportState {
  if (state === "error") {
    return {
      subtitle: "Unavailable",
      rows: [],
      emptyMessage: "Client industry data is unavailable until live records load.",
    };
  }
  if (state !== "ready") {
    return {
      subtitle: "Checking live records",
      rows: [],
      emptyMessage: null,
    };
  }
  const rows = summarizeClientsByIndustry(clients);
  return {
    subtitle: `${clients.length} client ${clients.length === 1 ? "account" : "accounts"}`,
    rows,
    emptyMessage: rows.length === 0 ? "No client industry data is available yet." : null,
  };
}
