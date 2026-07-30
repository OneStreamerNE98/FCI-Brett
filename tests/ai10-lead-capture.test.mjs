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

test("ordinary Add lead keeps its established defaults while create mode exposes optional review fields", async () => {
  const app = await read("app/FloorOpsApp.tsx");

  assert.match(app, /onAdd=\{\(\) => setLeadModal\(\{\}\)\}/u);
  assert.match(
    app,
    /const inboxPrefill = props\.mode === "create" && props\.initialValues !== undefined;/u,
  );
  assert.equal(
    app.match(/\{\(editMode \|\| inboxPrefill\) && <div className="form-row">/gu)?.length,
    3,
    "the optional review rows stay hidden on the ordinary create path",
  );
  assert.match(app, /seed\?\.source \?\? "Website"/u);
  assert.match(app, /seed\?\.stage \?\? "New inquiry"/u);
  assert.match(app, /String\(form\.get\("status"\) \?\? "active"\)/u);
  assert.match(
    app,
    /JSON\.stringify\(\{ company: lead\.company, contactName: lead\.contact, projectName: lead\.project, source: lead\.source, stage: lead\.stage, site: lead\.site, estimatedValue: lead\.estimatedValue, nextAction: lead\.next, status: "active",/u,
  );
  assert.match(app, /ownerEmail: ownerEmail \|\| null/u);
  assert.match(app, /contactEmail: lead\.contactEmail/u);
  assert.match(app, /contactPhone: lead\.contactPhone/u);
  assert.match(app, /nextActionAt: lead\.nextActionAt/u);
});
