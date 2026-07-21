import assert from "node:assert/strict";
import test from "node:test";

import {
  DRIVE_BLUEPRINT,
  WORKSPACE_BLUEPRINT_LIMITS,
  WorkspaceBlueprintValidationError,
  flattenWorkspaceBlueprintFolders,
  sanitizeWorkspaceBlueprint,
  seedWorkspaceBlueprint,
  summarizeWorkspaceBlueprintChanges,
} from "../app/lib/workspace-blueprint.ts";

function draft() {
  return structuredClone(seedWorkspaceBlueprint());
}

function validationError(mutator) {
  const value = draft();
  mutator(value);
  try {
    sanitizeWorkspaceBlueprint(value);
  } catch (error) {
    assert.ok(error instanceof WorkspaceBlueprintValidationError);
    return error;
  }
  throw new Error("Expected validation to fail.");
}

test("seed preserves the legacy Drive/Gmail contract and includes FCI Holidays", () => {
  const seed = seedWorkspaceBlueprint();
  const projectPaths = seed.drive.projectFolders.flatMap((folder) => (
    folder.children.length
      ? folder.children.map((child) => `${folder.name} / ${child.name}`)
      : [folder.name]
  ));
  const legacyRoots = [
    `${seed.drive.roots.find((folder) => folder.key === "company-admin").name} / Client Directory (Google Sheet)`,
    `${seed.drive.roots.find((folder) => folder.key === "client-accounts").name} / {CLIENT_CODE} — {CLIENT_NAME} / ${seed.drive.clientFolders.find((folder) => folder.key === "client-profile").name}`,
    `${seed.drive.roots.find((folder) => folder.key === "projects").name} / {YEAR} / {PROJECT_NUMBER} — {PROJECT_NAME}`,
    seed.drive.roots.find((folder) => folder.key === "archive").name,
    seed.drive.roots.find((folder) => folder.key === "unsorted-intake").name,
  ];

  assert.equal(seed.drive.sharedDriveName, DRIVE_BLUEPRINT.sharedDriveName);
  assert.deepEqual(legacyRoots, [...DRIVE_BLUEPRINT.roots]);
  assert.deepEqual(projectPaths, [...DRIVE_BLUEPRINT.projectFolders]);
  assert.deepEqual(seed.gmail.labels.map((label) => label.name), [...DRIVE_BLUEPRINT.gmailLabels]);
  assert.deepEqual(seed.calendars.map((calendar) => calendar.name), [
    "FCI • Client Appointments",
    "FCI • Field Schedule",
    "FCI Holidays",
  ]);
  assert.ok(seed.calendars.every((calendar) => calendar.workingHours.days.length > 0));
  assert.equal(Object.isFrozen(seed), true);
  assert.equal(Object.isFrozen(seed.drive.roots), true);
});

test("sanitizer accepts owner edits and normalizes detached data", () => {
  const value = draft();
  value.business.displayName = "  FCI TEST — DO NOT USE  ";
  value.drive.roots[0].name = "00_Administration";
  value.drive.roots.push({ key: "year-2027", name: "2027", management: "owner", children: [] });
  value.templates.push({ key: "site-walk", name: "Site Walk", kind: "doc", targetFolderKey: "year-2027", management: "owner" });
  value.calendars[0].name = "FCI • Consultations";
  value.calendars[0].defaultEventMinutes = 75;
  value.calendars[0].workingHours = { days: ["monday", "wednesday"], start: "09:00", end: "16:30" };

  const sanitized = sanitizeWorkspaceBlueprint(value);
  assert.equal(sanitized.business.displayName, "FCI TEST — DO NOT USE");
  assert.equal(sanitized.drive.roots.at(-1).key, "year-2027");
  assert.equal(sanitized.templates.at(-1).targetFolderKey, "year-2027");
  assert.equal(sanitized.calendars[0].defaultEventMinutes, 75);
  assert.equal(Object.isFrozen(sanitized.templates), true);
  assert.ok(flattenWorkspaceBlueprintFolders(sanitized).some((folder) => folder.path === "Shared Drive / 2027"));
});

