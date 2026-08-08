import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { BOARD_PATH, LEDGERS, parseLedger, renderBoard } from "../tools/generate-board.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function read(path) {
  return readFileSync(`${root}${path}`, "utf8");
}

function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

test("docs/BOARD.md is byte-identical to the generator output", () => {
  assert.equal(
    normalizeEol(read(BOARD_PATH)),
    renderBoard(root),
    "docs/BOARD.md is stale — regenerate it with `node tools/generate-board.mjs` and commit the result",
  );
});

test("every packet in the four ledgers appears exactly once on the board", () => {
  const board = normalizeEol(read(BOARD_PATH));
  const ledgerPackets = LEDGERS.flatMap(({ path, label }) => parseLedger(read(path), label));
  assert.ok(ledgerPackets.length > 0, "the ledgers yield no packets — the parser is broken, not the board");

  const seen = new Set();
  for (const packet of ledgerPackets) {
    assert.ok(!seen.has(packet.id), `duplicate packet id ${packet.id} across ledgers`);
    seen.add(packet.id);
    const row = board.split("\n").find((line) => line.startsWith(`| ${packet.id} | `));
    assert.ok(row, `BOARD.md omits ${packet.id} (${packet.ledger})`);
    assert.ok(row.endsWith(`| ${packet.ledger} |`), `BOARD.md misfiles ${packet.id} under ${row}`);
  }
});

test("every board row carries one of the known status categories", () => {
  const board = normalizeEol(read(BOARD_PATH));
  const rows = board.split("\n").filter((line) => /^\| [A-Z]+-\d/.test(line));
  assert.ok(rows.length > 0, "BOARD.md has no packet rows");
  for (const row of rows) {
    assert.match(
      row,
      /\| (?:—|Complete —|In review —|In progress —|Blocked —|Resolved in PR #|Superseded —)/,
      `BOARD.md row has an unrecognised status shape: ${row}`,
    );
  }
});
