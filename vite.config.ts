import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// Rendered regression tests use synthetic, non-production identities. Opt in
// explicitly so normal local development and hosted builds never receive
// test-only authorization bindings.
const isE2eRuntime = process.env.FCI_E2E === "true";
if (isE2eRuntime) {
  // The Cloudflare Vite plugin loads Worker variables independently of Vite.
  // Disable its dotenv inference before the plugin is imported below.
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
}
const e2eRuntimeVars = isE2eRuntime
  ? {
      FCI_OFFICE_EMAILS: process.env.FCI_OFFICE_EMAILS ?? "",
      FCI_ADMIN_EMAILS: process.env.FCI_ADMIN_EMAILS ?? "",
      GOOGLE_INTEGRATION_MODE: "simulation",
    }
  : undefined;

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
  ...(e2eRuntimeVars ? { vars: e2eRuntimeVars } : {}),
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    // E2E identities must come only from Playwright's explicit environment.
    // A contributor's local overrides would otherwise make role tests untruthful.
    envFile: isE2eRuntime ? false : undefined,
    server: {
      watch: {
        // Generated builds, reports, and Playwright traces are not application
        // source and must not trigger HMR reload loops during rendered tests.
        ignored: ["**/work/**"],
        ...(isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : {}),
      },
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
