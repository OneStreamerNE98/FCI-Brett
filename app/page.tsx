import { getChatGPTUser } from "./chatgpt-auth";
import { FloorOpsApp } from "./FloorOpsApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <FloorOpsApp userName={user?.displayName ?? "Jason"} />;
}
