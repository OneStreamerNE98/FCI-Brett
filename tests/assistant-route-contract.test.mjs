import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";
import {
  DEVELOPMENT_RATE_LIMIT_MAX_REQUESTS,
} from "../app/lib/development-request-rate-limit.ts";

const TEST_EMAIL = "admincrm@cherryhillfci.com";
const originalNodeEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = "test";

class Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.database.resolve("first", this.sql, this.values);
  }

  async all() {
    return {
      results: await this.database.resolve("all", this.sql, this.values) ?? [],
    };
  }
}

const database = {
  prepared: [],
  resolver: () => null,
  prepare(sql) {
    this.prepared.push(sql);
    return new Statement(this, sql);
  },
  resolve(kind, sql, values) {
    return this.resolver(kind, sql, values);
  },
  batch() {
    throw new Error("Assistant requests are read-only.");
  },
};

const cloudflareEnvironment = {
  FCI_OFFICE_EMAILS: TEST_EMAIL,
  FCI_ADMIN_EMAILS: TEST_EMAIL,
  FCI_GOOGLE_CONNECTION_KEY: "workspace",
  DB: database,
};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = cloudflareEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-assistant-route", import.meta.url)),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("fixtures/cloudflare-workers.mjs", import.meta.url),
      ),
    },
  },
  server: { middlewareMode: true, hmr: false },
});
const assistantRoute = await vite.ssrLoadModule("/app/api/v1/assistant/route.ts");

after(async () => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function request(body, options = {}) {
  const headers = {
    "content-type": "application/json",
    origin: options.origin ?? "https://fci.example.test",
  };
  if (options.email !== null) {
    headers["oai-authenticated-user-email"] = options.email ?? TEST_EMAIL;
  }
  return new Request("https://fci.example.test/api/v1/assistant", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

async function withAllowedOfficeEmail(email, operation) {
  const previous = cloudflareEnvironment.FCI_OFFICE_EMAILS;
  cloudflareEnvironment.FCI_OFFICE_EMAILS = `${previous},${email}`;
  try {
    return await operation();
  } finally {
    cloudflareEnvironment.FCI_OFFICE_EMAILS = previous;
  }
}

async function withinOneSecond(promise, message) {
  let watchdog;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error(message)), 1_000);
      }),
    ]);
  } finally {
    clearTimeout(watchdog);
  }
}

test("origin and identity denials are no-store without database work", async () => {
  for (const [name, options, expectedStatus] of [
    ["cross-origin", { origin: "https://attacker.example.test" }, 403],
    ["unauthenticated", { email: null }, 401],
    ["outside allowlist", { email: "outsider@example.test" }, 403],
  ]) {
    database.prepared = [];
    database.resolver = () => {
      throw new Error(`${name} must fail before database work.`);
    };
    const response = await assistantRoute.POST(request(
      { question: "find Atlas" },
      options,
    ));
    assert.equal(response.status, expectedStatus, name);
    assert.equal(response.headers.get("Cache-Control"), "no-store", name);
    assert.equal(database.prepared.length, 0, name);
  }
});

test("oversized questions return the route-level 413 contract before database work", async () => {
  await withAllowedOfficeEmail("assistant-oversize@example.test", async () => {
    database.prepared = [];
    database.resolver = () => {
      throw new Error("Oversized questions must fail before database work.");
    };
    const response = await assistantRoute.POST(request(
      { question: "x".repeat(2_001) },
      { email: "assistant-oversize@example.test" },
    ));
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "question is too long or contains invalid characters",
    });
    assert.equal(database.prepared.length, 0);
  });
});

test("assistant requests expose the shared route-level 429 contract", async () => {
  await withAllowedOfficeEmail("assistant-rate-limit@example.test", async () => {
    database.prepared = [];
    database.resolver = () => {
      throw new Error("Rate-limit fixtures must fail before database work.");
    };
    for (
      let attempt = 0;
      attempt < DEVELOPMENT_RATE_LIMIT_MAX_REQUESTS;
      attempt += 1
    ) {
      const allowed = await assistantRoute.POST(request(
        {},
        { email: "assistant-rate-limit@example.test" },
      ));
      assert.equal(allowed.status, 400);
    }
    const denied = await assistantRoute.POST(request(
      {},
      { email: "assistant-rate-limit@example.test" },
    ));
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get("Cache-Control"), "no-store");
    assert.match(denied.headers.get("Retry-After"), /^(?:[1-9]|[1-5]\d|60)$/);
    assert.deepEqual(await denied.json(), {
      error: "Too many requests. Try again shortly.",
      code: "rate_limited",
    });
    assert.equal(database.prepared.length, 0);
  });
});

