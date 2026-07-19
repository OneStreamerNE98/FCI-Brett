import Link from "next/link";
import { ListFilter } from "lucide-react";
import { useReportDestinationFocus } from "./report-navigation";

export function ActiveRouteFilter({ focusKey, headingId, title, description, clearHref }: { focusKey: string; headingId: string; title: string; description: string; clearHref: string }) {
  const focusTargetRef = useReportDestinationFocus(focusKey);

  return <section className="active-route-filter" ref={focusTargetRef} tabIndex={-1} aria-labelledby={headingId}><div><ListFilter size={18} aria-hidden="true" /><div><span>Report filter</span><strong id={headingId}>{title}</strong><p>{description}</p></div></div><Link className="soft-button" href={clearHref}>Clear filter</Link></section>;
}
