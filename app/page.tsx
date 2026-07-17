import { OperationsRoutePage } from "./OperationsRoutePage";

export const dynamic = "force-dynamic";

export default function Home() {
  return <OperationsRoutePage view="Overview" returnPath="/" />;
}
