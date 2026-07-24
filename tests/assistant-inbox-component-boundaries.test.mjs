import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const expectedAssistantComponents = new Map([
  ["AssistantHelpPanel.tsx", ["AssistantHelpPanel"]],
  ["AssistantView.tsx", ["AssistantView"]],
]);

test("keeps the Assistant component modules explicit and outside FloorOpsApp", async () => {
  const directoryUrl = new URL("app/assistant/components/", root);
  const files = (await readdir(directoryUrl)).filter((file) => file.endsWith(".tsx")).sort();
  assert.deepEqual(files, [...expectedAssistantComponents.keys()].sort());

  const app = await read("app/FloorOpsApp.tsx");
  for (const [file, exports] of expectedAssistantComponents) {
    const source = await read(`app/assistant/components/${file}`);
    for (const exportedName of exports) {
      assert.match(source, new RegExp(`export function ${exportedName}\\b`), `${file} must export ${exportedName}`);
      assert.doesNotMatch(app, new RegExp(`function ${exportedName}\\b`), `${exportedName} must not be defined in FloorOpsApp`);
    }
  }
});

test("keeps Assistant-only evidence details and a narrow project contract in AssistantView", async () => {
  const [app, assistant] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/assistant/components/AssistantView.tsx"),
  ]);

  assert.match(assistant, /export type AssistantCitation = \{ id: string; label: string; detail: string \};/);
  assert.match(assistant, /function SourceDetailModal\(/);
  assert.match(assistant, /type AssistantProject = \{\s*id: string;\s*number: string;\s*name: string;\s*\};/);
  assert.doesNotMatch(assistant, /FloorOpsApp|type Project\b/);

  assert.match(app, /import \{ AssistantView \} from "\.\/assistant\/components\/AssistantView";/);
  assert.match(app, /<AssistantView projects=\{projectItems\} \/>/);
  assert.doesNotMatch(app, /\btype AssistantCitation\b|function AssistantView\b|function SourceDetailModal\b/);
});
