import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { FeatureStateBadge, type FeatureState } from "../FeatureStateBadge";

export function Metric({ label, value, note, trend, icon: Icon, color }: { label: string; value: string; note: string; trend?: string; icon: LucideIcon; color: string }) {
  return <article className="metric-card"><div className={`metric-icon ${color}`}><Icon size={19} /></div><div className="metric-top"><span>{label}</span>{trend && <small>{trend}</small>}</div><strong>{value}</strong><p>{note}</p></article>;
}

export function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  return <header className="panel-header"><div><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}</div>{action && <button onClick={onAction}>{action}<ChevronRight size={15} /></button>}</header>;
}

export function PageTitle({ eyebrow, title, text, state, action }: { eyebrow: string; title: string; text: string; state?: FeatureState; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="page-title-kicker"><p className="eyebrow">{eyebrow}</p>{state && <FeatureStateBadge state={state} />}</div><h1>{title}</h1><p>{text}</p></div>{action ? <div className="title-actions">{action}</div> : null}</div>;
}

export function Avatar({ initials, color }: { initials: string; color: string }) {
  return <span className={`mini-avatar ${color}`} aria-hidden="true">{initials}</span>;
}

export function Status({ text }: { text: string }) {
  return <span className={`status status-${text.toLowerCase().replaceAll(" ", "-")}`}>{text}</span>;
}
