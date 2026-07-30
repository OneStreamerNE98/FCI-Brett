import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function sourceSection(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${label} start anchor`);
  assert.notEqual(endIndex, -1, `${label} end anchor`);
  return source.slice(startIndex, endIndex);
}

test("lead editor retains all 13 canonical fields, version, and changed-key conflict behavior", async () => {
  const app = await read("app/FloorOpsApp.tsx");
  const leadType = sourceSection(app, "type Lead = {", "type Client =", "Lead types");
  const leadModal = sourceSection(app, "function LeadModal", "function ClientModal", "LeadModal");
  const saveLead = sourceSection(app, "async function saveLeadEdits", "async function addClient", "saveLeadEdits");

  for (const field of [
    "company",
    "contactName",
    "contactEmail",
    "contactPhone",
    "projectName",
    "source",
    "stage",
    "site",
    "estimatedValue",
    "nextAction",
    "nextActionAt",
    "ownerEmail",
    "status",
  ]) {
    assert.match(leadType, new RegExp(`\\b${field}\\??:`), field);
    assert.match(leadModal, new RegExp(`patch\\.${field}\\s*=`), `${field} changed-key patch`);
    assert.match(leadModal, new RegExp(`savedValue\\("${field}"\\)`), `${field} saved-value annotation`);
  }
  assert.match(leadType, /version\?: string/u);
  assert.match(app, /mode: "edit";[\s\S]*initialValues: Lead;/u);
  assert.match(app, /version: normalizeRecordVersion\(record\.version\) \?\? undefined/u);
  assert.match(saveLead, /body: JSON\.stringify\(\{ \.\.\.patch, version \}\)/u);
  assert.match(saveLead, /throw new LeadEditConflictError/u);
  assert.match(leadModal, /conflictVersion \?\? props\.initialValues\.version/u);
  assert.match(leadModal, /Re-apply changes/u);
  assert.match(leadModal, /Saved value: \{displayValue\}/u);
  assert.match(leadModal, /props\.isAdmin && estimatedValue !== props\.initialValues\.estimatedValue/u);
  assert.match(leadModal, /editMode && !props\.isAdmin/u);
  assert.match(leadModal, /nextActionAtText !== dateTimeLocalInputValue\(props\.initialValues\.nextActionAt\)/u);
  assert.match(app, /void refreshDashboardSnapshot\(\)\.catch/u);
  assert.match(app, /fallbackFocusRef=\{workspaceSearchRef\}/u);
});

test("create mode and the dedicated advanceLead fast path retain their established contracts", async () => {
  const app = await read("app/FloorOpsApp.tsx");
  const addLead = sourceSection(app, "async function addLead", "async function saveLeadEdits", "addLead");
  const advanceLead = sourceSection(app, "async function advanceLead", "async function searchWorkspace", "advanceLead");
  const leadModal = sourceSection(app, "function LeadModal", "function ClientModal", "LeadModal");

  for (const field of [
    ["contactEmail", "lead.contactEmail"],
    ["contactPhone", "lead.contactPhone"],
    ["nextActionAt", "lead.nextActionAt"],
  ]) {
    assert.match(
      addLead,
      new RegExp(`${field[0]}: ${field[1].replace(".", "\\.")}`, "u"),
    );
  }
  assert.match(addLead, /lead\.ownerEmail \? \{ ownerEmail: lead\.ownerEmail \} : \{\}/u);
  assert.match(addLead, /status: "active"/u);
  assert.match(leadModal, /props\.mode === "create"/u);
  assert.match(leadModal, /const stage = [\s\S]*\|\| "New inquiry"/u);
  assert.match(leadModal, /status: "active"/u);
  assert.match(leadModal, /"Add to pipeline"/u);

  assert.match(advanceLead, /body: JSON\.stringify\(\{ stage: nextStage \}\)/u);
  assert.match(advanceLead, /body: JSON\.stringify\(\{ stage: currentLead\.stage \}\)/u);
  assert.doesNotMatch(advanceLead, /\bversion\b/u);
});

test("lead PATCH checks the admin-only field before reads and scopes authorized conflict values", async () => {
  const [route, collectionRoute, responseProjection] = await Promise.all([
    read("app/api/v1/leads/[leadId]/route.ts"),
    read("app/api/v1/leads/route.ts"),
    read("app/lib/authorized-lead-response.ts"),
  ]);
  assert.ok(
    route.indexOf('Object.hasOwn(normalized.value, "estimatedValue")')
      < route.indexOf("await ensureWorkspaceSchema()"),
    "estimated-value authorization must precede schema and record reads",
  );
  assert.ok(
    route.indexOf('Object.hasOwn(normalized.value, "ownerEmail")')
      < route.indexOf("await ensureWorkspaceSchema()"),
    "owner identity validation must precede schema and record reads",
  );
  assert.match(route, /LEAD_PATCH_KEYS\.flatMap/u);
  assert.match(route, /Object\.hasOwn\(patch\.value, key\)/u);
  assert.match(route, /const latest = await repository\.findById\(leadId\)/u);
  assert.match(route, /authorizedLeadOwnerEmail\(values\.ownerEmail, actorEmail\)/u);
  assert.match(route, /authorizedLeadResponse\(result\.value, auth\.user\.email\)/u);
  assert.match(responseProjection, /ownerEmail: authorizedOfficeEmail/u);
  assert.match(responseProjection, /createdBy: authorizedOfficeEmail/u);
  assert.doesNotMatch(responseProjection, /contactEmail: authorizedOfficeEmail/u);
  assert.match(collectionRoute, /result\.value\.map\(\(lead\) =>\s+authorizedLeadPayload\(lead, auth\.user\.email\)/u);
  assert.match(collectionRoute, /authorizedLeadPayload\(result\.value, auth\.user\.email\)/u);
  assert.match(collectionRoute, /authorizedLeadOwnerEmail\(parsed\.body\.ownerEmail, auth\.user\.email\)/u);
});

test("LeadModal create mode accepts prefill and the edit surface keeps all terminal statuses", async () => {
  const app = await read("app/FloorOpsApp.tsx");
  // AI-10 sub-PR (f)'s implement-once contract: create mode carries OPTIONAL
  // initialValues and the create-visible fields default from the shared seed, so
  // the email-derived lead proposal prefills THIS modal with no further rework
  // (review finding, PR #231 — prefill was previously welded to edit mode).
  assert.match(app, /mode: "create";[\s\S]{0,400}initialValues\?: Partial<Lead>;/u);
  assert.match(app, /const seed[\s\S]{0,120}props\.initialValues \?\? null/u);
  for (const field of [
    "company",
    "contact",
    "contactEmail",
    "contactPhone",
    "project",
    "site",
    "stage",
    "next",
    "ownerEmail",
  ]) {
    assert.match(app, new RegExp(`defaultValue=\\{seed\\?\\.${field}`, "u"));
  }
  assert.match(app, /defaultValue=\{dateTimeLocalInputValue\(seed\?\.nextActionAt/u);
  assert.match(app, /defaultValue=\{seed\?\.estimatedValue/u);
  // The archive-only decision's three terminal statuses stay reachable from the
  // only sanctioned UI path — a refactor dropping Lost/Archived must fail here
  // (review finding, PR #231: only "converted" was previously exercised).
  assert.match(app, /<option value="converted">Converted<\/option>/u);
  assert.match(app, /<option value="lost">Lost<\/option>/u);
  assert.match(app, /<option value="archived">Archived<\/option>/u);
});
