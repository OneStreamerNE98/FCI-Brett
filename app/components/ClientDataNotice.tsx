"use client";

import { CircleAlert, RefreshCw } from "lucide-react";

export type ClientDataNoticeState = "loading" | "error";

/** One loading/failure-and-retry surface for request-driven client reads. */
export function ClientDataNotice({
  state,
  error,
  onRetry,
  loadingTitle = "Loading saved data…",
  loadingDetail = "The current server values will appear when this read finishes.",
  errorTitle = "Saved data could not be loaded",
  retryLabel = "Retry",
  titleLevel,
}: {
  state: ClientDataNoticeState;
  error: string;
  onRetry: () => void;
  loadingTitle?: string;
  loadingDetail?: string;
  errorTitle?: string;
  retryLabel?: string;
  titleLevel?: 2 | 3 | 4;
}) {
  const failed = state === "error";
  return <div className={`settings-data-notice ${failed ? "error" : "loading"}`} role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"}>
    {failed ? <CircleAlert size={19} aria-hidden="true" /> : <RefreshCw size={19} aria-hidden="true" />}
    <div><strong role={titleLevel ? "heading" : undefined} aria-level={titleLevel}>{failed ? errorTitle : loadingTitle}</strong><span>{failed ? error : loadingDetail}</span></div>
    {failed && <button type="button" className="soft-button" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> {retryLabel}</button>}
  </div>;
}
