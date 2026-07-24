import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

function read(path) {
  return readFileSync(`${root}${path}`, "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const badTerms = String.raw`(?:draft|in review|in progress|awaiting (?:review|merge)|not merged|review and merge)`;

function assertMergedStatusHasNoReviewTerms(packetId, status) {
  assert.doesNotMatch(
    status,
    new RegExp(badTerms, "i"),
    `${packetId} regressed to a review-only status`,
  );
}

function assertNoStaleMergedPrReferences(path, markdown, mergedPrs) {
  const badTermPattern = new RegExp(badTerms, "i");
  const lines = markdown.split(/\r?\n/);

  for (const [lineIndex, line] of lines.entries()) {
    const hasBadReviewTerm = badTermPattern.test(line);

    for (const pr of mergedPrs) {
      const mergedReference = new RegExp(`(?:\\bPR\\s*)?#${pr}\\b`, "i");
      if (hasBadReviewTerm) {
        assert.doesNotMatch(
          line,
          mergedReference,
          `${path}:${lineIndex + 1} still assigns merged PR #${pr} for review`,
        );
      }

      const staleOpenState = String.raw`(?:remains?|is|stays?)\s+(?:still\s+)?(?:open|unmerged)|still\s+(?:open|unmerged)`;
      const boundedReference = String.raw`(?:\bPR\s*)?#${pr}\b`;
      const staleOpenReference = new RegExp(
        `(?:${boundedReference}[^.;|\\n]{0,120}\\b(?:${staleOpenState})\\b|\\b(?:${staleOpenState})\\b[^.;|\\n]{0,120}${boundedReference})`,
        "i",
      );
      assert.doesNotMatch(
        line,
        staleOpenReference,
        `${path}:${lineIndex + 1} still marks merged PR #${pr} open or unmerged`,
      );
    }
  }
}

function section(markdown, heading, nextHeading) {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `Missing section: ${heading}`);
  const end = markdown.indexOf(nextHeading, start + heading.length);
  assert.notEqual(end, -1, `Missing section boundary: ${nextHeading}`);
  return markdown.slice(start, end);
}

function packetSection(markdown, packetId) {
  const heading = new RegExp(`^#{2,3} ${escapeRegex(packetId)} · .+$`, "m").exec(markdown);
  assert.ok(heading, `Missing or malformed ${packetId} plan heading`);
  const start = heading.index;
  const tail = markdown.slice(start + heading[0].length);
  const nextHeading = tail.search(/^#{2,3} /m);
  return markdown.slice(start, nextHeading === -1 ? markdown.length : start + heading[0].length + nextHeading);
}

function packetStatus(markdown, packetId) {
  const lines = packetSection(markdown, packetId).split(/\r?\n/);
  const statusLineIndex = lines.findIndex((line) => line.startsWith("**Status:** "));
  assert.notEqual(statusLineIndex, -1, `Missing ${packetId} status`);
  const statusLines = [lines[statusLineIndex].slice("**Status:** ".length).trim()];
  for (let index = statusLineIndex + 1; index < lines.length; index += 1) {
    const continuation = lines[index].trim();
    if (!continuation || /^\*\*[^*]+:\*\*/.test(continuation)) break;
    statusLines.push(continuation);
  }
  const status = statusLines.join(" ").replace(/\s+/g, " ");
  assert.ok(status, `Missing ${packetId} status`);
  return status;
}

function assertPacketDocumentStructure(path, markdown) {
  const lines = markdown.split(/\r?\n/);
  let packetHeadingCount = 0;

  for (const [index, line] of lines.entries()) {
    if (!/^#{2,3} [A-Z]+-\d+/.test(line)) continue;
    packetHeadingCount += 1;
    assert.match(
      line,
      /^#{2,3} [A-Z]+-\d{2}(?:-[A-Z]+)? · \S/,
      `${path}:${index + 1} has a malformed packet heading`,
    );

    let boundary = index + 1;
    while (boundary < lines.length && !/^#{2,3} /.test(lines[boundary])) boundary += 1;
    const packetLines = lines.slice(index + 1, boundary);
    const statusLineIndex = packetLines.findIndex((candidate) => /^(?:\*\*Status:\*\*|Status:)/.test(candidate));
    if (statusLineIndex === -1) continue;
    assert.equal(statusLineIndex, 0, `${path}:${index + 2 + statusLineIndex} must place Status directly below its packet heading`);
    const statusLine = packetLines[statusLineIndex];
    assert.doesNotMatch(statusLine, /^Status:/, `${path}:${index + 2} must use the bold Status marker`);
    assert.match(
      statusLine,
      /^\*\*Status:\*\* (?:Complete — PR #\d+(?: \+ PR #\d+)*|In review — PR #\d+|In progress — `(?:codex|claude)\/[^`]+`|Blocked — .+|Resolved in PR #\d+|Superseded — absorbed into [A-Z]+-\d+)(?:[,.]|$)/,
      `${path}:${index + 2} has an invalid status-line shape`,
    );
  }

  assert.ok(packetHeadingCount > 0, `${path} has no packet headings`);
}

function assertCompleteStatus(markdown, packetId, pr) {
  const status = packetStatus(markdown, packetId);
  assert.match(
    status,
    new RegExp(`^Complete — PR #${pr}(?: \\+ PR #\\d+)*, [A-Z][a-z]+ \\d{1,2}, \\d{4}\\.`),
    `${packetId} does not record merged PR #${pr}`,
  );
  assertMergedStatusHasNoReviewTerms(packetId, status);
}

function markdownLinkTargets(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]);
}

function markdownTableRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|.*\|$/.test(line.trim()))
    .map((line) => line.trim().slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
}

function assertIncludesTokens(value, tokens, message) {
  const normalized = value.toLowerCase();
  for (const token of tokens) {
    assert.ok(normalized.includes(token.toLowerCase()), `${message}: missing ${token}`);
  }
}

function paragraphContaining(markdown, token) {
  const paragraph = markdown
    .split(/\r?\n\s*\r?\n/)
    .find((candidate) => candidate.includes(token));
  assert.ok(paragraph, `Missing paragraph containing ${token}`);
  return paragraph;
}

function assertPositiveDeploymentRelation(value, identifiers, message) {
  assert.match(value, /\b(?:included|deployed)\b/i, `${message} lacks a positive deployment verb`);
  const negativeDeployment = String.raw`(?:not(?:\s+been)?\s+deployed|undeployed|no deployment)`;
  const clauses = value.replace(/\r?\n/g, " ").split(/[.;|]/);
  for (const identifier of identifiers) {
    const relatedClauses = clauses.filter((clause) => clause.includes(identifier));
    assert.ok(relatedClauses.length > 0, `${message} omits ${identifier}`);
    for (const clause of relatedClauses) {
      assert.doesNotMatch(clause, new RegExp(negativeDeployment, "i"), `${message} reverses ${identifier}`);
    }
  }
}

test("packet headings, status markers, and stale-reference detection stay structural", () => {
  const wrappedStatus = [
    "## FIXTURE-01 · Wrapped status",
    "**Status:** Complete — PR #54, July 20, 2026.",
    "Awaiting merge.",
    "",
    "**Why:** mutation fixture",
  ].join("\n");
  const capturedStatus = packetStatus(wrappedStatus, "FIXTURE-01");
  assert.equal(capturedStatus, "Complete — PR #54, July 20, 2026. Awaiting merge.");
  assert.throws(
    () => assertMergedStatusHasNoReviewTerms("FIXTURE-01", capturedStatus),
    /FIXTURE-01 regressed to a review-only status/,
  );
  assert.throws(
    () => assertPacketDocumentStructure("fixture.md", "## FIXTURE-01 - Wrong separator\n**Status:** Complete — PR #54, July 20, 2026."),
    /malformed packet heading/,
  );
  assert.throws(
    () => assertPacketDocumentStructure("fixture.md", "## FIXTURE-1 · One-digit ID\n**Status:** Complete — PR #54, July 20, 2026."),
    /malformed packet heading/,
  );
  assert.throws(
    () => packetStatus("## FIXTURE-01 · Missing marker\nStatus: Complete — PR #54, July 20, 2026.", "FIXTURE-01"),
    /Missing FIXTURE-01 status/,
  );
  assert.throws(
    () => assertPacketDocumentStructure("fixture.md", "## FIXTURE-01 · Missing marker\n\nStatus: Complete — PR #54, July 20, 2026."),
    /place Status directly below its packet heading/,
  );

  for (const staleLine of [
    "OIDC-02/#54 is in progress.",
    "In review. Bare #54 still needs approval.",
    "Review and merge PR #54 after checks.",
    "Logo refresh/#54 remains open and unmerged.",
  ]) {
    assert.throws(
      () => assertNoStaleMergedPrReferences("fixture.md", staleLine, [54]),
      /fixture\.md:1 still (?:assigns merged PR #54 for review|marks merged PR #54 open or unmerged)/,
    );
  }
  assert.doesNotThrow(() =>
    assertNoStaleMergedPrReferences(
      "fixture.md",
      "PR #54 is complete and undeployed; broader implementation remains open.\nDraft PR #999 remains open.\n#540 is in progress.",
      [54],
    ),
  );

  for (const path of [
    "docs/agent-plan-architecture-workspace-and-setup.md",
    "docs/be04-oidc-review-and-followups.md",
    "docs/full-review-2026-07-21-findings.md",
    "docs/full-review-2026-07-24-findings.md",
  ]) {
    assertPacketDocumentStructure(path, read(path));
  }
});

test("task-tracking surfaces expose the authoritative ledger topology without duplicate lists", () => {
  const readme = read("README.md");
  const checklists = read("docs/task-checklists/README.md");
  const audit = read("docs/complete-product-and-google-cloud-architecture-audit.md");
  const plan = read("docs/agent-plan-architecture-workspace-and-setup.md");

  const rootTracking = section(readme, "## Prioritized next work", "## Google Workspace development validation");
  const rootTargets = new Set(markdownLinkTargets(rootTracking));
  for (const target of [
    "docs/agent-plan-architecture-workspace-and-setup.md",
    "docs/design-critique-fix-plan.md",
    "docs/task-checklists/README.md",
    "docs/complete-product-and-google-cloud-architecture-audit.md#ordered-branch-sized-implementation-roadmap",
  ]) {
    assert.ok(rootTargets.has(target), `README tracking section omits ${target}`);
  }
  assert.doesNotMatch(rootTracking, /^\d+\.\s/m);

  const checklistTargets = new Set(markdownLinkTargets(checklists));
  for (const target of [
    "../agent-plan-architecture-workspace-and-setup.md",
    "../design-critique-fix-plan.md",
    "../complete-product-and-google-cloud-architecture-audit.md#ordered-branch-sized-implementation-roadmap",
    "../../README.md#prioritized-next-work",
  ]) {
    assert.ok(checklistTargets.has(target), `Checklist dashboard omits ${target}`);
  }
  assert.match(checklists, /owner-facing/i);
  const checklistNextWork = section(checklists, "## Recommended next work", "## Safety boundary");
  assert.doesNotMatch(checklistNextWork, /^\d+\.\s/m);

  const authorityRows = markdownTableRows(section(plan, "**Division of authority", "**Alignment rule:**"));
  const planAuthority = authorityRows.find((row) => row[0] === "This document");
  assert.ok(planAuthority, "Plan omits its division-of-authority row");
  assertIncludesTokens(planAuthority.join(" "), ["Active agent work", "Status lines"], "Plan authority row");
  assert.ok(
    markdownLinkTargets(audit).some((target) => target.includes("agent-plan-architecture-workspace-and-setup.md")),
    "Architecture audit does not link the agent execution plan",
  );
});

test("known merged packets map to their PRs and cannot regress to review-only wording", () => {
  const plan = read("docs/agent-plan-architecture-workspace-and-setup.md");
  const oidc = read("docs/be04-oidc-review-and-followups.md");
  const findings = read("docs/full-review-2026-07-21-findings.md");
  const mergedPlanPackets = new Map([
    ["BE-01", 32], ["BE-02", 36], ["BE-03", 46], ["BE-04", 38], ["BE-05", 40],
    ["BE-06", 42], ["BE-08", 45], ["BE-09", 51], ["BE-10", 82], ["BE-11", 47],
    ["BE-12", 53], ["BE-13", 36], ["WS-03", 32], ["WS-04", 39], ["WS-12", 39],
    ["SET-01", 35], ["SET-02", 37], ["SET-03", 44], ["SET-04", 44], ["SET-10", 56],
    ["SET-13", 76], ["SET-14", 81], ["SET-15", 84], ["SET-16", 88], ["SET-17", 92],
    ["SET-19", 83], ["SET-28", 87], ["GI-02", 79], ["GI-03", 80], ["KPI-01", 41],
    ["KPI-02", 52], ["KPI-03", 75], ["TRK-01", 32], ["TRK-02", 66], ["AI-01", 135],
  ]);
  const mergedOidcPackets = new Map([
    ["OIDC-01", 48], ["OIDC-02", 54], ["OIDC-03", 55], ["OIDC-04", 49],
  ]);
  const mergedFixPackets = new Map([
    ["FIX-01", 95], ["FIX-02", 97], ["FIX-03", 100],
  ]);

  for (const [packet, pr] of mergedPlanPackets) assertCompleteStatus(plan, packet, pr);
  assert.match(packetStatus(plan, "AI-01"), /\+ PR #140,/);
  for (const [packet, pr] of mergedOidcPackets) assertCompleteStatus(oidc, packet, pr);
  for (const [packet, pr] of mergedFixPackets) assertCompleteStatus(findings, packet, pr);

  const trackingFiles = [
    "README.md",
    "docs/20-user-product-and-architecture-review.md",
    "docs/agent-plan-architecture-workspace-and-setup.md",
    "docs/architecture-decision-production-platform.md",
    "docs/authorization-simulation.md",
    "docs/be04-oidc-review-and-followups.md",
    "docs/codex-to-codex-handoff.md",
    "docs/complete-product-and-google-cloud-architecture-audit.md",
    "docs/design-critique-fix-plan.md",
    "docs/full-review-2026-07-21-findings.md",
    "docs/google-cloud-runtime-foundation.md",
    "docs/google-workspace-rollout-guide.md",
    "docs/pre-workspace-development-plan.md",
    "docs/production-persistence-boundary.md",
    "docs/task-checklists/04-staff-login-and-permissions.md",
    "docs/task-checklists/07-production-foundation-and-migration.md",
    "docs/task-checklists/README.md",
    "docs/task-checklists/09-frontend-and-multi-user-hardening.md",
    "docs/task-checklists/10-complete-product-and-integration-architecture.md",
    "docs/ui-and-product-readiness-review.md",
  ];
  const mergedPrs = [...new Set([
    ...mergedPlanPackets.values(),
    ...mergedOidcPackets.values(),
    ...mergedFixPackets.values(),
    57,
  ])];
  for (const path of trackingFiles) assertNoStaleMergedPrReferences(path, read(path), mergedPrs);
});

test("the frozen GitHub review snapshot is a structurally valid merged-source table", () => {
  const checklists = read("docs/task-checklists/README.md");
  const reviewSnapshot = section(checklists, "## Current GitHub review snapshot", "## Checklists by topic");
  const rows = markdownTableRows(reviewSnapshot);

  for (const pr of [51, 52, 53, 54, 55, 56, 57, 66]) {
    const row = rows.find((candidate) => markdownLinkTargets(candidate[0] ?? "").some((target) => target.endsWith(`/pull/${pr}`)));
    assert.ok(row, `Review snapshot omits PR #${pr}`);
    assert.ok(row[1], `Review snapshot PR #${pr} omits its packet label`);
    assertIncludesTokens(row[2] ?? "", ["Merged", "source-only", "undeployed"], `Review snapshot PR #${pr}`);
    assertMergedStatusHasNoReviewTerms(`PR #${pr}`, row[2] ?? "");
  }

  const currentStatusTargets = new Set(markdownLinkTargets(reviewSnapshot));
  assert.ok(currentStatusTargets.has("../agent-plan-architecture-workspace-and-setup.md"));
  assert.ok(currentStatusTargets.has("../full-review-2026-07-21-findings.md"));
});

test("every open architecture-roadmap row has a structural tracking owner", () => {
  const audit = read("docs/complete-product-and-google-cloud-architecture-audit.md");
  const roadmap = section(audit, "## Ordered branch-sized implementation roadmap", "## Owner decisions that prevent architectural rework");
  const rows = markdownTableRows(roadmap);
  const expectedOwnerTokens = new Map([
    [10, ["Unassigned"]],
    [11, ["BE-12"]],
    [12, ["BE-04"]],
    [13, ["WS-12", "BE-14"]],
    [14, ["WS-12", "BE-14"]],
    [15, ["Unassigned", "BE-05"]],
    [16, ["BE-10", "Unassigned", "BE-11"]],
    [17, ["Unassigned"]],
    [18, ["design-ledger", "SET-01–SET-12"]],
    [19, ["Unassigned"]],
  ]);

  for (const [order, tokens] of expectedOwnerTokens) {
    const row = rows.find((candidate) => candidate[0] === String(order));
    assert.ok(row, `Missing roadmap row ${order}`);
    assert.match(row[2] ?? "", /^\*\*Tracking:/, `Roadmap row ${order} lacks a Tracking field`);
    assertIncludesTokens(row[2] ?? "", tokens, `Roadmap row ${order}`);
  }
});

test("deployment and source-only history is coupled by semantic paragraphs, not verbatim prose", () => {
  const statusFiles = [
    "docs/codex-to-codex-handoff.md",
    "docs/complete-product-and-google-cloud-architecture-audit.md",
    "docs/design-critique-fix-plan.md",
    "docs/task-checklists/README.md",
    "docs/task-checklists/09-frontend-and-multi-user-hardening.md",
    "docs/task-checklists/10-complete-product-and-integration-architecture.md",
    "docs/ui-and-product-readiness-review.md",
  ];

  for (const path of statusFiles) {
    const status = read(path);
    const lines = status.split(/\r?\n/);
    const deployedPr30 = paragraphContaining(status, "aa8ed8f");
    assertIncludesTokens(deployedPr30, ["PR #30", "version 40"], `${path} PR #30 deployment paragraph`);
    assertPositiveDeploymentRelation(deployedPr30, ["PR #30", "aa8ed8f"], `${path} PR #30 deployment paragraph`);
    const deployedPr32 = paragraphContaining(status, "adc79b8");
    assertIncludesTokens(deployedPr32, ["PR #32", "version 40"], `${path} PR #32 deployment paragraph`);
    assertPositiveDeploymentRelation(deployedPr32, ["PR #32", "adc79b8"], `${path} PR #32 deployment paragraph`);
    const actionableLines = lines.filter((line) => line.includes("codex/actionable-lists"));
    assert.ok(
      actionableLines.some((line) => /PR #33/i.test(line) && /source/i.test(line) && /not deployed|not been deployed|undeployed|no deployment/i.test(line)),
      `${path} does not keep PR #33 explicitly source-only and undeployed`,
    );
    assertNoStaleMergedPrReferences(path, actionableLines.join("\n"), [33]);
  }

  for (const path of [...statusFiles, "docs/agent-plan-architecture-workspace-and-setup.md", "docs/pre-workspace-development-plan.md"]) {
    const settingsLines = read(path).split(/\r?\n/).filter((line) => line.includes("codex/settings-panel-extraction"));
    assert.ok(
      settingsLines.some((line) => /PR #35/i.test(line) && /source/i.test(line) && /not deployed|not been deployed|undeployed|no deployment/i.test(line)),
      `${path} does not keep PR #35 explicitly source-only and undeployed`,
    );
    assertNoStaleMergedPrReferences(path, settingsLines.join("\n"), [35]);
  }

  const audit = read("docs/complete-product-and-google-cloud-architecture-audit.md");
  assertIncludesTokens(
    paragraphContaining(audit, "Production PostgreSQL migrations"),
    ["source", "none", "Cloud SQL"],
    "Production migration paragraph",
  );

  const design = read("docs/design-critique-fix-plan.md");
  const actionableEvidence = section(
    design,
    "### Actionable-list slice evidence — complete in PR #33",
    "### Settings panel-extraction evidence",
  );
  const evidenceBullets = actionableEvidence.split(/\r?\n/).filter((line) => line.startsWith("- "));
  assert.ok(evidenceBullets.length >= 3, "Actionable-list evidence must remain a structured bullet list");
  assertIncludesTokens(
    actionableEvidence,
    ["Playwright", "desktop", "390 px", "npm test", "watcher", "`work`"],
    "Actionable-list verification evidence",
  );
});

test("Workspace setup documents and examples enforce the one-account Gmail boundary", () => {
  const envExample = read(".env.example");
  const rollout = read("docs/google-workspace-rollout-guide.md");
  const hostedChecklist = read("docs/task-checklists/03-hosted-development-connection.md");
  const readme = read("README.md");

  assert.doesNotMatch(envExample, /GOOGLE_WORKSPACE_PUBSUB_TOPIC/);
  assert.doesNotMatch(rollout, /jason\.grass@gmail\.com/i);
  assertIncludesTokens(
    rollout,
    ["GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS", "GOOGLE_WORKSPACE_INTAKE_MAILBOX", "exactly one account", "readiness fails closed"],
    "Workspace rollout one-account boundary",
  );
  assertIncludesTokens(
    hostedChecklist,
    ["GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS", "GOOGLE_WORKSPACE_INTAKE_MAILBOX", "readiness fails closed"],
    "Hosted checklist one-account boundary",
  );
  assert.ok(markdownLinkTargets(readme).some((target) => target.includes("docs/google-workspace-organization.md")));
  assert.match(readme, /ChatGPT Sites project's runtime environment settings/);
});

test("the tracking guard has no numeric execution-evidence pins", () => {
  const guardSource = read("tests/task-tracking-docs.test.mjs");
  assert.doesNotMatch(
    guardSource,
    /\b[0-9]+\s+(?:(?:focused\s+)?Playwright\s+tests?|routes?\s+pass|active\s+tests?|skipped)\b/i,
    "Tracking assertions must not pin volatile execution counts",
  );
});
