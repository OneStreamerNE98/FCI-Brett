import { NextRequest, NextResponse } from "next/server";

export type OfficeUser = {
  email: string;
  isAdmin: boolean;
};

type AuthResult = { user: OfficeUser } | { response: NextResponse };

function emailList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function domainList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((domain) => domain.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

function isAllowedOfficeEmail(email: string) {
  const allowedEmails = emailList(process.env.FCI_OFFICE_EMAILS);
  const allowedDomains = domainList(process.env.FCI_OFFICE_DOMAINS);
  if (allowedEmails.length === 0 && allowedDomains.length === 0) return true;
  const domain = email.split("@")[1] ?? "";
  return allowedEmails.includes(email) || allowedDomains.includes(domain);
}

function isConfiguredAdmin(email: string) {
  return emailList(process.env.FCI_ADMIN_EMAILS).includes(email);
}

function localDevelopmentEmail(request: NextRequest) {
  // Require both a development build and a loopback request. This cannot grant
  // access to the hosted site even if someone accidentally supplies the variable.
  if (process.env.NODE_ENV !== "development") return null;
  const hostname = request.nextUrl.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1" && hostname !== "[::1]") return null;
  return process.env.FCI_LOCAL_DEV_USER_EMAIL?.trim().toLowerCase() || null;
}

export function requireOfficeUser(request: NextRequest, options: { admin?: boolean } = {}): AuthResult {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? localDevelopmentEmail(request);
  if (!email) {
    return { response: NextResponse.json({ error: "Sign in with ChatGPT to use this workspace." }, { status: 401 }) };
  }
  if (!isAllowedOfficeEmail(email)) {
    return { response: NextResponse.json({ error: "Your account is not allowed to access this workspace." }, { status: 403 }) };
  }
  const isAdmin = isConfiguredAdmin(email);
  if (options.admin && !isAdmin) {
    const message = process.env.FCI_ADMIN_EMAILS ? "An FCI administrator must complete this action." : "Set FCI_ADMIN_EMAILS before enabling Google Workspace administration.";
    return { response: NextResponse.json({ error: message }, { status: 403 }) };
  }
  return { user: { email, isAdmin } };
}

export function requireSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return NextResponse.json({ error: "A same-origin browser request is required." }, { status: 403 });
  const requestOrigin = new URL(request.url).origin;
  if (origin === requestOrigin) return null;
  return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
}
