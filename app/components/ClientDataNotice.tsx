"use client";

import { useCallback, useRef, useState } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";

export type ClientDataNoticeState = "loading" | "error";

/**
 * One loading/failure-and-retry surface for request-driven client reads.
 *
 * DES-26 (August 2026): the retry button now fires on pointer-down and key-down
 * instead of click so the action is captured before a background revalidation
 * can unmount the notice.  An internal "retrying" state keeps the button stable
 * while the retry is in flight, and pointer tracking lets callers (and tests)
 * observe whether the pointer is over the control.
 */
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
  const [retrying, setRetrying] = useState(false);
  const isPointerOverRef = useRef(false);
  const retryFiredRef = useRef(false);

  const fireRetry = useCallback(() => {
    if (retryFiredRef.current) return; // one shot per mount
    retryFiredRef.current = true;
    setRetrying(true);
    onRetry();
  }, [onRetry]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return; // primary button only
    e.preventDefault(); // capture the intent before click completes
    fireRetry();
  }, [fireRetry]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); // suppress scroll on Space
      fireRetry();
    }
  }, [fireRetry]);

  return (
    <div
      className={`settings-data-notice ${failed ? "error" : "loading"}`}
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
      onPointerEnter={() => { isPointerOverRef.current = true; }}
      onPointerLeave={() => { isPointerOverRef.current = false; }}
    >
      {failed ? <CircleAlert size={19} aria-hidden="true" /> : <RefreshCw size={19} aria-hidden="true" />}
      <div>
        <strong role={titleLevel ? "heading" : undefined} aria-level={titleLevel}>
          {retrying ? "Retrying…" : (failed ? errorTitle : loadingTitle)}
        </strong>
        <span>{retrying ? "Your request is being sent." : (failed ? error : loadingDetail)}</span>
      </div>
      {failed && (
        <button
          type="button"
          className="soft-button"
          disabled={retrying}
          data-retry-stable="true"
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
        >
          <RefreshCw size={14} aria-hidden="true" className={retrying ? "icon-spin" : undefined} />
          {" "}{retrying ? "Retrying…" : retryLabel}
        </button>
      )}
    </div>
  );
}
