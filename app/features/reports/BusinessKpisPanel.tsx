import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, BriefcaseBusiness, CheckCircle2, ChevronRight, Clock3, ShieldCheck, Zap, type LucideIcon } from "lucide-react";
import { operationsHref } from "../../lib/operations-routes";
import {
  calculateFlooringKpis,
  FINANCIAL_RESTRICTION_LABEL,
  FLOORING_KPI_TIME_ZONE,
  monthKeyForTimestamp,
  type FlooringKpiLead,
  type FlooringKpiProject,
} from "./flooring-kpis";

type BusinessKpisPanelProps = {
  leads: readonly FlooringKpiLead[];
  projects: readonly FlooringKpiProject[];
  isAdmin: boolean;
  state: "loading" | "ready" | "error";
};

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const unitCurrencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rateFormatter = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const durationFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
}

function KpiMetric({ label, value, note, icon: Icon, color, financial = false, isAdmin, href, linkLabel }: {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  color: string;
  financial?: boolean;
  isAdmin: boolean;
  href?: string;
  linkLabel?: string;
}) {
  return <article className="metric-card business-kpi-card">
    <div className={`metric-icon ${color}`}><Icon size={19} aria-hidden="true" /></div>
    <div className="metric-top"><span>{label}</span></div>
    <strong>{value}</strong>
    <p>{note}</p>
    {financial && <span className="business-kpi-access"><ShieldCheck size={13} aria-hidden="true" />{isAdmin ? "Administrator financial view" : "Dollar value available to administrators only"}</span>}
    {href && linkLabel && <Link className="business-kpi-link" href={href}>{linkLabel}<ChevronRight size={15} aria-hidden="true" /></Link>}
  </article>;
}

function unavailableNote(state: BusinessKpisPanelProps["state"]) {
  return state === "loading" ? "Loading current records" : "Unavailable until live records load";
}

