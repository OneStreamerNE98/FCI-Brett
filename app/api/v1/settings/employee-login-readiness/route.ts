import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { requireOfficeUser } from "../../../../lib/workspace-auth";

type RuntimeEnvironment = Record<string, string | undefined>;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

const EMPLOYEE_LOGIN_REQUIREMENTS = [
  {
    name: "FCI_EMPLOYEE_OIDC_CLIENT_ID",
    configured: (environment: RuntimeEnvironment) =>
      Boolean(environment.FCI_EMPLOYEE_OIDC_CLIENT_ID?.trim()),
  },
  {
    name: "FCI_EMPLOYEE_OIDC_CLIENT_SECRET or FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE",
    configured: (environment: RuntimeEnvironment) =>
      Boolean(
        environment.FCI_EMPLOYEE_OIDC_CLIENT_SECRET?.trim()
        || environment.FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE?.trim(),
      ),
  },
  {
    name: "FCI_EMPLOYEE_OIDC_REDIRECT_URI",
    configured: (environment: RuntimeEnvironment) =>
      Boolean(environment.FCI_EMPLOYEE_OIDC_REDIRECT_URI?.trim()),
  },
  {
    name: "FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN",
    configured: (environment: RuntimeEnvironment) =>
      Boolean(environment.FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN?.trim()),
  },
] as const;

function runtimeEnvironment() {
  const workerEnvironment = env as unknown as RuntimeEnvironment;
  return new Proxy({} as RuntimeEnvironment, {
    get: (_target, property) => {
      if (typeof property !== "string") return undefined;
      return workerEnvironment[property] ?? process.env[property];
    },
  });
}

function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return withNoStore(auth.response);

  const environment = runtimeEnvironment();
  const requirements = EMPLOYEE_LOGIN_REQUIREMENTS.map((requirement) => ({
    name: requirement.name,
    configured: requirement.configured(environment),
  }));
  const configuredCount = requirements.filter((requirement) => requirement.configured).length;
  const state = configuredCount === 0
    ? "unconfigured"
    : configuredCount === requirements.length
      ? "ready"
      : "partial";

  return NextResponse.json({
    employeeLogin: {
      configuration: {
        state,
        configuredCount,
        totalCount: requirements.length,
        requirements,
      },
      // There is intentionally no activation environment flag. Live employee login
      // remains an explicit owner gate until production composition is approved.
      activationGate: {
        state: "owner-approval-required",
        active: false,
      },
    },
  }, { headers: NO_STORE_HEADERS });
}
