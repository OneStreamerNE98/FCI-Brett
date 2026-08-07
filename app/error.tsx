"use client";

import { useEffect } from "react";
import { AppFailureSurface } from "./components/AppFailureSurface";

export default function RouteError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("An FCI Operations route could not render.", error);
  }, [error]);

  return <AppFailureSurface onReload={() => window.location.reload()} />;
}
