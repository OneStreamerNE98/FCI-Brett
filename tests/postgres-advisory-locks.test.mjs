import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  ADMIN_ACCESS_MUTATION_LOCK_ID,
  CORE_REHEARSAL_ADVISORY_LOCK_ID,
} from "../app/platform/postgres/advisory-locks.ts";

const root = new URL("../", import.meta.url);
const legacySharedLockId = ["731426917207", "1302"].join("");

async function readTypeScriptSources(directory, relativeDirectory = "app") {
  const sources = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) {
      sources.push(...await readTypeScriptSources(entryUrl, relativePath));
    } else if (/\.tsx?$/.test(entry.name)) {
      sources.push({ path: relativePath, source: await readFile(entryUrl, "utf8") });
    }
  }
  return sources;
}

test("keeps the former shared advisory-lock literal in one source location", async () => {
  const sources = await readTypeScriptSources(new URL("app/", root));
  const occurrences = sources.flatMap(({ path, source }) => {
    const count = source.split(legacySharedLockId).length - 1;
    return count === 0 ? [] : [{ path, count }];
  });

  assert.deepEqual(occurrences, [
    { path: "app/platform/postgres/advisory-locks.ts", count: 1 },
  ]);
});

test("routes both independent advisory locks through the shared Postgres module", async () => {
  const [adminRepository, coreRehearsal] = await Promise.all([
    readFile(new URL("app/adapters/postgres/admin-access-persistence-repository.ts", root), "utf8"),
    readFile(new URL("app/platform/migration/core-record-rehearsal.ts", root), "utf8"),
  ]);

  assert.match(
    adminRepository,
    /import \{ ADMIN_ACCESS_MUTATION_LOCK_ID \} from "\.\.\/\.\.\/platform\/postgres\/advisory-locks";/,
  );
  assert.match(
    adminRepository,
    /pg_advisory_xact_lock\(\$1::bigint\)[\s\S]*?\[ADMIN_ACCESS_MUTATION_LOCK_ID\]/,
  );
  assert.match(
    coreRehearsal,
    /import \{ CORE_REHEARSAL_ADVISORY_LOCK_ID \} from "\.\.\/postgres\/advisory-locks\.ts";/,
  );
  assert.match(
    coreRehearsal,
    /pg_try_advisory_xact_lock\(\$1::bigint\)[\s\S]*?\[CORE_REHEARSAL_ADVISORY_LOCK_ID\]/,
  );
  assert.notEqual(
    ADMIN_ACCESS_MUTATION_LOCK_ID,
    CORE_REHEARSAL_ADVISORY_LOCK_ID,
    "unrelated admin and rehearsal work must not serialize on one database-wide lock",
  );
});