test("only an omitted projectId enters org-wide mode", async () => {
  database.prepared = [];
  database.resolver = (kind, sql) => {
    if (
      kind === "all"
      && sql.startsWith("SELECT id, client_code, name FROM clients")
    ) {
      return [{ id: "client-atlas", client_code: "ATLAS", name: "Atlas" }];
    }
    return [];
  };
  const response = await assistantRoute.POST(request({ question: "find Atlas" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    mode: "records-only",
    answer: "The saved records search found 1 likely match for “find Atlas”: Atlas.",
    citations: [{
      id: "client:client-atlas",
      label: "Client · Atlas",
      detail: "ATLAS",
    }],
    missingEvidence: "Organization-wide answers are unavailable because the OpenAI API key is missing. This records-only fallback reports bounded exact record matches; it does not infer an answer or search full email bodies and Drive document contents.",
  });
  assert.equal(database.prepared.length, 4);
});

test("a configured provider honors a saved disabled org-wide setting without calling it", async () => {
  const originalFetch = globalThis.fetch;
  const previousApiKey = cloudflareEnvironment.OPENAI_API_KEY;
  cloudflareEnvironment.OPENAI_API_KEY = "disabled-org-qa-key";
  database.prepared = [];
  database.resolver = (kind, sql) => {
    if (
      kind === "first"
      && sql.startsWith("SELECT id, shared_drive_id")
    ) {
      return {
        id: "workspace",
        settings_json: JSON.stringify({
          aiFeatures: {
            orgQa: false,
            triage: true,
            replyDrafts: true,
            taskExtraction: true,
          },
        }),
        updated_by: TEST_EMAIL,
        updated_at: 1,
      };
    }
    if (
      kind === "all"
      && sql.startsWith("SELECT id, client_code, name FROM clients")
    ) {
      return [{ id: "client-atlas", client_code: "ATLAS", name: "Atlas" }];
    }
    return [];
  };
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("Disabled organization-wide answers must not call OpenAI.");
  };
  try {
    const response = await assistantRoute.POST(request({ question: "find Atlas" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      mode: "records-only",
      answer: "The saved records search found 1 likely match for “find Atlas”: Atlas.",
      citations: [{
        id: "client:client-atlas",
        label: "Client · Atlas",
        detail: "ATLAS",
      }],
      missingEvidence: "Organization-wide answers are turned off in AI settings. This records-only fallback reports bounded exact record matches; it does not infer an answer or search full email bodies and Drive document contents.",
    });
    assert.equal(providerCalls, 0);
    assert.equal(
      database.prepared.filter((sql) => sql.includes("FROM workspace_settings")).length,
      1,
    );
  } finally {
    if (previousApiKey === undefined) delete cloudflareEnvironment.OPENAI_API_KEY;
    else cloudflareEnvironment.OPENAI_API_KEY = previousApiKey;
    globalThis.fetch = originalFetch;
  }
});

test("a configured provider defaults org-wide answers on when aiFeatures is absent", async () => {
  const originalFetch = globalThis.fetch;
  const previousApiKey = cloudflareEnvironment.OPENAI_API_KEY;
  cloudflareEnvironment.OPENAI_API_KEY = "default-on-org-qa-key";
  database.prepared = [];
  database.resolver = (kind, sql) => {
    if (
      kind === "first"
      && sql.startsWith("SELECT id, shared_drive_id")
    ) {
      return {
        id: "workspace",
        settings_json: JSON.stringify({ futureSetting: "preserved" }),
        updated_by: TEST_EMAIL,
        updated_at: 1,
      };
    }
    return [];
  };
  let providerCalls = 0;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    providerCalls += 1;
    return Response.json({
      output: [{
        content: [{
          type: "output_text",
          text: JSON.stringify({
            answer: "No saved evidence was found.",
            citationIds: [],
            missingEvidence: "No matching saved records were found.",
          }),
        }],
      }],
    });
  };
  try {
    const response = await assistantRoute.POST(request({
      question: "find a saved record",
    }));
    assert.equal(response.status, 200);
    assert.equal(providerCalls, 1);
  } finally {
    if (previousApiKey === undefined) delete cloudflareEnvironment.OPENAI_API_KEY;
    else cloudflareEnvironment.OPENAI_API_KEY = previousApiKey;
    globalThis.fetch = originalFetch;
  }
});

