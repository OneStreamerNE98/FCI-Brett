import { OperationsRoutePage } from "../OperationsRoutePage";

export const dynamic = "force-dynamic";

export default function ClientsPage() {
  return <OperationsRoutePage view="Clients" returnPath="/clients" />;
}
