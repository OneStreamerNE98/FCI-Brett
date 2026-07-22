import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

function read(path) {
  return readFileSync(`${root}${path}`, "utf8");
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
  const itemSection = markdown.split(/^#{2,3} /m).find((part) => part.startsWith(`${packetId} ·`));
  assert.ok(itemSection, `Missing ${packetId} plan entry`);
  return itemSection;
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

test("tracking guard captures wrapped statuses and rejects line-local stale merged references", () => {
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
});

test("task-tracking surfaces point to their authoritative ledgers without duplicate lists", () => {
  const readme = read("README.md");
  const checklists = read("docs/task-checklists/README.md");
  const audit = read("docs/complete-product-and-google-cloud-architecture-audit.md");
  const plan = read("docs/agent-plan-architecture-workspace-and-setup.md");

  const rootTracking = section(readme, "## Prioritized next work", "## Google Workspace development validation");
  for (const target of [
    "docs/agent-plan-architecture-workspace-and-setup.md",
    "docs/design-critique-fix-plan.md",
    "docs/task-checklists/README.md",
    "docs/complete-product-and-google-cloud-architecture-audit.md#ordered-branch-sized-implementation-roadmap",
  ]) {
    assert.match(rootTracking, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(rootTracking, /^\d+\.\s/m);

  assert.match(checklists, /These checklists are owner-facing/);
  for (const target of [
    "../agent-plan-architecture-workspace-and-setup.md",
    "../design-critique-fix-plan.md",
    "../complete-product-and-google-cloud-architecture-audit.md#ordered-branch-sized-implementation-roadmap",
    "../../README.md#prioritized-next-work",
  ]) {
    assert.match(checklists, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const checklistNextWork = section(checklists, "## Recommended next work", "## Safety boundary");
  assert.doesNotMatch(checklistNextWork, /^\d+\.\s/m);

  assert.match(audit, /Current packet status and dependency sequencing live in the \[agent execution plan\]/);
  assert.match(plan, /This document \| Active agent work/);

  const packetStatuses = ["BE-01", "WS-03", "TRK-01"].map((item) => {
    const status = packetStatus(plan, item);
    assert.match(
      status,
      /^(?:In progress — `codex\/doc-truth-reconciliation`, July \d{1,2}, 2026\.|Complete — PR #\d+, July \d{1,2}, 2026\.)$/,
      `${item} has an invalid packet status`,
    );
    return status;
  });
  assert.equal(new Set(packetStatuses).size, 1, "The packet items must share one status");
});

test("known merged packets have complete statuses and cannot regress to review-only wording", () => {
  const readme = read("README.md");
  const plan = read("docs/agent-plan-architecture-workspace-and-setup.md");
  const oidc = read("docs/be04-oidc-review-and-followups.md");
  const audit = read("docs/complete-product-and-google-cloud-architecture-audit.md");
  const mergedPlanPackets = new Map([
    ["BE-01", 32],
    ["BE-02", 36],
    ["BE-03", 46],
    ["BE-04", 38],
    ["BE-05", 40],
    ["BE-06", 42],
    ["BE-08", 45],
    ["BE-09", 51],
    ["BE-10", 82],
    ["BE-11", 47],
    ["BE-12", 53],
    ["BE-13", 36],
    ["WS-03", 32],
    ["WS-04", 39],
    ["WS-12", 39],
    ["SET-01", 35],
    ["SET-02", 37],
    ["SET-03", 44],
    ["SET-04", 44],
    ["SET-10", 56],
    ["SET-13", 76],
    ["SET-15", 84],
    ["SET-16", 88],
    ["SET-17", 92],
    ["SET-19", 83],
    ["SET-28", 87],
    ["GI-02", 79],
    ["GI-03", 80],
    ["KPI-01", 41],
    ["KPI-02", 52],
    ["KPI-03", 75],
    ["TRK-01", 32],
    ["TRK-02", 66],
  ]);

  for (const [packet, pr] of mergedPlanPackets) {
    const status = packetStatus(plan, packet);
    assert.match(
      status,
      new RegExp(`^Complete — PR #${pr}, July \\d{1,2}, 2026\\.`),
      `${packet} does not record merged PR #${pr}`,
    );
    assertMergedStatusHasNoReviewTerms(packet, status);
  }

  const mergedOidcPackets = new Map([
    ["OIDC-01", { pr: 48, date: "July \\d{1,2}, 2026" }],
    ["OIDC-02", { pr: 54, date: "July 20, 2026" }],
    ["OIDC-03", { pr: 55, date: "July 20, 2026" }],
    ["OIDC-04", { pr: 49, date: "July \\d{1,2}, 2026" }],
  ]);
  for (const [packet, { pr, date }] of mergedOidcPackets) {
    const status = packetStatus(oidc, packet);
    assert.match(status, new RegExp(`^Complete — PR #${pr}, ${date}\\.`));
    assertMergedStatusHasNoReviewTerms(packet, status);
  }
  const productionBoundary = section(readme, "## Production architecture", "## Remaining launch decision");
  const launchDecision = section(readme, "## Remaining launch decision", "## Prioritized next work");
  assert.match(
    productionBoundary,
    /Workspace OIDC initiation\/callback, durable invitation redemption, secure session issuance,[\s\S]*approved fixed application roles and capability ceilings,[\s\S]*project-scoped authorization are also source-composed/,
  );
  assert.match(
    launchDecision,
    /Workspace OIDC, durable invitation\/session issuance,[\s\S]*project-scoped authorization,[\s\S]*negative\/real-PostgreSQL login test matrix now exist in source through PR #55/,
  );
  assert.match(
    launchDecision,
    /configure live identity with explicit owner approval,[\s\S]*apply the PostgreSQL migrations and grants,[\s\S]*compose the production session\/UI boundary,[\s\S]*deploy/,
  );

  const frontendAndApi = section(audit, "## Frontend and API architecture", "## Operations, observability, and recovery");
  assert.match(
    frontendAndApi,
    /Resolved in source — PR #46:[\s\S]*`\/api\/v1\/records`[\s\S]*`actorFrom` helper are removed/,
  );
  assert.match(
    frontendAndApi,
    /assistant's separate records-only answer-mode assertion remains in `tests\/rendered-html\.test\.mjs`/,
  );
  assert.doesNotMatch(frontendAndApi, /Remove or tightly type the generic records endpoint/);

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
  const mergedPrs = [...new Set([...mergedPlanPackets.values(), 48, 49, 54, 55, 57])];
  for (const path of trackingFiles) {
    assertNoStaleMergedPrReferences(path, read(path), mergedPrs);
  }
});

test("the checklist dashboard records the merged baseline and current review queue without promoting drafts", () => {
  const checklists = read("docs/task-checklists/README.md");
  const staffLogin = read("docs/task-checklists/04-staff-login-and-permissions.md");
  const foundation = read("docs/task-checklists/07-production-foundation-and-migration.md");
  const frontend = read("docs/task-checklists/09-frontend-and-multi-user-hardening.md");
  const architecture = read("docs/task-checklists/10-complete-product-and-integration-architecture.md");
  const plan = read("docs/agent-plan-architecture-workspace-and-setup.md");
  const audit = read("docs/complete-product-and-google-cloud-architecture-audit.md");
  const oidc = read("docs/be04-oidc-review-and-followups.md");
  const handoff = read("docs/codex-to-codex-handoff.md");

  assert.match(checklists, /July 20, 2026[\s\S]*`main` at `599e39f205a67c3f558eb47faabc139dd6d6b57c`/);
  assert.match(checklists, /PR #49 completed OIDC-04[\s\S]*PR #50 guarded that completed status/);
  assert.match(
    checklists,
    /OIDC-02 in PR #54 and OIDC-03 in PR #55 are merged\.\s+PRs #54\/#55 are source-only and undeployed\.\s+PR #51 completed BE-09 and is merged source-only and undeployed\.\s+PR #53 completed BE-12 and is merged source-only and undeployed\.\s+PR #52 completed KPI-02 and is merged source-only and undeployed; migration 0012 is unapplied to Sites, and KPI-03 is now assignable\.\s+PR #56 completed SET-10 and is merged source-only and undeployed\.\s+PR #57 completed the application logo asset refresh and is merged source-only and undeployed; the reviewed PR #51–#57 merge train is complete\./,
  );
  assert.doesNotMatch(checklists, /drafts #51–#57|drafts #51–#53|drafts #51–#53 and #55–#57/i);
  assert.match(handoff, /source status is reconciled against merged `main` baseline `599e39f`/);
  assert.match(plan, /\*\*GitHub baseline:\*\* source is reconciled against `main` at `599e39f` after PR #57/);
  assert.match(audit, /Source status is reconciled against merged `main` baseline `599e39f`/);

  const reviewQueue = section(checklists, "## Current GitHub review snapshot", "## Checklists by topic");
  for (const pr of [51, 52, 53, 54, 55, 56, 57, 66]) {
    assert.match(reviewQueue, new RegExp(`pull/${pr}\\)`), `Review snapshot omits PR #${pr}`);
  }
  assert.match(reviewQueue, /pull\/54\)[^\n]*Merged into `main`[^\n]*source-only and undeployed/);
  assert.match(reviewQueue, /pull\/55\)[^\n]*Merged into `main`[^\n]*source-only and undeployed/);
  assert.match(reviewQueue, /pull\/66\)[^\n]*Merged into `main`[^\n]*source-only and undeployed/);
  assert.match(reviewQueue, /pull\/51\)[^\n]*Merged into `main`[^\n]*source-only and undeployed/);
  assert.match(reviewQueue, /pull\/52\)[^\n]*Merged into `main`[^\n]*source-only and undeployed[^\n]*migration 0012 unapplied[^\n]*KPI-03 now assignable/);
  assert.match(reviewQueue, /pull\/53\)[^\n]*Merged into `main`[^\n]*source-only and undeployed/);
  assert.match(reviewQueue, /pull\/56\)[^\n]*Merged into `main`[^\n]*source-only and undeployed[^\n]*does not complete the broader operations-health checklist/);
  assert.match(reviewQueue, /pull\/57\)[^\n]*Merged into `main`[^\n]*source-only and undeployed[^\n]*static UI assets and review documentation only/);
  assert.match(reviewQueue, /does not change any owner checkbox or authorize deployment/);

  assert.match(packetStatus(oidc, "OIDC-02"), /^Complete — PR #54, July 20, 2026\./);
  assert.match(packetStatus(oidc, "OIDC-03"), /^Complete — PR #55, July 20, 2026\./);
  const be12Status = packetStatus(plan, "BE-12");
  assert.match(be12Status, /^Complete — PR #53, July 20, 2026\./);
  assert.match(be12Status, /disposable GitHub CI PostgreSQL 16 schema/);
  assert.match(
    be12Status,
    /No approved hosted development\/staging rehearsal, production migration or grant apply, live-data operation, hosted configuration, or deployment has been executed\./,
  );
  assert.match(
    audit,
    /BE-12 complete in PR #53; source-only and undeployed:[^\n]*disposable GitHub CI PostgreSQL 16 schema; no approved hosted development\/staging rehearsal, production migration or grant apply, or live-data operation has run\./,
  );
  const kpi02Status = packetStatus(plan, "KPI-02");
  assert.match(kpi02Status, /^Complete — PR #52, July 20, 2026\. Source-only and undeployed; migration 0012 has not been applied to Sites\.$/);
  assertMergedStatusHasNoReviewTerms("KPI-02", kpi02Status);
  const kpi03Status = packetStatus(plan, "KPI-03");
  assert.equal(kpi03Status, "Complete — PR #75, July 21, 2026. Source-only and undeployed; migration 0014 has not been applied to Sites.");
  assertMergedStatusHasNoReviewTerms("KPI-03", kpi03Status);
  const set10Status = packetStatus(plan, "SET-10");
  assert.match(set10Status, /^Complete — PR #56, July 20, 2026\. Source-only and undeployed\.$/);
  assertMergedStatusHasNoReviewTerms("SET-10", set10Status);
  const set13Status = packetStatus(plan, "SET-13");
  assert.equal(set13Status, "Complete — PR #76, July 21, 2026. Source-only and undeployed; migration 0013 has not been applied to Sites.");
  assertMergedStatusHasNoReviewTerms("SET-13", set13Status);
  assert.equal(packetStatus(plan, "SET-15"), "Complete — PR #84, July 21, 2026. Source-only and undeployed.");
  assert.equal(packetStatus(plan, "SET-16"), "Complete — PR #88, July 21, 2026. Source-only and undeployed.");
  assert.equal(packetStatus(plan, "SET-17"), "Complete — PR #92, July 22, 2026. Source-only and undeployed.");
  assert.equal(packetStatus(plan, "SET-19"), "Complete — PR #83, July 21, 2026. Source-only and undeployed.");
  assert.equal(packetStatus(plan, "SET-28"), "Complete — PR #87, July 21, 2026. Source-only and undeployed; migration 0016 has not been applied to Sites.");
  assert.equal(packetStatus(plan, "BE-10"), "Complete — PR #82, July 21, 2026. Source-only and undeployed.");
  assert.equal(packetStatus(plan, "GI-02"), "Complete — PR #79, July 21, 2026. Source-only and undeployed.");
  assert.equal(packetStatus(plan, "GI-03"), "Complete — PR #80, July 21, 2026. Source-only and undeployed; live satellite embeds remain blocked on WS-15 restricted browser-key configuration.");
  assert.match(staffLogin, /OIDC-02\/#54[\s\S]*OIDC-03\/#55[\s\S]*merged[\s\S]*source-only and undeployed/i);
  assert.match(foundation, /BE-09\/#51 is complete in source, merged, and undeployed/);
  assert.match(foundation, /BE-12\/#53 is complete in source, merged, and undeployed/);
  assert.match(frontend, /KPI-02\/#52, SET-10\/#56, and the logo refresh\/#57 are merged source-only and undeployed/);
  assert.match(architecture, /PRs #54\/#55[\s\S]*merged source-only and undeployed[\s\S]*BE-09\/#51 is merged source-only and undeployed[\s\S]*BE-12\/#53 is merged source-only and undeployed[\s\S]*KPI-02\/#52, SET-10\/#56, and the logo refresh\/#57 are merged source-only and undeployed/i);

  const checklistNextWork = section(checklists, "## Recommended next work", "## Safety boundary");
  assert.match(checklistNextWork, /OIDC-04 is complete in PRs #49\/#50/);
  assert.match(checklistNextWork, /TRK-02 is complete in PR #66/);
  assert.match(checklistNextWork, /BE-07\+SET-05, SET-11, SET-09\+WS-10, and WS-13/);
  assert.match(checklistNextWork, /PR #51 completed BE-09[\s\S]*BE-10\/BE-14 are now assignable[\s\S]*PR #52 completed KPI-02[\s\S]*KPI-03 is now assignable/);
  assert.match(checklistNextWork, /reviewed PR #51–#57 merge train is complete/);
  assert.match(checklistNextWork, /SET-13 is now assignable because SET-03, SET-04, and SET-10 are complete/);
  assert.doesNotMatch(checklistNextWork, /#57[^\n]*(?:draft|open|unmerged)|(?:draft|open|unmerged)[^\n]*#57/i);
  assert.doesNotMatch(checklistNextWork, /#52 →|KPI-03 waits for #52/i);
  assert.doesNotMatch(checklistNextWork, /merge order #53|#53 →/);
  assert.doesNotMatch(checklistNextWork, /OIDC-04's merge-train documentation\/guard reconciliation is first/);
});

test("every open architecture-roadmap row has an explicit tracking owner", () => {
  const audit = read("docs/complete-product-and-google-cloud-architecture-audit.md");
  const expected = new Map([
    [10, /Unassigned/],
    [11, /BE-12/],
    [12, /BE-04/],
    [13, /WS-12.*BE-14/],
    [14, /WS-12.*BE-14/],
    [15, /Unassigned.*BE-05.*prerequisite storage adapters/i],
    [16, /BE-10.*rate-limit subset.*Unassigned.*BE-11.*separate deployment/i],
    [17, /Unassigned/],
    [18, /SET-01–SET-12/],
    [19, /Unassigned/],
  ]);

  const lines = audit.split(/\r?\n/);
  for (const [order, owner] of expected) {
    const row = lines.find((line) => line.startsWith(`| ${order} |`));
    assert.ok(row, `Missing roadmap row ${order}`);
    assert.match(row, owner, `Roadmap row ${order} is missing its tracking owner`);
  }
});

test("deployed semantic-table, completed actionable-list and Settings source, and production migration status stay truthful", () => {
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
    assert.doesNotMatch(status, /review and merge[^\n]*semantic/i, `${path} still asks to merge PR #30`);
    assert.doesNotMatch(status, /semantic[- ]table[^\n]*implemented in source for review/i, `${path} still calls PR #30 review-only`);
    assert.doesNotMatch(status, /semantic[- ]table[^\n]*pending separate merge/i, `${path} still calls PR #30 unmerged`);
    assert.doesNotMatch(status, /PR #30[^\n]*(?:has not been deployed|not been deployed|requires separate deployment approval)/i, `${path} still calls PR #30 undeployed`);
    const pr30Passage = status.split(/\r?\n/).find((line) => line.includes("aa8ed8f"));
    assert.ok(pr30Passage, `${path} omits the merged PR #30 commit`);
    assert.match(pr30Passage, /PR #30/, `${path} does not couple aa8ed8f to PR #30`);
    assert.match(pr30Passage, /version 40/i, `${path} does not place PR #30 in version 40`);
    assert.match(pr30Passage, /included|deployed/i, `${path} does not call PR #30 deployed`);

    const deploymentPassage = status.split(/\r?\n/).find((line) => line.includes("adc79b8"));
    assert.ok(deploymentPassage, `${path} omits the PR #32 deployment commit`);
    assert.match(deploymentPassage, /PR #32/i, `${path} does not couple adc79b8 to PR #32`);
    assert.match(deploymentPassage, /version 40/i, `${path} omits the version 40 deployment`);
    assert.match(deploymentPassage, /deploy/i, `${path} does not call the PR #32 baseline deployed`);

    const actionablePassages = status.split(/\r?\n/).filter((line) => line.includes("codex/actionable-lists"));
    assert.ok(actionablePassages.length > 0, `${path} omits the current actionable-list branch`);
    assert.ok(actionablePassages.some((line) => /source-only|source only/i.test(line) && /(?:complete[^\n]*PR #33|PR #33[^\n]*complete)/i.test(line)), `${path} does not call the actionable-list slice source-only and complete in PR #33`);
    assert.ok(actionablePassages.some((line) => /not deployed|not been deployed|no deployment/i.test(line)), `${path} does not record that the actionable-list slice is undeployed`);
    assert.ok(actionablePassages.every((line) => !/(?:draft PR #33|PR #33[^.;|\n]*(?:ready for review|must merge before)|(?:ready for review|must merge before)[^.;|\n]*PR #33)/i.test(line)), `${path} still describes PR #33 as awaiting review or merge`);
    assert.ok(actionablePassages.every((line) => !/no pull request|without a pull request|has no pull request/i.test(line)), `${path} still calls the actionable-list slice PR-less`);
  }

  const settingsStatusFiles = [
    ...statusFiles,
    "docs/agent-plan-architecture-workspace-and-setup.md",
    "docs/pre-workspace-development-plan.md",
  ];
  for (const path of settingsStatusFiles) {
    const status = read(path);
    const settingsPassages = status.split(/\r?\n/).filter((line) => line.includes("codex/settings-panel-extraction"));
    assert.ok(settingsPassages.length > 0, `${path} omits the SET-01 branch`);
    assert.ok(settingsPassages.some((line) => /PR #35/i.test(line) && /complete in source|source[- ]complete/i.test(line)), `${path} does not call SET-01 complete in source in PR #35`);
    assert.ok(settingsPassages.some((line) => /not deployed|not been deployed|no deployment|undeployed/i.test(line)), `${path} does not record that SET-01 is undeployed`);
    assert.ok(settingsPassages.every((line) => !/(?:draft PR #35|PR #35[^.;|\n]*(?:ready for review|must merge before|waiting to merge|awaiting merge)|(?:ready for review|must merge before|waiting to merge|awaiting merge)[^.;|\n]*PR #35)/i.test(line)), `${path} still describes SET-01 as awaiting review or merge`);
  }

  const audit = read("docs/complete-product-and-google-cloud-architecture-audit.md");
  assert.match(audit, /migrations 1–6 exist only in source: none has been applied anywhere, and no Cloud SQL instance exists/);

  const plan = read("docs/agent-plan-architecture-workspace-and-setup.md");
  const startNow = section(plan, "**Start now, in parallel (no owner input needed):**", "**Chains:**");
  assert.match(startNow, /OIDC-04 is complete in PR #49[\s\S]*PR #50/);
  assert.match(startNow, /OIDC-02 and OIDC-03[\s\S]*complete in source in PRs #54\/#55/);
  assert.match(startNow, /TRK-02 is complete in PR #66/);
  assert.doesNotMatch(startNow, /TRK-02[^\n]*(?:in progress|lands before)/i);
  assert.match(startNow, /BE-09 is complete in source in PR #51 and remains undeployed/);
  assert.match(startNow, /BE-12 is complete in source in PR #53 and remains undeployed/);
  assert.match(startNow, /KPI-02 is complete in source in PR #52[\s\S]*SET-10 is complete in\s+source in PR #56 and remains undeployed[\s\S]*application-logo refresh is complete in\s+merged source in PR #57 and remains undeployed[\s\S]*reviewed PR #51–#57 merge train is\s+complete[\s\S]*KPI-03 and SET-13 are now assignable/);
  assert.doesNotMatch(startNow, /BE-12 \(#53\)|#53 →/);
  assert.doesNotMatch(startNow, /#57[^\n]*(?:draft|open|unmerged)|(?:draft|open|unmerged)[^\n]*#57/i);
  assert.doesNotMatch(startNow, /OIDC-04 is the immediate truth-reconciliation packet/);
  const firstWave = section(plan, "**Wave 1 — next PRs, in this order where they share files:**", "**Wave 2 — current:**");
  assert.match(firstWave, /Actionable-list pattern slice[\s\S]*complete in PR #33[\s\S]*SET-01 Settings panel extraction[\s\S]*PR #35[\s\S]*SET-02[\s\S]*PR #37[\s\S]*KPI-01[\s\S]*PR #41/i);
  const secondWave = section(plan, "**Wave 2 — current:**", "**Owner/Brett track");
  assert.match(secondWave, /reviewed\s+merge train and its post-merge tracking flips are complete/);
  assert.doesNotMatch(secondWave, /#57[^\n]*(?:draft|open|unmerged)|(?:draft|open|unmerged)[^\n]*#57/i);
  assert.match(secondWave, /SET-13 is assignable because SET-03, SET-04, and SET-10 are complete/);
  assert.match(secondWave, /KPI-03 is assignable because PR #52\s+merged/);
  assert.doesNotMatch(secondWave, /#52 →|KPI-03 waits for #52/i);
  assert.doesNotMatch(secondWave, /#53 →|BE-12 \(#53\)/);

  const design = read("docs/design-critique-fix-plan.md");
  assert.match(design, /- \[x\] Complete in source in PR #33 from `codex\/actionable-lists`/i);
  assert.match(design, /Settings-only panel-extraction scope is complete in source in PR #35 from `codex\/settings-panel-extraction` and is not deployed; the remaining feature-boundary, primitive, Google-workflow, and CSS tracks stay open/i);
  assert.match(design, /58 focused Playwright tests pass[\s\S]*isolated local-server groups/i);
  assert.match(design, /13 routes pass[\s\S]*desktop and 390 px/i);
  assert.match(design, /final `npm test` run passed 325 active tests with 13 skipped after the accessibility and test-runner adjustments/i);
  assert.match(design, /Vinext development server exits during the monolithic run/i);
  assert.match(design, /watcher now ignores generated `work` artifacts/i);
});

test("Workspace setup documents and examples enforce the one-account Gmail boundary", () => {
  const envExample = read(".env.example");
  const rollout = read("docs/google-workspace-rollout-guide.md");
  const hostedChecklist = read("docs/task-checklists/03-hosted-development-connection.md");
  const readme = read("README.md");

  assert.doesNotMatch(envExample, /GOOGLE_WORKSPACE_PUBSUB_TOPIC/);
  assert.doesNotMatch(rollout, /jason\.grass@gmail\.com/i);
  assert.match(rollout, /One-account invariant for Parts 6–10/);
  assert.match(rollout, /GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS` must contain exactly one account/);
  assert.match(hostedChecklist, /readiness fails closed when the two values differ/);
  assert.match(rollout, /PR #32[^\n]*adc79b8[^\n]*version 40/);
  assert.match(hostedChecklist, /PR #32[^\n]*adc79b8[^\n]*version 40/);
  assert.doesNotMatch(rollout, /safeguard is source-only until this change is merged/i);
  assert.doesNotMatch(hostedChecklist, /safeguard is source-only until this change is merged/i);
  assert.match(readme, /docs\/google-workspace-organization\.md/);
  assert.match(readme, /ChatGPT Sites project's runtime environment settings/);
});