test("request abort reaches the live provider call and returns a safe fallback", async () => {
  await withAllowedOfficeEmail("assistant-abort@example.test", async () => {
    const originalFetch = globalThis.fetch;
    const previousApiKey = cloudflareEnvironment.OPENAI_API_KEY;
    cloudflareEnvironment.OPENAI_API_KEY = "abort-fixture-key";
    database.prepared = [];
    database.resolver = () => [];
    let observedProviderAbortReason;
    let markProviderStarted;
    const providerStarted = new Promise((resolve) => {
      markProviderStarted = resolve;
    });
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      markProviderStarted();
      return new Promise((_resolve, reject) => {
        const watchdog = setTimeout(
          () => reject(new Error("Provider abort watchdog expired.")),
          1_000,
        );
        const rejectForAbort = () => {
          clearTimeout(watchdog);
          observedProviderAbortReason = init.signal.reason;
          reject(init.signal.reason ?? new DOMException("Aborted", "AbortError"));
        };
        if (init.signal.aborted) rejectForAbort();
        else init.signal.addEventListener("abort", rejectForAbort, { once: true });
      });
    };
    const controller = new AbortController();
    const callerReason = new DOMException("Caller stopped", "AbortError");
    try {
      const pendingResponse = assistantRoute.POST(request(
        { question: "find Atlas" },
        {
          email: "assistant-abort@example.test",
          signal: controller.signal,
        },
      ));
      await withinOneSecond(
        providerStarted,
        "Provider did not start within one second.",
      );
      controller.abort(callerReason);
      const response = await withinOneSecond(
        pendingResponse,
        "Provider abort did not settle within one second.",
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal((await response.json()).mode, "records-only");
      assert.strictEqual(observedProviderAbortReason, callerReason);
    } finally {
      if (previousApiKey === undefined) delete cloudflareEnvironment.OPENAI_API_KEY;
      else cloudflareEnvironment.OPENAI_API_KEY = previousApiKey;
      globalThis.fetch = originalFetch;
    }
  });
});

for (const [name, projectId] of [
  ["empty", ""],
  ["non-string", null],
  ["malformed", "../all"],
]) {
  test(`present ${name} projectId keeps the exact project-scope 400`, async () => {
    database.prepared = [];
    database.resolver = () => {
      throw new Error("Invalid project scope must fail before database work.");
    };
    const response = await assistantRoute.POST(request({
      question: "find Atlas",
      projectId,
    }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "Choose one project before asking the assistant.",
    });
    assert.equal(database.prepared.length, 0);
  });
}

test("project not-found is a no-store route-owned response", async () => {
  database.prepared = [];
  database.resolver = () => null;
  const response = await assistantRoute.POST(request({
    question: "What is the status?",
    projectId: "missing-project",
  }));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "Project not found." });
});

