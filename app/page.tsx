import { chatGPTSignOutPath, requireChatGPTUser } from "./chatgpt-auth";
import { FloorOpsApp } from "./FloorOpsApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <FloorOpsApp userName={user.displayName} userEmail={user.email} signOutHref={chatGPTSignOutPath("/")} />;
}
