"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { useClientGetRevalidation } from "../lib/client-get-hooks";

/** Global, renderless focus/visibility/navigation freshness boundary. */
export function ClientDataFreshnessBoundary() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useClientGetRevalidation(`${pathname}?${search}`);
  return null;
}
