import { OperationsRoutePage } from "../OperationsRoutePage";
import { operationsReturnPath, type OperationsPageSearchParams } from "../lib/operations-routes";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<OperationsPageSearchParams> }) {
  return <OperationsRoutePage view="Projects" returnPath={operationsReturnPath("Projects", await searchParams)} />;
}
