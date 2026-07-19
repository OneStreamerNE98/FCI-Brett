import { useEffect, useRef } from "react";

export const reportsReturnFocusHistoryKey = "fciReportsReturnFocusId";
const reportsDestinationFocusStorageKey = "fci-reports-destination-focus";

export function rememberReportReturnFocus(id: string, destinationFocusKey: string) {
  window.history.replaceState({ ...(window.history.state ?? {}), [reportsReturnFocusHistoryKey]: id }, "", window.location.href);
  window.sessionStorage.setItem(reportsDestinationFocusStorageKey, destinationFocusKey);
}

export function clearReportReturnFocusFromCurrentHistoryEntry() {
  const currentState = window.history.state as Record<string, unknown> | null;
  if (!currentState || !(reportsReturnFocusHistoryKey in currentState)) return;
  const nextState = { ...currentState };
  delete nextState[reportsReturnFocusHistoryKey];
  window.history.replaceState(nextState, "", window.location.href);
}

export function useReportDestinationFocus(expectedFocusKey: string) {
  const focusTargetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.sessionStorage.getItem(reportsDestinationFocusStorageKey) !== expectedFocusKey) return;
    const focusFrame = window.requestAnimationFrame(() => {
      focusTargetRef.current?.focus();
      window.sessionStorage.removeItem(reportsDestinationFocusStorageKey);
      clearReportReturnFocusFromCurrentHistoryEntry();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [expectedFocusKey]);

  return focusTargetRef;
}
