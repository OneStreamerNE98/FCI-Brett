import { chatGPTSignOutPath, requireChatGPTUser } from "./chatgpt-auth";
import { FloorOpsApp } from "./FloorOpsApp";
import { resolveAppEnvironment } from "./lib/app-environment";
import { getSitesJobSiteMapsRuntimeConfig } from "./lib/job-site-maps-sites";
import type { OperationsView } from "./lib/operations-routes";
import { officeIdentityForEmail } from "./lib/workspace-auth";

export async function OperationsRoutePage({ view, returnPath }: { view: OperationsView; returnPath: string }) {
  const user = await requireChatGPTUser(returnPath);
  const officeUser = officeIdentityForEmail(user.email);
  if (!officeUser) {
    return <main className="access-denied"><p>Floor Coverings International Operations</p><h1>Access not authorized</h1><span>{user.email} is signed in, but this account is not on the office access list.</span><a href={chatGPTSignOutPath(returnPath)}>Sign in with another account</a></main>;
  }
  const accessLabel = officeUser.isAdmin ? "Admin" : "Office";
  return <FloorOpsApp initialView={view} environment={resolveAppEnvironment(process.env.FCI_APP_ENVIRONMENT)} jobSiteMaps={getSitesJobSiteMapsRuntimeConfig()} userName={user.displayName} userEmail={user.email} accessLabel={accessLabel} signOutHref={chatGPTSignOutPath(returnPath)} />;
}
