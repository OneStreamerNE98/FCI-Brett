import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { requireOfficeUser } from "../../../../lib/workspace-auth";

type RuntimeEnvironment = Record<string, string | undefined>;

function runtimeValue(name: string) {
  return (env as unknown as RuntimeEnvironment)[name] ?? process.env[name];
}

function configuredIdentifiers(name: string) {
  return (runtimeValue(name) ?? "")
    .split(",")
    .map((identifier) => identifier.trim())
    .filter(Boolean);
}

function noStore(response: Response) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStore(auth.response);

  return NextResponse.json({
    officeEmails: configuredIdentifiers("FCI_OFFICE_EMAILS"),
    officeDomains: configuredIdentifiers("FCI_OFFICE_DOMAINS"),
    adminEmails: configuredIdentifiers("FCI_ADMIN_EMAILS"),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