test("sanitizer names exact locked system paths", async (t) => {
  const cases = [
    ["unsorted intake", (value) => { value.drive.roots.find((folder) => folder.key === "unsorted-intake").name = "Inbox"; }, "blueprint.drive.roots[unsorted-intake].name"],
    ["unsorted intake root location", (value) => {
      const index = value.drive.roots.findIndex((folder) => folder.key === "unsorted-intake");
      const [folder] = value.drive.roots.splice(index, 1);
      value.drive.roots[0].children.push(folder);
    }, "blueprint.drive.roots[unsorted-intake]"],
    ["correspondence subtree", (value) => { value.drive.projectFolders.find((folder) => folder.key === "correspondence").children[0].name = "Mail"; }, "blueprint.drive.projectFolders[correspondence].children[email-archive].name"],
    ["client directory", (value) => { value.spreadsheets[0].targetFolderKey = "archive"; }, "blueprint.spreadsheets[client-directory]"],
    ["FCI label", (value) => { value.gmail.labels[0].name = "Inbox"; }, "blueprint.gmail.labels[intake]"],
    ["calendar key", (value) => { value.calendars.find((calendar) => calendar.key === "holidays").key = "days-off"; }, "blueprint.calendars[holidays].key"],
  ];
  for (const [name, mutate, path] of cases) {
    await t.test(name, () => {
      const error = validationError(mutate);
      assert.equal(error.path, path);
      assert.match(error.message, /system-managed/u);
    });
  }
});

test("sanitizer enforces folder keys, names, depth, counts, tokens, and references", async (t) => {
  const cases = [
    ["slug key", (value) => { value.drive.roots[0].key = "Bad Key"; }, "blueprint.drive.roots[0].key"],
    ["folder separator", (value) => { value.drive.roots[0].name = "Admin/Files"; }, "blueprint.drive.roots[0].name"],
    ["depth", (value) => { value.drive.roots[0].children[0].children.push({ key: "too-deep", name: "Too deep", management: "owner", children: [] }); }, "blueprint.drive.roots[0].children[0].children"],
    ["folder count", (value) => {
      while (flattenWorkspaceBlueprintFolders(value).length <= WORKSPACE_BLUEPRINT_LIMITS.folders) {
        const index = flattenWorkspaceBlueprintFolders(value).length;
        value.drive.roots.push({ key: `extra-${index}`, name: `Extra ${index}`, management: "owner", children: [] });
      }
    }, "blueprint.drive"],
    ["template count", (value) => {
      while (value.templates.length <= WORKSPACE_BLUEPRINT_LIMITS.templates) {
        const index = value.templates.length;
        value.templates.push({ key: `template-${index}`, name: `Template ${index}`, kind: "doc", targetFolderKey: "templates", management: "owner" });
      }
    }, "blueprint.templates"],
    ["spreadsheet count", (value) => {
      while (value.spreadsheets.length <= WORKSPACE_BLUEPRINT_LIMITS.spreadsheets) {
        const index = value.spreadsheets.length;
        value.spreadsheets.push({ key: `sheet-${index}`, name: `Sheet ${index}`, targetFolderKey: "company-admin", management: "owner" });
      }
    }, "blueprint.spreadsheets"],
    ["unknown token", (value) => { value.naming.projectFolderPattern = "{number} — {name} — {client}"; }, "blueprint.naming.projectFolderPattern"],
    ["required token", (value) => { value.naming.clientFolderPattern = "{name}"; }, "blueprint.naming.clientFolderPattern"],
    ["folder reference", (value) => { value.templates[0].targetFolderKey = "missing-folder"; }, "blueprint.templates[0].targetFolderKey"],
  ];
  for (const [name, mutate, pathPrefix] of cases) {
    await t.test(name, () => {
      const error = validationError(mutate);
      assert.ok(error.path.startsWith(pathPrefix), `${error.path} should start with ${pathPrefix}`);
    });
  }
});

test("change summary is bounded and contains no blueprint names", () => {
  const before = seedWorkspaceBlueprint();
  const after = draft();
  after.business.displayName = "FCI TEST PRIVATE DISPLAY NAME";
  after.drive.roots[0].name = "Private administration name";
  after.templates.push({ key: "new-template", name: "Private template name", kind: "doc", targetFolderKey: "templates", management: "owner" });
  const summary = summarizeWorkspaceBlueprintChanges(before, sanitizeWorkspaceBlueprint(after));

  assert.match(summary, /^folders=\+0\/-0\/~2;templates=\+1\/-0\/~0;/u);
  assert.match(summary, /business=changed/u);
  assert.equal(summary.includes("Private"), false);
  assert.ok(summary.length < 256);
});
