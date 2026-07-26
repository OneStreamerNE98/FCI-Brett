import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("SET-22 extends the never-delete law over project-file creation", async () => {
  const [route, drive] = await Promise.all([
    read("app/api/v1/projects/[projectId]/drive/files/route.ts"),
    read("app/lib/google-drive.ts"),
  ]);
  const providerWrites = `${route}\n${drive}`;

  assert.doesNotMatch(providerWrites, /method:\s*["']DELETE["']/u);
  assert.doesNotMatch(providerWrites, /\bfiles\.delete\b|\/delete(?:[/?'"`]|$)/u);
  assert.doesNotMatch(route, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?workspace_resources\b/iu);
});

test("SET-22 reuses the existing Drive consent instead of adding a Docs scope", async () => {
  const oauth = await read("app/lib/google-oauth.ts");
  const declaredGoogleScopes = [...oauth.matchAll(
    /const GOOGLE_[A-Z_]+_SCOPE = "(https:\/\/www\.googleapis\.com\/auth\/[^"]+)"/gu,
  )].map((match) => match[1]);

  assert.deepEqual(declaredGoogleScopes, [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  assert.doesNotMatch(oauth, /auth\/documents|auth\/docs/u);
});
