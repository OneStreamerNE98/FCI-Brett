"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";

export function AppFailureSurface({ onReload }: { onReload: () => void }) {
  return <section className="app-failure-surface" role="alert">
    <div className="app-failure-icon"><TriangleAlert size={24} aria-hidden="true" /></div>
    <p className="eyebrow">FCI Operations</p>
    <h1>This page could not be displayed</h1>
    <p>Reload the page to try again. If you just completed an action, check its current status before repeating it.</p>
    <button type="button" className="primary-button" onClick={onReload}>
      <RefreshCw size={16} aria-hidden="true" /> Reload page
    </button>
  </section>;
}
