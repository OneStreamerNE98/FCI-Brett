import { OperationsRoutePage } from "../OperationsRoutePage";
import { operationsReturnPath, type OperationsPageSearchParams } from "../lib/operations-routes";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<OperationsPageSearchParams> }) {
  return <OperationsRoutePage view="Leads" returnPath={operationsReturnPath("Leads", await searchParams)} />;
}
