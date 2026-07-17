import { OperationsRoutePage } from "../OperationsRoutePage";
import { operationsReturnPath, type OperationsPageSearchParams } from "../lib/operations-routes";

export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: { searchParams: Promise<OperationsPageSearchParams> }) {
  return <OperationsRoutePage view="Inbox" returnPath={operationsReturnPath("Inbox", await searchParams)} />;
}
