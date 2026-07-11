import { NextRequest, NextResponse } from "next/server";
import { buildProjectFolderPlan, DRIVE_BLUEPRINT } from "../../../lib/google-workspace";

export async function GET() {
  const requirements = [
    ["Google OAuth client ID", process.env.GOOGLE_CLIENT_ID],
    ["Google OAuth client secret", process.env.GOOGLE_CLIENT_SECRET],
    ["OAuth redirect URI", process.env.GOOGLE_OAUTH_REDIRECT_URI],
    ["token encryption key", process.env.GOOGLE_TOKEN_ENCRYPTION_KEY],
    ["Shared Drive ID", process.env.GOOGLE_SHARED_DRIVE_ID],
    ["Client Directory Sheet ID", process.env.GOOGLE_CLIENT_DIRECTORY_SHEET_ID],
    ["intake mailbox", process.env.GOOGLE_INTAKE_MAILBOX],
    ["Client Appointments calendar ID", process.env.GOOGLE_CLIENT_APPOINTMENTS_CALENDAR_ID],
    ["Field Schedule calendar ID", process.env.GOOGLE_FIELD_SCHEDULE_CALENDAR_ID],
  ] as const;
  const missing = requirements.filter(([, value]) => !value).map(([label]) => label);
  const credentialsPresent = missing.length === 0;
  return NextResponse.json({
    configured: credentialsPresent,
    credentialsPresent,
    connected: false,
    missing,
    blueprint: DRIVE_BLUEPRINT,
    requiredEnvironment: requirements.map(([label]) => label),
    nextStep: credentialsPresent ? "OAuth authorization still needs to be completed by the company owner." : "Add the missing hosted configuration values, then complete OAuth authorization.",
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { clientCode?: string; clientName?: string; projectNumber?: string; projectName?: string };
  if (!body.clientCode || !body.clientName || !body.projectNumber || !body.projectName) return NextResponse.json({ error: "client and project details are required" }, { status: 400 });
  return NextResponse.json({ plan: buildProjectFolderPlan(body) });
}
