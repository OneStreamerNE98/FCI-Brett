/**
 * Packet-board generator.
 *
 * Renders docs/BOARD.md — the single front door over the four packet ledgers — from the
 * ledger headings and their Status lines. The board is a derived artifact: it is never
 * edited by hand, and tests/board-docs.test.mjs regenerates it and fails CI if the
 * committed copy differs, the same enforcement idea as the status-grammar guard.
 *
 * Usage:
 *   node tools/generate-board.mjs          # rewrite docs/BOARD.md in place
 *
 * The four ledgers are the ones the August 7 restructure plan counts as the 196-packet
 * set. docs/ledger/be04-oidc-review-and-followups.md also carries packet-shaped headings (four
 * OIDC packets and KPI-01-FIX, all resolved); it is a review-followups document rather
 * than one of the four ledgers, so it stays out of the board until the stage-5 ledger
 * consolidation folds it in.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LEDGERS = [
  { path: "docs/ledger/agent-plan-architecture-workspace-and-setup.md", label: "agent-plan" },
  { path: "docs/ledger/full-review-2026-07-21-findings.md", label: "review-2026-07-21" },
  { path: "docs/ledger/full-review-2026-07-24-findings.md", label: "review-2026-07-24" },
  { path: "docs/ledger/nightly-review-2026-07-findings.md", label: "nightly-2026-07" },
];

export const BOARD_PATH = "docs/BOARD.md";

const HEADING_PATTERN = /^#{2,3} ([A-Z]+-\d{2}[a-z]?(?:-[A-Z]+)?) · (.+)$/;

const STATUS_CATEGORIES = [
  [/^Complete —/, "Complete"],
  [/^In review —/, "In review"],
  [/^In progress —/, "In progress"],
  [/^Blocked —/, "Blocked"],
  [/^Resolved in PR #/, "Resolved"],
  [/^Superseded —/, "Superseded"],
];

function categorize(status) {
  if (status === null) return "Not started";
  for (const [pattern, category] of STATUS_CATEGORIES) {
    if (pattern.test(status)) return category;
  }
  return "Other";
}

function firstSentence(text) {
  const match = /^.*?\./s.exec(text);
  const sentence = match ? match[0] : text;
  return sentence.length <= 160 ? sentence : `${sentence.slice(0, 157)}…`;
}

function cellText(value) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function parseLedger(markdown, label) {
  const lines = markdown.split(/\r?\n/);
  const packets = [];
  for (const [index, line] of lines.entries()) {
    const heading = HEADING_PATTERN.exec(line);
    if (!heading) continue;
    const next = lines[index + 1] ?? "";
    const status = next.startsWith("**Status:** ") ? next.slice("**Status:** ".length).trim() : null;
    packets.push({
      id: heading[1],
      title: heading[2].trim(),
      status,
      category: categorize(status),
      ledger: label,
    });
  }
  return packets;
}

function packetSortKey(id) {
  const match = /^([A-Z]+)-(\d+)([a-z]?)(?:-([A-Z]+))?$/.exec(id);
  if (!match) return [id, 0, "", ""];
  return [match[1], Number(match[2]), match[3], match[4] ?? ""];
}

function comparePackets(a, b) {
  const keyA = packetSortKey(a.id);
  const keyB = packetSortKey(b.id);
  for (let index = 0; index < keyA.length; index += 1) {
    if (keyA[index] < keyB[index]) return -1;
    if (keyA[index] > keyB[index]) return 1;
  }
  return 0;
}

export function renderBoard(root) {
  const packets = LEDGERS.flatMap(({ path, label }) =>
    parseLedger(readFileSync(`${root}${path}`, "utf8"), label),
  ).sort(comparePackets);

  const counts = new Map();
  for (const packet of packets) {
    counts.set(packet.category, (counts.get(packet.category) ?? 0) + 1);
  }
  const summaryOrder = ["Not started", "In progress", "In review", "Blocked", "Complete", "Resolved", "Superseded", "Other"];
  const summary = summaryOrder
    .filter((category) => counts.has(category))
    .map((category) => `${counts.get(category)} ${category.toLowerCase()}`)
    .join(" · ");

  const rows = packets.map((packet) => {
    const status = packet.status === null ? "—" : firstSentence(packet.status);
    return `| ${packet.id} | ${cellText(packet.title)} | ${cellText(status)} | ${packet.ledger} |`;
  });

  return [
    "# Packet board",
    "",
    "<!-- GENERATED FILE — do not edit by hand. Regenerate with `node tools/generate-board.mjs`;",
    "     tests/board-docs.test.mjs fails CI if this file differs from the generator output. -->",
    "",
    `${packets.length} packets across ${LEDGERS.length} ledgers: ${summary}.`,
    "The Status column is the first sentence of the packet's ledger status line; the ledger",
    "row holds the full text. Packets without a status line are not started.",
    "",
    "| Packet | Title | Status | Ledger |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  writeFileSync(`${root}${BOARD_PATH}`, renderBoard(root));
  console.log(`Wrote ${BOARD_PATH}`);
}
