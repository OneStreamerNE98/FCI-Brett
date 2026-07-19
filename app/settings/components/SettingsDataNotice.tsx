"use client";

import { CircleAlert, RefreshCw } from "lucide-react";

type LoadState = "loading" | "ready" | "error";

export function SettingsDataNotice({ state, error, onRetry }: { state: Exclude<LoadState, "ready">; error: string; onRetry: () => void }) {
  const failed = state === "error";
  return <div className={`settings-data-notice ${failed ? "error" : "loading"}`} role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"}>
    {failed ? <CircleAlert size={19} aria-hidden="true" /> : <RefreshCw size={19} aria-hidden="true" />}
    <div><strong>{failed ? "Saved settings could not be loaded" : "Loading saved settings…"}</strong><span>{failed ? error : "Editing and saving will be available after the server values arrive."}</span></div>
    {failed && <button type="button" className="soft-button" onClick={onRetry}><RefreshCw size={14} /> Retry</button>}
  </div>;
}

