"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * DES-19 — container-aware layout primitives.
 *
 * The five shared contracts the August 4 responsive-layout audit
 * (docs/design-reviews/2026-08-04-responsive-layout-audit.md) names in its P3
 * "viewport patches" fix direction. They exist so a conditional control row
 * never again depends on the local author remembering a breakpoint override:
 * sizing is by container query on available width, target size and the no-wrap
 * contract are owned by the primitive, and the dynamic-state guard
 * (tests/helpers/dynamic-state-guard.ts) asserts the sanctioned shapes.
 *
 * These components ship UNUSED by pinned pages until the DES-21 migration
 * packet; the golden hashes in tests/e2e/page-layouts.spec.ts cover default
 * renders only and must not move. The guard's fixture harness renders them
 * directly in a browser, so they are not untested — they are unmounted.
 *
 * Styles: app/responsive-primitives.css (global, rp-* classes). The class
 * names are part of the guard contract — data-action-group, data-density,
 * and data-no-wrap are read by the collector.
 */

export type ActionGroupDensity = "standard" | "dense";

export type ResponsiveActionGroupProps = Readonly<{
  /** Accessible name for the control cluster (rendered as role="group"). */
  label: string;
  /**
   * "standard" gives every control the 44px --target-min at all widths.
   * "dense" is the documented desktop variant (--control-compact); the
   * coarse-pointer media query restores 44px, so dense can never under-size
   * a touch target.
   */
  density?: ActionGroupDensity;
  children: ReactNode;
}>;

export function ResponsiveActionGroup({ label, density = "standard", children }: ResponsiveActionGroupProps) {
  return (
    <div className="rp-action-group" data-action-group="" data-density={density}>
      <div className="rp-action-group-inner" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export type PageHeaderProps = Readonly<{
  eyebrow?: ReactNode;
  title: string;
  text?: ReactNode;
  /** Expected to be a ResponsiveActionGroup; rendered inline-end on wide containers. */
  actions?: ReactNode;
  /**
   * When false (default) the title carries data-no-wrap: one line, ellipsis,
   * and the guard fails the state if it measures taller than a single line.
   */
  allowTitleWrap?: boolean;
}>;

export function PageHeader({ eyebrow, title, text, actions, allowTitleWrap = false }: PageHeaderProps) {
  return (
    <header className="rp-page-header">
      <div className="rp-page-header-inner">
        <div className="rp-page-header-title">
          {eyebrow ? <p className="rp-eyebrow">{eyebrow}</p> : null}
          <h1 {...(allowTitleWrap ? {} : { "data-no-wrap": "" })}>{title}</h1>
          {text ? <p className="rp-page-header-text">{text}</p> : null}
        </div>
        {actions ?? null}
      </div>
    </header>
  );
}

export type PanelHeaderProps = Readonly<{
  title: string;
  subtitle?: ReactNode;
  /** Expected to be a ResponsiveActionGroup; collapses to the second row on narrow panels. */
  actions?: ReactNode;
  allowTitleWrap?: boolean;
}>;

export function PanelHeader({ title, subtitle, actions, allowTitleWrap = false }: PanelHeaderProps) {
  return (
    <div className="rp-panel-header">
      <div className="rp-panel-header-inner">
        <div className="rp-panel-header-title">
          <h2 {...(allowTitleWrap ? {} : { "data-no-wrap": "" })}>{title}</h2>
          {subtitle ? <span className="rp-panel-header-subtitle">{subtitle}</span> : null}
        </div>
        {actions ?? null}
      </div>
    </div>
  );
}

export type ModalFooterProps = Readonly<{
  /**
   * Same density contract as ResponsiveActionGroup. On narrow containers the
   * footer stacks with the primary action visually on top (column-reverse);
   * DOM order — and therefore tab order — is unchanged.
   */
  density?: ActionGroupDensity;
  children: ReactNode;
}>;

export function ModalFooter({ density = "standard", children }: ModalFooterProps) {
  return (
    <footer className="rp-modal-footer" data-density={density}>
      <div className="rp-modal-footer-inner">{children}</div>
    </footer>
  );
}

export type DisclosureHeaderProps = Readonly<{
  title: string;
  expanded: boolean;
  onToggle: () => void;
  /** Optional ResponsiveActionGroup; wraps below the trigger on narrow containers. */
  actions?: ReactNode;
  allowTitleWrap?: boolean;
}>;

export function DisclosureHeader({ title, expanded, onToggle, actions, allowTitleWrap = false }: DisclosureHeaderProps) {
  return (
    <div className="rp-disclosure-header">
      <div className="rp-disclosure-header-inner">
        <button
          type="button"
          className="rp-disclosure-trigger"
          aria-expanded={expanded}
          onClick={onToggle}
          {...(allowTitleWrap ? {} : { "data-no-wrap": "" })}
        >
          <ChevronRight className="rp-disclosure-chevron" size={16} aria-hidden="true" data-expanded={expanded} />
          <span>{title}</span>
        </button>
        {actions ?? null}
      </div>
    </div>
  );
}
