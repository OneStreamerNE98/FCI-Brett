import { useMemo } from "react";
import Link from "next/link";
import { Activity, BriefcaseBusiness, CheckCircle2, ChevronRight, Clock3, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { Metric, OperationsEmptyState } from "../../components/operations/OperationsPrimitives";
import { operationsHref } from "../../lib/operations-routes";
import {
  calculateFlooringKpis,
  FINANCIAL_RESTRICTION_LABEL,
  FLOORING_KPI_TIME_ZONE,
  type FlooringKpiLead,
  type FlooringKpiProject,
} from "./flooring-kpis";

type BusinessKpisPanelProps = {
  leads: readonly FlooringKpiLead[];
  projects: readonly FlooringKpiProject[];
  isAdmin: boolean;
  state: "loading" | "ready" | "error";
  selectedMonth: string;
  onSelectedMonthChange: (month: string) => void;
};

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const unitCurrencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rateFormatter = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const durationFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
}

function unavailableNote(state: BusinessKpisPanelProps["state"]) {
  return state === "loading" ? "Loading current records" : "Unavailable until live records load";
}

export function BusinessKpisPanel({ leads, projects, isAdmin, state, selectedMonth, onSelectedMonthChange }: BusinessKpisPanelProps) {
  const kpis = useMemo(() => calculateFlooringKpis(leads, projects, selectedMonth), [leads, projects, selectedMonth]);
  const ready = state === "ready";
  const selectedMonthLabel = monthLabel(selectedMonth);
  const pendingNote = unavailableNote(state);
  const moneyValue = (value: number | null) => !ready ? "—" : !isAdmin ? FINANCIAL_RESTRICTION_LABEL : value === null ? "—" : currencyFormatter.format(value);
  const tierTwoFinancialValue = (captureCount: number, value: number | null, format: (amount: number) => string) => !ready ? "—" : !isAdmin ? FINANCIAL_RESTRICTION_LABEL : captureCount === 0 ? "Not yet captured" : value === null ? "—" : format(value);
  const financialCaption = <span className="business-kpi-access"><ShieldCheck size={13} aria-hidden="true" />{isAdmin ? "Administrator financial view" : "Dollar value available to administrators only"}</span>;

  return <section className="panel business-kpis" aria-labelledby="business-kpis-title">
    <header className="business-kpis-header">
      <div><p className="eyebrow">Flooring scorecard</p><h2 id="business-kpis-title">Business KPIs</h2><span>Core outcomes plus booking, installation-cycle, and callback measures.</span></div>
      <label htmlFor="business-kpi-month">Reporting month<input id="business-kpi-month" type="month" value={selectedMonth} onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) onSelectedMonthChange(event.target.value); }} /></label>
    </header>
    <p className="business-kpis-scope"><Clock3 size={15} aria-hidden="true" />Month selection applies to booked value, product mix, revenue per square foot, estimate accuracy, completed jobs, install cycle, and callback rate. All month boundaries use the FCI business timezone ({FLOORING_KPI_TIME_ZONE}).</p>
    <div className="business-kpi-grid" aria-live="polite">
      <Metric className="business-kpi-card" label="Win rate" value={!ready || kpis.winRate === null ? "—" : rateFormatter.format(kpis.winRate)} note={ready ? `${kpis.wonLeads} won of ${kpis.decidedLeads} decided leads` : pendingNote} icon={Activity} color="green" footer={ready ? <Link className="business-kpi-link" href={operationsHref("Leads")}>Review lead outcomes<ChevronRight size={15} aria-hidden="true" /></Link> : undefined} />
      <Metric className="business-kpi-card" label={`Booked value · ${selectedMonthLabel}`} value={moneyValue(kpis.bookedValue)} note={ready ? `${kpis.bookedJobCount} booked ${kpis.bookedJobCount === 1 ? "project" : "projects"} · contract value, then estimate fallback` : pendingNote} icon={Zap} color="orange" caption={financialCaption} />
      <Metric className="business-kpi-card" label="Average job value" value={moneyValue(kpis.averageJobValue)} note={ready ? isAdmin ? `${kpis.averageJobValueCount} valued ${kpis.averageJobValueCount === 1 ? "project" : "projects"} · contract value, then estimate fallback` : "Project values are restricted" : pendingNote} icon={BriefcaseBusiness} color="blue" caption={financialCaption} />
      <Metric className="business-kpi-card" label="Sales cycle" value={!ready || kpis.averageSalesCycleDays === null ? "—" : `${durationFormatter.format(kpis.averageSalesCycleDays)} days`} note={ready ? `${kpis.salesCycleLeadCount} converted ${kpis.salesCycleLeadCount === 1 ? "lead" : "leads"} · last-update approximation` : pendingNote} icon={Clock3} color="violet" />
      <Metric className="business-kpi-card" label="Backlog" value={ready ? `${kpis.backlogCount} ${kpis.backlogCount === 1 ? "job" : "jobs"}` : "—"} note={ready ? isAdmin ? `${kpis.backlogValue === null ? "—" : currencyFormatter.format(kpis.backlogValue)} estimated value · ${kpis.backlogValueCount} valued` : "Estimated backlog value is restricted" : pendingNote} icon={BriefcaseBusiness} color="green" caption={financialCaption} footer={ready ? <Link className="business-kpi-link" href={operationsHref("Projects", { projectStatus: "Active" })}>View active projects<ChevronRight size={15} aria-hidden="true" /></Link> : undefined} />
      <Metric className="business-kpi-card" label={`Jobs completed · ${selectedMonthLabel}`} value={ready ? String(kpis.jobsCompleted) : "—"} note={ready ? "Recorded installation completion, then last-update fallback" : pendingNote} icon={CheckCircle2} color="blue" />
      <Metric className="business-kpi-card" label={`Install cycle · ${selectedMonthLabel}`} value={!ready || kpis.averageInstallCycleDays === null ? "—" : `${durationFormatter.format(kpis.averageInstallCycleDays)} days`} note={ready ? `${kpis.installCycleJobCount} completed ${kpis.installCycleJobCount === 1 ? "job" : "jobs"} with both installation dates` : pendingNote} icon={Clock3} color="violet" />
      <Metric className="business-kpi-card" label={`Callback rate · ${selectedMonthLabel}`} value={!ready || kpis.callbackRate === null ? "—" : rateFormatter.format(kpis.callbackRate)} note={ready ? `${kpis.callbackJobCount} recorded Yes across ${kpis.callbackCompletedJobCount} completed · default No can include uncaptured legacy rows` : pendingNote} icon={RefreshCw} color="orange" />
      <Metric className="business-kpi-card" label={`Product mix · ${selectedMonthLabel}`} value={!ready ? "—" : kpis.flooringCategoryCaptureCount === 0 ? "Not yet captured" : `${kpis.productMix.length} ${kpis.productMix.length === 1 ? "category" : "categories"}`} note={ready ? kpis.flooringCategoryCaptureCount === 0 ? "No booked projects carry a flooring category" : `${kpis.flooringCategoryCaptureCount} booked ${kpis.flooringCategoryCaptureCount === 1 ? "project" : "projects"} categorized` : pendingNote} icon={BriefcaseBusiness} color="green" />
      <Metric className="business-kpi-card" label={`Revenue per sq ft · ${selectedMonthLabel}`} value={tierTwoFinancialValue(kpis.squareFeetCaptureCount, kpis.revenuePerSquareFoot, (value) => `${unitCurrencyFormatter.format(value)}/sq ft`)} note={ready ? kpis.squareFeetCaptureCount === 0 ? "Not yet captured on booked projects" : `${kpis.revenuePerSquareFootJobCount} ${kpis.revenuePerSquareFootJobCount === 1 ? "project" : "projects"} with square feet and a value` : pendingNote} icon={Activity} color="orange" caption={financialCaption} />
      <Metric className="business-kpi-card" label={`Estimate accuracy · ${selectedMonthLabel}`} value={tierTwoFinancialValue(kpis.contractValueCaptureCount, kpis.estimateAccuracy, (value) => rateFormatter.format(value))} note={ready ? !isAdmin ? "Contract-value capture details are restricted" : kpis.contractValueCaptureCount === 0 ? "Not yet captured on booked projects" : `${kpis.estimateAccuracyJobCount} ${kpis.estimateAccuracyJobCount === 1 ? "project" : "projects"} with contract and non-zero estimate` : pendingNote} icon={Activity} color="violet" caption={financialCaption} />
    </div>
    <div className="business-kpi-breakdown">
      <section aria-labelledby="win-rate-source-title"><div><h3 id="win-rate-source-title">Win rate by source</h3><span>Converted ÷ converted plus lost</span></div>
        {ready && kpis.winRateBySource.length > 0 ? <div className="business-kpi-table-wrap"><table><thead><tr><th scope="col">Source</th><th scope="col">Won</th><th scope="col">Decided</th><th scope="col">Win rate</th></tr></thead><tbody>{kpis.winRateBySource.map((source) => <tr key={source.source}><th scope="row">{source.source}</th><td>{source.won}</td><td>{source.decided}</td><td>{rateFormatter.format(source.rate)}</td></tr>)}</tbody></table></div> : <OperationsEmptyState variant="table">{ready ? "No converted or lost leads are available for a win-rate calculation." : pendingNote}</OperationsEmptyState>}
      </section>
      <section aria-labelledby="product-mix-title"><div><h3 id="product-mix-title">Product mix</h3><span>Booked job count · value share is financial</span></div>
        {ready && kpis.productMix.length > 0 ? <div className="business-kpi-table-wrap"><table><thead><tr><th scope="col">Category</th><th scope="col">Jobs</th><th scope="col">Value share</th></tr></thead><tbody>{kpis.productMix.map((category) => <tr key={category.category}><th scope="row">{category.category.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")}</th><td>{category.jobCount}</td><td>{!isAdmin ? FINANCIAL_RESTRICTION_LABEL : category.valueShare === null ? "—" : rateFormatter.format(category.valueShare)}</td></tr>)}</tbody></table></div> : <OperationsEmptyState variant="table">{ready ? "Not yet captured — no booked projects carry a flooring category for this month." : pendingNote}</OperationsEmptyState>}
      </section>
      <aside><ShieldCheck size={18} aria-hidden="true" /><div><strong>Honest flooring definitions</strong><p>Booking measures use project creation time. Completed-job timing prefers the recorded installation completion date and falls back only where documented. Margin, reviews, and crew utilization stay excluded until their source data exists.</p></div></aside>
    </div>
  </section>;
}
