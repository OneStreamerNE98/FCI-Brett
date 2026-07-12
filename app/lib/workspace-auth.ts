import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";

export type OfficeUser = {
  email: string;
  isAdmin: boolean;
};

type AuthResult = { user: OfficeUser } | { response: NextResponse };
type RuntimeEnvironment = Record<string, string | undefined>;

function runtimeValue(name: string) {
  return (env as unknown as RuntimeEnvironment)[name] ?? process.env[name];
}

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
  const allowedEmails = emailList(runtimeValue("FCI_OFFICE_EMAILS"));
  const allowedDomains = domainList(runtimeValue("FCI_OFFICE_DOMAINS"));
  if (allowedEmails.length === 0 && allowedDomains.length === 0) return false;
  const domain = email.split("@")[1] ?? "";
  return allowedEmails.includes(email) || allowedDomains.includes(domain);
}

function isConfiguredAdmin(email: string) {
  return emailList(runtimeValue("FCI_ADMIN_EMAILS")).includes(email);
}

function localDevelopmentEmail(request: NextRequest) {
  // Require both a development build and a loopback request. This cannot grant
  // access to the hosted site even if someone accidentally supplies the variable.
  if (process.env.NODE_ENV !== "development") return null;
  const hostname = request.nextUrl.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1" && hostname !== "[::1]") return null;
  return runtimeValue("FCI_LOCAL_DEV_USER_EMAIL")?.trim().toLowerCase() || null;
}

export function requireOfficeUser(request: NextRequest, options: { admin?: boolean } = {}): AuthResult {
  const developmentEmail = localDevelopmentEmail(request);
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? developmentEmail;
  if (!email) {
    return { response: NextResponse.json({ error: "Sign in with ChatGPT to use this workspace." }, { status: 401 }) };
  }
  if (email !== developmentEmail && !isAllowedOfficeEmail(email)) {
    const configured = Boolean(runtimeValue("FCI_OFFICE_EMAILS") || runtimeValue("FCI_OFFICE_DOMAINS"));
    const error = configured
      ? "Your account is not allowed to access this workspace."
      : "Office access is not configured. Set FCI_OFFICE_EMAILS or FCI_OFFICE_DOMAINS before using the hosted app.";
    return { response: NextResponse.json({ error }, { status: 403 }) };
  }
  const isAdmin = isConfiguredAdmin(email);
  if (options.admin && !isAdmin) {
    const message = runtimeValue("FCI_ADMIN_EMAILS") ? "An FCI administrator must complete this action." : "Set FCI_ADMIN_EMAILS before enabling Google Workspace administration.";
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