export function BusinessKpisPanel({ leads, projects, isAdmin, state }: BusinessKpisPanelProps) {
  const [selectedMonth, setSelectedMonth] = useState(() => monthKeyForTimestamp(Date.now()) ?? new Date().toISOString().slice(0, 7));
  const kpis = useMemo(() => calculateFlooringKpis(leads, projects, selectedMonth), [leads, projects, selectedMonth]);
  const ready = state === "ready";
  const selectedMonthLabel = monthLabel(selectedMonth);
  const pendingNote = unavailableNote(state);
  const moneyValue = (value: number | null) => !ready ? "—" : !isAdmin ? FINANCIAL_RESTRICTION_LABEL : value === null ? "—" : currencyFormatter.format(value);
  const tierTwoFinancialValue = (captureCount: number, value: number | null, format: (amount: number) => string) => !ready ? "—" : !isAdmin ? FINANCIAL_RESTRICTION_LABEL : captureCount === 0 ? "Not yet captured" : value === null ? "—" : format(value);

  return <section className="panel business-kpis" aria-labelledby="business-kpis-title">
    <header className="business-kpis-header">
      <div><p className="eyebrow">Flooring scorecard</p><h2 id="business-kpis-title">Business KPIs</h2><span>Core outcomes plus booking-time flooring mix, size, and sold-value measures.</span></div>
      <label htmlFor="business-kpi-month">Reporting month<input id="business-kpi-month" type="month" value={selectedMonth} onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setSelectedMonth(event.target.value); }} /></label>
    </header>
    <p className="business-kpis-scope"><Clock3 size={15} aria-hidden="true" />Month selection applies to booked value, product mix, revenue per square foot, estimate accuracy, and completed jobs. All month boundaries use the FCI business timezone ({FLOORING_KPI_TIME_ZONE}).</p>
    <div className="business-kpi-grid" aria-live="polite">
      <KpiMetric label="Win rate" value={!ready || kpis.winRate === null ? "—" : rateFormatter.format(kpis.winRate)} note={ready ? `${kpis.wonLeads} won of ${kpis.decidedLeads} decided leads` : pendingNote} icon={Activity} color="green" isAdmin={isAdmin} href={ready ? operationsHref("Leads") : undefined} linkLabel="Review lead outcomes" />
      <KpiMetric label={`Booked value · ${selectedMonthLabel}`} value={moneyValue(kpis.bookedValue)} note={ready ? `${kpis.bookedJobCount} booked ${kpis.bookedJobCount === 1 ? "project" : "projects"} · contract value, then estimate fallback` : pendingNote} icon={Zap} color="orange" financial isAdmin={isAdmin} />
      <KpiMetric label="Average job value" value={moneyValue(kpis.averageJobValue)} note={ready ? isAdmin ? `${kpis.averageJobValueCount} valued ${kpis.averageJobValueCount === 1 ? "project" : "projects"} · contract value, then estimate fallback` : "Project values are restricted" : pendingNote} icon={BriefcaseBusiness} color="blue" financial isAdmin={isAdmin} />
      <KpiMetric label="Sales cycle" value={!ready || kpis.averageSalesCycleDays === null ? "—" : `${durationFormatter.format(kpis.averageSalesCycleDays)} days`} note={ready ? `${kpis.salesCycleLeadCount} converted ${kpis.salesCycleLeadCount === 1 ? "lead" : "leads"} · last-update approximation` : pendingNote} icon={Clock3} color="violet" isAdmin={isAdmin} />
      <KpiMetric label="Backlog" value={ready ? `${kpis.backlogCount} ${kpis.backlogCount === 1 ? "job" : "jobs"}` : "—"} note={ready ? isAdmin ? `${kpis.backlogValue === null ? "—" : currencyFormatter.format(kpis.backlogValue)} estimated value · ${kpis.backlogValueCount} valued` : "Estimated backlog value is restricted" : pendingNote} icon={BriefcaseBusiness} color="green" financial isAdmin={isAdmin} href={ready ? operationsHref("Projects", { projectStatus: "Active" }) : undefined} linkLabel="View active projects" />
      <KpiMetric label={`Jobs completed · ${selectedMonthLabel}`} value={ready ? String(kpis.jobsCompleted) : "—"} note={ready ? "Completed status · last-update approximation" : pendingNote} icon={CheckCircle2} color="blue" isAdmin={isAdmin} />
      <KpiMetric label={`Product mix · ${selectedMonthLabel}`} value={!ready ? "—" : kpis.flooringCategoryCaptureCount === 0 ? "Not yet captured" : `${kpis.productMix.length} ${kpis.productMix.length === 1 ? "category" : "categories"}`} note={ready ? kpis.flooringCategoryCaptureCount === 0 ? "No booked projects carry a flooring category" : `${kpis.flooringCategoryCaptureCount} booked ${kpis.flooringCategoryCaptureCount === 1 ? "project" : "projects"} categorized` : pendingNote} icon={BriefcaseBusiness} color="green" isAdmin={isAdmin} />
      <KpiMetric label={`Revenue per sq ft · ${selectedMonthLabel}`} value={tierTwoFinancialValue(kpis.squareFeetCaptureCount, kpis.revenuePerSquareFoot, (value) => `${unitCurrencyFormatter.format(value)}/sq ft`)} note={ready ? kpis.squareFeetCaptureCount === 0 ? "Not yet captured on booked projects" : `${kpis.revenuePerSquareFootJobCount} ${kpis.revenuePerSquareFootJobCount === 1 ? "project" : "projects"} with square feet and a value` : pendingNote} icon={Activity} color="orange" financial isAdmin={isAdmin} />
      <KpiMetric label={`Estimate accuracy · ${selectedMonthLabel}`} value={tierTwoFinancialValue(kpis.contractValueCaptureCount, kpis.estimateAccuracy, (value) => rateFormatter.format(value))} note={ready ? kpis.contractValueCaptureCount === 0 ? "Not yet captured on booked projects" : `${kpis.estimateAccuracyJobCount} ${kpis.estimateAccuracyJobCount === 1 ? "project" : "projects"} with contract and non-zero estimate` : pendingNote} icon={Activity} color="violet" financial isAdmin={isAdmin} />
    </div>
    <div className="business-kpi-breakdown">
      <section aria-labelledby="win-rate-source-title"><div><h3 id="win-rate-source-title">Win rate by source</h3><span>Converted ÷ converted plus lost</span></div>
        {ready && kpis.winRateBySource.length > 0 ? <div className="business-kpi-table-wrap"><table><thead><tr><th scope="col">Source</th><th scope="col">Won</th><th scope="col">Decided</th><th scope="col">Win rate</th></tr></thead><tbody>{kpis.winRateBySource.map((source) => <tr key={source.source}><th scope="row">{source.source}</th><td>{source.won}</td><td>{source.decided}</td><td>{rateFormatter.format(source.rate)}</td></tr>)}</tbody></table></div> : <div className="empty-table">{ready ? "No converted or lost leads are available for a win-rate calculation." : pendingNote}</div>}
      </section>
      <section aria-labelledby="product-mix-title"><div><h3 id="product-mix-title">Product mix</h3><span>Booked job count · value share is financial</span></div>
        {ready && kpis.productMix.length > 0 ? <div className="business-kpi-table-wrap"><table><thead><tr><th scope="col">Category</th><th scope="col">Jobs</th><th scope="col">Value share</th></tr></thead><tbody>{kpis.productMix.map((category) => <tr key={category.category}><th scope="row">{category.category.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")}</th><td>{category.jobCount}</td><td>{!isAdmin ? FINANCIAL_RESTRICTION_LABEL : category.valueShare === null ? "—" : rateFormatter.format(category.valueShare)}</td></tr>)}</tbody></table></div> : <div className="empty-table">{ready ? "Not yet captured — no booked projects carry a flooring category for this month." : pendingNote}</div>}
      </section>
      <aside><ShieldCheck size={18} aria-hidden="true" /><div><strong>Honest flooring definitions</strong><p>Booking measures use project creation time. Contract value falls back to the estimate only where documented. Installation cycle time, margin, reviews, and crew utilization stay excluded until their source data exists.</p></div></aside>
    </div>
  </section>;
}
