"use client";

import { ClientDataNotice } from "../../components/ClientDataNotice";

type LoadState = "loading" | "ready" | "error";

export function SettingsDataNotice({
  state,
  error,
  onRetry,
  loadingTitle = "Loading saved settings…",
  loadingDetail = "Editing and saving will be available after the server values arrive.",
  errorTitle = "Saved settings could not be loaded",
}: {
  state: Exclude<LoadState, "ready">;
  error: string;
  onRetry: () => void;
  loadingTitle?: string;
  loadingDetail?: string;
  errorTitle?: string;
}) {
  return <ClientDataNotice
    state={state}
    error={error}
    onRetry={onRetry}
    loadingTitle={loadingTitle}
    loadingDetail={loadingDetail}
    errorTitle={errorTitle}
  />;
}
