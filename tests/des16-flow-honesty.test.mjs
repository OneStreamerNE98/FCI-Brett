import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
});

const [leadApplication, leadDomain, authorizationModule, capabilitiesModule] = await Promise.all([
  vite.ssrLoadModule("/app/application/lead-operations.ts"),
  vite.ssrLoadModule("/app/domain/lead.ts"),
  vite.ssrLoadModule("/app/application/creation-authorization.ts"),
  vite.ssrLoadModule("/app/application/authorization-capabilities.ts"),
]);

after(async () => {
  await vite.close();
});

const { createLead } = leadApplication;
const { validateLeadValues, validateLeadValuesWithIssue } = leadDomain;
const { creationAuthorizationFor } = authorizationModule;
const { AUTHORIZATION_CAPABILITIES } = capabilitiesModule;

const validLead = {
  company: "FCI TEST — DO NOT USE — DES-16",
  contactName: "Test Contact",
  contactEmail: "CONTACT@EXAMPLE.TEST",
  contactPhone: "555-0116",
  projectName: "DES-16 phone lead",
  source: "Referral",
  stage: "New inquiry",
  site: "16 Test Avenue, Cherry Hill, NJ",
  estimatedValue: 16_000,
  nextAction: "Call the prospective client",
  nextActionAt: null,
  ownerEmail: "OWNER@EXAMPLE.TEST",
  status: "active",
};

const invalidFields = [
  ["company", "", "Enter a client company name with 180 characters or fewer."],
  ["contactName", "", "Enter a primary contact name with 160 characters or fewer."],
  ["contactEmail", "not-an-email", "Enter a valid contact email address or leave it blank."],
  ["contactPhone", "1".repeat(41), "Enter a contact phone number with 40 characters or fewer, or leave it blank."],
  ["projectName", "", "Enter a project or opportunity name with 180 characters or fewer."],
  ["source", "", "Enter a lead source with 80 characters or fewer."],
  ["stage", "", "Enter a lead stage with 80 characters or fewer."],
  ["site", "", "Enter a project site address with 280 characters or fewer."],
  ["estimatedValue", 1.5, "Enter an estimated value as a whole number from 0 to 2,147,483,647."],
  ["nextAction", "", "Enter the next action with 500 characters or fewer."],
  ["nextActionAt", "not-a-date", "Enter a valid next action date and time or leave it blank."],
  ["ownerEmail", "not-an-email", "Enter a valid lead owner email address."],
  ["status", "invented", "Choose a valid lead status."],
];

test("DES-16 lead creation names the invalid field instead of returning one combined message", async () => {
  const authorization = creationAuthorizationFor({
    actorId: "owner@example.test",
    capabilities: [AUTHORIZATION_CAPABILITIES.leadsCreate],
  });
  let repositoryWrites = 0;
  const dependencies = {
    repository: {
      list: async () => [],
      create: async () => {
        repositoryWrites += 1;
        throw new Error("Invalid input reached the repository.");
      },
    },
    newId: () => "00000000-0000-4000-8000-000000000016",
    now: () => Date.UTC(2026, 7, 4),
  };

  for (const [field, value, message] of invalidFields) {
    const result = await createLead({ ...validLead, [field]: value }, authorization, dependencies);
    assert.deepEqual(result, { ok: false, kind: "invalid", message }, `${field} must have its own message`);
  }
  assert.equal(repositoryWrites, 0);
});

test("DES-16 detailed lead validation preserves the normalized compatibility result", () => {
  const detailed = validateLeadValuesWithIssue(validLead);
  assert.equal(detailed.ok, true);
  assert.equal(detailed.value.contactEmail, "contact@example.test");
  assert.equal(detailed.value.ownerEmail, "owner@example.test");
  assert.deepEqual(validateLeadValues(validLead), detailed.value);
});
