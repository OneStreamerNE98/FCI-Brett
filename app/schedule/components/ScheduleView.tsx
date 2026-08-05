"use client";

import { CalendarDays, Settings } from "lucide-react";
import {
  OperationsEmptyState,
  PageTitle,
} from "../../components/operations/OperationsPrimitives";
import type { DashboardSummary } from "../../lib/record-types";

export function ScheduleView({ dashboard, onSettings }: { dashboard: DashboardSummary | null; onSettings: () => void }) {
  return <><PageTitle eyebrow="Field operations" title="Schedule & crews" text="Scheduling is planned for a later milestone." state="Planned" action={<button className="soft-button" onClick={onSettings}><Settings size={16} /> Workflow & notification settings</button>} />
    <OperationsEmptyState variant="page"><div><CalendarDays size={27} /></div><h2>What the scheduling workspace will include</h2><p>{dashboard?.readiness.scheduleReason ?? "Workers, crews, shifts, conflicts, and assignment acknowledgements will appear here after the scheduling foundation is approved."}</p></OperationsEmptyState>
  </>;
}