test("valid projectId retains the legacy deterministic fallback payload", async () => {
  const previousApiKey = cloudflareEnvironment.OPENAI_API_KEY;
  delete cloudflareEnvironment.OPENAI_API_KEY;
  database.prepared = [];
  database.resolver = (kind, sql) => {
    if (kind === "first" && sql.startsWith("SELECT p.id, p.project_number")) {
      return {
        id: "project-1",
        project_number: "P-100",
        name: "Lobby",
        status: "planning",
        site: "100 Main Street",
        project_manager: "Alex",
        estimated_value: 100000,
        client_id: "client-1",
        client_name: "Atlas",
        client_code: "ATLAS",
      };
    }
    if (kind === "first" && sql.startsWith("SELECT COUNT(*) AS total")) {
      return { total: 0 };
    }
    if (kind === "all") return [];
    return null;
  };
  const response = await assistantRoute.POST(request({
    question: "What is the current status?",
    projectId: "project-1",
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    mode: "records-only",
    answer: "P-100 — Lobby is currently planning. The recorded site is 100 Main Street. The project manager is Alex.",
    citations: [{
      id: "project:project-1",
      label: "Project record · P-100",
      detail: "Lobby · Atlas · planning · 100 Main Street · Project manager: Alex · Estimated value: $100,000",
    }],
    missingEvidence: "Phase history, dated shifts, and completion progress are not available in the current project record.",
  });
  if (previousApiKey !== undefined) {
    cloudflareEnvironment.OPENAI_API_KEY = previousApiKey;
  }
});

test("a valid projectId never consults org-wide settings even when orgQa is disabled", async () => {
  const previousApiKey = cloudflareEnvironment.OPENAI_API_KEY;
  delete cloudflareEnvironment.OPENAI_API_KEY;
  database.prepared = [];
  database.resolver = (kind, sql) => {
    if (sql.includes("workspace_settings")) {
      throw new Error("Project-scoped questions must not read org-wide settings.");
    }
    if (kind === "first" && sql.startsWith("SELECT p.id, p.project_number")) {
      return {
        id: "project-1",
        project_number: "P-100",
        name: "Lobby",
        status: "planning",
        site: "100 Main Street",
        project_manager: "Alex",
        estimated_value: 100000,
        client_id: "client-1",
        client_name: "Atlas",
        client_code: "ATLAS",
      };
    }
    if (kind === "first" && sql.startsWith("SELECT COUNT(*) AS total")) {
      return { total: 0 };
    }
    if (kind === "all") return [];
    return null;
  };
  try {
    const response = await assistantRoute.POST(request({
      question: "What is the current status?",
      projectId: "project-1",
    }));
    assert.deepEqual(await response.json(), {
      mode: "records-only",
      answer: "P-100 — Lobby is currently planning. The recorded site is 100 Main Street. The project manager is Alex.",
      citations: [{
        id: "project:project-1",
        label: "Project record · P-100",
        detail: "Lobby · Atlas · planning · 100 Main Street · Project manager: Alex · Estimated value: $100,000",
      }],
      missingEvidence: "Phase history, dated shifts, and completion progress are not available in the current project record.",
    });
    assert.equal(
      database.prepared.some((sql) => sql.includes("workspace_settings")),
      false,
    );
  } finally {
    if (previousApiKey !== undefined) {
      cloudflareEnvironment.OPENAI_API_KEY = previousApiKey;
    }
  }
});

test("the configured OpenAI secret is sent only as authorization and never returned", async () => {
  const sentinel = "sk-secret-leak-sentinel";
  const originalFetch = globalThis.fetch;
  const previousModel = cloudflareEnvironment.OPENAI_MODEL;
  cloudflareEnvironment.OPENAI_API_KEY = sentinel;
  cloudflareEnvironment.OPENAI_MODEL = "  gpt-shared-config-model  ";
  database.prepared = [];
  database.resolver = () => [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(init.headers.Authorization, `Bearer ${sentinel}`);
    assert.doesNotMatch(String(init.body), new RegExp(sentinel));
    assert.equal(JSON.parse(init.body).model, "gpt-shared-config-model");
    return Response.json({
      output: [{
        content: [{
          type: "output_text",
          text: JSON.stringify({
            answer: "Forged",
            citationIds: ["forged:secret"],
            missingEvidence: "None",
          }),
        }],
      }],
    });
  };
  try {
    const response = await assistantRoute.POST(request({
      question: "find a saved record",
    }));
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), new RegExp(sentinel));
  } finally {
    delete cloudflareEnvironment.OPENAI_API_KEY;
    if (previousModel === undefined) delete cloudflareEnvironment.OPENAI_MODEL;
    else cloudflareEnvironment.OPENAI_MODEL = previousModel;
    globalThis.fetch = originalFetch;
  }
});
