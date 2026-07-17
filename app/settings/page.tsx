import { OperationsRoutePage } from "../OperationsRoutePage";
import { operationsReturnPath, type OperationsPageSearchParams } from "../lib/operations-routes";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<OperationsPageSearchParams> }) {
  return <OperationsRoutePage view="Settings" returnPath={operationsReturnPath("Settings", await searchParams)} />;
}
