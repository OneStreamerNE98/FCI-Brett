import { chatGPTSignOutPath, requireChatGPTUser } from "../../chatgpt-auth";
import { officeIdentityForEmail } from "../../lib/workspace-auth";
import { AdminAccessPage } from "./AdminAccessPage";

export const dynamic = "force-dynamic";

const RETURN_PATH = "/management/access";

export default async function ManagementAccessRoute() {
  const user = await requireChatGPTUser(RETURN_PATH);
  const officeUser = officeIdentityForEmail(user.email);

  if (!officeUser?.isAdmin) {
    return <main className="access-denied">
      <p>Floor Coverings International Operations</p>
      <h1>Administrator access required</h1>
      <span>People &amp; Access is available only to an approved application Administrator.</span>
      <a href={officeUser ? "/" : chatGPTSignOutPath(RETURN_PATH)}>{officeUser ? "Back to operations" : "Sign in with another account"}</a>
    </main>;
  }

  // The accepted employee-session bootstrap will supply the raw CSRF value in
  // memory when this screen is composed on Cloud Run. The Sites development
  // shell deliberately has no credential bridge.
  return <AdminAccessPage csrfToken={null} />;
}
