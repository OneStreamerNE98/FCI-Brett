"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AppFailureSurface } from "./AppFailureSurface";

type AppErrorBoundaryState = { failed: boolean };

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, details: ErrorInfo) {
    console.error("The FCI Operations app shell could not render.", error, details.componentStack);
  }

  render() {
    if (this.state.failed) {
      return <AppFailureSurface onReload={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}
