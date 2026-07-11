import { NextRequest, NextResponse } from "next/server";
import { buildProjectFolderPlan, DRIVE_BLUEPRINT } from "../../../lib/google-workspace";

export async function GET() {
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_SHARED_DRIVE_ID);
  return NextResponse.json({ configured, blueprint: DRIVE_BLUEPRINT, requiredEnvironment: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_SHARED_DRIVE_ID", "GOOGLE_INTAKE_MAILBOX"] });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { clientCode?: string; clientName?: string; projectNumber?: string; projectName?: string };
  if (!body.clientCode || !body.clientName || !body.projectNumber || !body.projectName) return NextResponse.json({ error: "client and project details are required" }, { status: 400 });
  return NextResponse.json({ plan: buildProjectFolderPlan(body) });
}
