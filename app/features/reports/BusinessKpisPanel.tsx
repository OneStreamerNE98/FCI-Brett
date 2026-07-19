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

  return <section className="panel business-kpis" aria-labelledby="business-kpis-title">
    <header className="business-kpis-header">
      <div><p className="eyebrow">Tier-1 flooring scorecard</p><h2 id="business-kpis-title">Business KPIs</h2><span>Current outcomes plus month-based booked value and completed jobs.</span></div>
      <label htmlFor="business-kpi-month">Reporting month<input id="business-kpi-month" type="month" value={selectedMonth} onChange={(event) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setSelectedMonth(event.target.value); }} /></label>
    </header>
    <p className="business-kpis-scope"><Clock3 size={15} aria-hidden="true" />Month selection applies to booked value and completed jobs. All month boundaries use the FCI business timezone ({FLOORING_KPI_TIME_ZONE}).</p>
    <div className="business-kpi-grid" aria-live="polite">
      <KpiMetric label="Win rate" value={!ready || kpis.winRate === null ? "—" : rateFormatter.format(kpis.winRate)} note={ready ? `${kpis.wonLeads} won of ${kpis.decidedLeads} decided leads` : pendingNote} icon={Activity} color="green" isAdmin={isAdmin} href={ready ? operationsHref("Leads") : undefined} linkLabel="Review lead outcomes" />
      <KpiMetric label={`Booked value · ${selectedMonthLabel}`} value={moneyValue(kpis.bookedValue)} note={ready ? `${kpis.bookedLeadCount} converted ${kpis.bookedLeadCount === 1 ? "lead" : "leads"} · last-update approximation` : pendingNote} icon={Zap} color="orange" financial isAdmin={isAdmin} />
      <KpiMetric label="Average job value" value={moneyValue(kpis.averageConvertedLeadValue)} note={ready ? isAdmin ? `Converted leads · created projects ${kpis.averageCreatedProjectValue === null ? "—" : currencyFormatter.format(kpis.averageCreatedProjectValue)}` : "Converted-lead and created-project averages are restricted" : pendingNote} icon={BriefcaseBusiness} color="blue" financial isAdmin={isAdmin} />
      <KpiMetric label="Sales cycle" value={!ready || kpis.averageSalesCycleDays === null ? "—" : `${durationFormatter.format(kpis.averageSalesCycleDays)} days`} note={ready ? `${kpis.salesCycleLeadCount} converted ${kpis.salesCycleLeadCount === 1 ? "lead" : "leads"} · last-update approximation` : pendingNote} icon={Clock3} color="violet" isAdmin={isAdmin} />
      <KpiMetric label="Backlog" value={ready ? `${kpis.backlogCount} ${kpis.backlogCount === 1 ? "job" : "jobs"}` : "—"} note={ready ? isAdmin ? `${kpis.backlogValue === null ? "—" : currencyFormatter.format(kpis.backlogValue)} estimated value · ${kpis.backlogValueCount} valued` : "Estimated backlog value is restricted" : pendingNote} icon={BriefcaseBusiness} color="green" financial isAdmin={isAdmin} href={ready ? operationsHref("Projects", { projectStatus: "Active" }) : undefined} linkLabel="View active projects" />
      <KpiMetric label={`Jobs completed · ${selectedMonthLabel}`} value={ready ? String(kpis.jobsCompleted) : "—"} note={ready ? "Completed status · last-update approximation" : pendingNote} icon={CheckCircle2} color="blue" isAdmin={isAdmin} />
    </div>
    <div className="business-kpi-breakdown">
      <section aria-labelledby="win-rate-source-title"><div><h3 id="win-rate-source-title">Win rate by source</h3><span>Converted ÷ converted plus lost</span></div>
        {ready && kpis.winRateBySource.length > 0 ? <div className="business-kpi-table-wrap"><table><thead><tr><th scope="col">Source</th><th scope="col">Won</th><th scope="col">Decided</th><th scope="col">Win rate</th></tr></thead><tbody>{kpis.winRateBySource.map((source) => <tr key={source.source}><th scope="row">{source.source}</th><td>{source.won}</td><td>{source.decided}</td><td>{rateFormatter.format(source.rate)}</td></tr>)}</tbody></table></div> : <div className="empty-table">{ready ? "No converted or lost leads are available for a win-rate calculation." : pendingNote}</div>}
      </section>
      <aside><ShieldCheck size={18} aria-hidden="true" /><div><strong>Honest Tier-1 definitions</strong><p>Converted and completed dates currently use each record’s last update. Project cycle time, margin, product mix, reviews, and crew utilization stay excluded until their source data exists.</p></div></aside>
    </div>
  </section>;
}
