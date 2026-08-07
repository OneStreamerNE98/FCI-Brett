import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("AI-10 lead capture stays review-first and reuses the existing lead and review routes", async () => {
  const [app, inbox, classifier, analysisRoute] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/inbox/components/InboxView.tsx"),
    read("app/application/assistant/inbox-analysis.ts"),
    read("app/api/v1/inbox-analysis/route.ts"),
  ]);

  assert.match(
    app,
    /import \{ InboxView \} from "\.\/inbox\/components\/InboxView";/u,
  );
  assert.match(app, /function openInboxLead\(/u);
  assert.match(app, /onCreateLead=\{openInboxLead\}/u);
  assert.match(app, /fetch\("\/api\/v1\/leads", \{ method: "POST"/u);
  assert.match(app, /if \(afterCreate\) await afterCreate\(\);/u);

  assert.match(inbox, />\s*Create lead\s*<\/button>/u);
  assert.match(inbox, /markReviewed\(row, "lead-created"\)/u);
  assert.match(
    inbox,
    /Lead created, but this message is still in review\./u,
  );
  const leadWriter = /\/api\/v1\/leads|lead\.created|createLead|(?:lead[-/]repository|LeadRepository)/u;
  assert.doesNotMatch(classifier, leadWriter);
  assert.doesNotMatch(analysisRoute, leadWriter);
});

test("ordinary Add lead exposes optional contact details while keeping its established defaults", async () => {
  const [app, leadModal] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/leads/components/LeadModal.tsx"),
  ]);

  assert.match(app, /onAdd=\{\(\) => setLeadModal\(\{\}\)\}/u);
  assert.match(
    leadModal,
    /const inboxPrefill = props\.mode === "create" && props\.initialValues !== undefined;/u,
  );
  assert.match(
    leadModal,
    /<label>Contact email <span className="optional-label">Optional<\/span><input name="contactEmail"[\s\S]+?<label>Contact phone <span className="optional-label">Optional<\/span><input name="contactPhone"/u,
    "DES-16 makes phone and email available on every create path",
  );
  assert.equal(
    leadModal.match(/\{\(editMode \|\| inboxPrefill\) && <div className="form-row">/gu)?.length,
    2,
    "only stage/status and next-action/owner remain conditional review rows",
  );
  assert.match(leadModal, /seed\?\.source \?\? "Website"/u);
  assert.match(leadModal, /seed\?\.stage \?\? "New inquiry"/u);
  assert.match(leadModal, /String\(form\.get\("status"\) \?\? "active"\)/u);
  assert.match(
    app,
    /JSON\.stringify\(\{ company: lead\.company, contactName: lead\.contact, projectName: lead\.project, source: lead\.source, stage: lead\.stage, site: lead\.site, estimatedValue: lead\.estimatedValue, nextAction: lead\.next, status: "active",/u,
  );
  assert.match(leadModal, /ownerEmail: ownerEmail \|\| null/u);
  assert.match(app, /contactEmail: lead\.contactEmail/u);
  assert.match(app, /contactPhone: lead\.contactPhone/u);
  assert.match(app, /nextActionAt: lead\.nextActionAt/u);
});

test("a row that produced a lead can never offer to produce another", async () => {
  // Review P1, found independently by three lenses. The Create lead button was
  // gated on leadRetirementErrorIds — a BANNER flag that markReviewed clears at
  // the start of every attempt and only restores on the lead-created path. So
  // the retry the banner itself instructs ("Use Mark reviewed to retire it")
  // arrives as reason "manual", and when it also fails the guard is gone: the
  // button returns on a row whose lead already exists, and a second click posts
  // a duplicate lead plus a duplicate lead.created Chat notification. "The
  // review store is unavailable" is precisely the failure that persists across
  // attempts, so two failures in a row is the likely case, not a rare one.
  const inbox = await read("app/inbox/components/InboxView.tsx");

  assert.match(
    inbox,
    /\{row\.leadProposal && !leadCreatedRowIds\.has\(row\.id\) && <button/u,
    "the Create lead button must be gated on the append-only lead-created set",
  );
  assert.doesNotMatch(
    inbox,
    /row\.leadProposal && !leadRetirementErrorIds\.has\(row\.id\)/u,
    "it must not be gated on the retirement-error banner flag, which is cleared on retry",
  );

  // The set is append-only: nothing may delete from it or reset it, or the
  // guard becomes another compensating action that a later failure can undo.
  const leadCreatedWrites = inbox.match(/setLeadCreatedRowIds\([\s\S]{0,200}?\)/gu) ?? [];
  assert.ok(leadCreatedWrites.length > 0, "the set must actually be written");
  for (const write of leadCreatedWrites) {
    assert.doesNotMatch(write, /\.delete\(/u, "lead-created must never be cleared");
    assert.doesNotMatch(write, /new Set<string>\(\)|new Set\(\)/u, "lead-created must never be reset");
  }

  // And it is recorded BEFORE retirement is attempted, so a retire that never
  // returns still leaves the button suppressed.
  const created = inbox.indexOf("setLeadCreatedRowIds((current) =>");
  const retire = inbox.indexOf('await markReviewed(row, "lead-created")');
  assert.ok(created >= 0 && retire > created, "the lead must be recorded before retirement is attempted");
});
