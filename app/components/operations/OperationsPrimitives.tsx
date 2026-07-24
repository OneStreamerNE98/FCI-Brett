import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { FeatureStateBadge, type FeatureState } from "../FeatureStateBadge";

type MetricProps = {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  color: string;
  href?: string;
};

export function Metric({ label, value, note, icon: Icon, color, href }: MetricProps) {
  const content = <><div className={`metric-icon ${color}`}><Icon size={19} aria-hidden="true" /></div><div className="metric-top"><span>{label}</span></div><strong>{value}</strong><p>{note}</p></>;
  if (href) {
    return <Link className="metric-card metric-card-link" href={href}>{content}<ChevronRight className="metric-card-chevron" size={16} aria-hidden="true" /></Link>;
  }
  return <article className="metric-card metric-card-static">{content}</article>;
}

export function PanelHeader({ title, subtitle, subtitleKind = "status", badge, action, onAction }: { title: string; subtitle?: string; subtitleKind?: "status" | "source"; badge?: FeatureState; action?: string; onAction?: () => void }) {
  return <header className="panel-header"><div><h2>{title}</h2>{subtitle && <span className={`panel-header-subtitle panel-header-subtitle-${subtitleKind}`}>{subtitle}</span>}{badge && <FeatureStateBadge state={badge} />}</div>{action && <button onClick={onAction}>{action}<ChevronRight size={15} aria-hidden="true" /></button>}</header>;
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
