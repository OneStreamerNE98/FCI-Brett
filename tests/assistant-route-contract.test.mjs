import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

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
  });
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
    missingEvidence: "This records-only fallback reports bounded exact record matches; it does not infer an answer or search full email bodies and Drive document contents.",
  });
  assert.equal(database.prepared.length, 3);
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
});

test("the configured OpenAI secret is sent only as authorization and never returned", async () => {
  const sentinel = "sk-secret-leak-sentinel";
  const originalFetch = globalThis.fetch;
  cloudflareEnvironment.OPENAI_API_KEY = sentinel;
  database.prepared = [];
  database.resolver = () => [];
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${sentinel}`);
    assert.doesNotMatch(String(init.body), new RegExp(sentinel));
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
    globalThis.fetch = originalFetch;
  }
});
