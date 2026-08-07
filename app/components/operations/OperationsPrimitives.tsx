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
  className?: string;
  caption?: ReactNode;
  footer?: ReactNode;
};

export function Metric({ label, value, note, icon: Icon, color, href, className, caption, footer }: MetricProps) {
  const hasSupportingContent = Boolean(caption || footer);
  const cardClassName = `metric-card ${href ? "metric-card-link" : "metric-card-static"}${hasSupportingContent ? " metric-card-with-supporting-content" : ""}${className ? ` ${className}` : ""}`;
  const content = <><div className={`metric-icon ${color}`}><Icon size={19} aria-hidden="true" /></div><div className="metric-top"><span>{label}</span></div><strong>{value}</strong><p>{note}</p></>;
  if (href) {
    return <Link className={cardClassName} href={href}>{content}{caption ? <div className="metric-card-caption">{caption}</div> : null}<ChevronRight className="metric-card-chevron" size={16} aria-hidden="true" /></Link>;
  }
  return <article className={cardClassName}>{content}{caption ? <div className="metric-card-caption">{caption}</div> : null}{footer ? <footer className="metric-card-footer">{footer}</footer> : null}</article>;
}

type OperationsEmptyStateProps = {
  variant: "table" | "dashboard" | "page" | "inbox" | "source" | "meeting" | "board" | "client-projects";
  tone?: "default" | "error";
  action?: ReactNode;
  children: ReactNode;
};

export function OperationsEmptyState({ variant, tone = "default", action, children }: OperationsEmptyStateProps) {
  const content = <>{children}{action}</>;
  switch (variant) {
    case "page":
      return <section className="panel empty-tab">{content}</section>;
    case "source":
      return <p className={`source-empty${tone === "error" ? " error" : ""}`}>{content}</p>;
    case "board":
      return <p className="board-empty">{content}</p>;
    case "client-projects":
      return <p className="empty-client-projects">{content}</p>;
    case "table":
      return <div className="empty-table">{content}</div>;
    case "dashboard":
      return <div className="dashboard-inbox-empty">{content}</div>;
    case "inbox":
      return <div className="inbox-empty">{content}</div>;
    case "meeting":
      return <div className={`meeting-empty${tone === "error" ? " error" : ""}`}>{content}</div>;
  }
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
