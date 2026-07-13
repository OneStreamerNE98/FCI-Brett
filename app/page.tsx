import { chatGPTSignOutPath, requireChatGPTUser } from "./chatgpt-auth";
import { FloorOpsApp } from "./FloorOpsApp";
import { officeIdentityForEmail } from "./lib/workspace-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  const officeUser = officeIdentityForEmail(user.email);
  if (!officeUser) {
    return <main className="access-denied"><p>Floor Coverings International Operations</p><h1>Access not authorized</h1><span>{user.email} is signed in, but this account is not on the office access list.</span><a href={chatGPTSignOutPath("/")}>Sign in with another account</a></main>;
  }
  const accessLabel = officeUser.isAdmin ? "Admin" : "Office";
  return <FloorOpsApp userName={user.displayName} userEmail={user.email} accessLabel={accessLabel} signOutHref={chatGPTSignOutPath("/")} />;
}
