import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WORKSPACE_BLUEPRINT_LIMITS,
  WorkspaceBlueprintValidationError,
  flattenWorkspaceBlueprintFolders,
  resolveWorkspaceBlueprintFolderNames,
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

  assert.equal(seed.drive.sharedDriveName, "FCI Operations");
  assert.deepEqual(legacyRoots, [
    "00_Company Admin / Client Directory (Google Sheet)",
    "01_Client Accounts / {CLIENT_CODE} — {CLIENT_NAME} / 00_Client Profile & Master Documents",
    "02_Projects / {YEAR} / {PROJECT_NUMBER} — {PROJECT_NAME}",
    "99_Archive",
    "99_Unsorted Intake",
  ]);
  assert.deepEqual(projectPaths, [
    "00_Admin",
    "01_Lead & Proposal",
    "02_Contract & Submittals",
    "03_Schedule & Field",
    "04_Photos & QA",
    "05_Correspondence / Email Archive",
    "05_Correspondence / Email Attachments",
    "06_Closeout",
  ]);
  assert.deepEqual(seed.gmail.labels.map((label) => label.name), ["FCI/Intake", "FCI/Needs Review", "FCI/Filed"]);
  assert.deepEqual(seed.calendars.map((calendar) => calendar.name), [
    "FCI • Client Appointments",
    "FCI • Field Schedule",
    "FCI Holidays",
  ]);
  assert.ok(seed.calendars.every((calendar) => calendar.workingHours.days.length > 0));
  assert.equal(seed.spreadsheets[0].role, "system-mirror");
  assert.equal(Object.isFrozen(seed), true);
  assert.equal(Object.isFrozen(seed.drive.roots), true);
});

test("folder naming substitutes only the blueprint's closed context tokens", () => {
  const blueprint = draft();
  blueprint.naming.clientFolderPattern = "{name} ({code})";
  blueprint.naming.projectFolderPattern = "{year} · {name} · {number}";
  assert.deepEqual(
    resolveWorkspaceBlueprintFolderNames(sanitizeWorkspaceBlueprint(blueprint), {
      clientCode: "CL-042",
      clientName: "FCI TEST Client",
      projectNumber: "PR-009",
      projectName: "FCI TEST Project",
      year: "2027",
    }),
    {
      clientFolderName: "FCI TEST Client (CL-042)",
      projectFolderName: "2027 · FCI TEST Project · PR-009",
    },
  );
});

test("sanitizer accepts owner edits and normalizes detached data", () => {
  const value = draft();
  value.business.displayName = "  FCI TEST — DO NOT USE  ";
  value.drive.roots[0].name = "00_Administration";
  value.drive.roots.push({ key: "year-2027", name: "2027", management: "owner", children: [] });
  value.templates.push({ key: "site-walk", name: "Site Walk", kind: "doc", targetFolderKey: "year-2027", management: "owner" });
  value.spreadsheets.push({ key: "legacy-ledger", name: "Legacy Project Ledger", targetFolderKey: "year-2027", management: "owner", role: "reference" });
  value.calendars[0].name = "FCI • Consultations";
  value.calendars[0].defaultEventMinutes = 75;
  value.calendars[0].workingHours = { days: ["monday", "wednesday"], start: "09:00", end: "16:30" };

  const sanitized = sanitizeWorkspaceBlueprint(value);
  assert.equal(sanitized.business.displayName, "FCI TEST — DO NOT USE");
  assert.equal(sanitized.drive.roots.at(-1).key, "year-2027");
  assert.equal(sanitized.templates.at(-1).targetFolderKey, "year-2027");
  assert.equal(sanitized.spreadsheets.at(-1).role, "reference");
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
    ["client directory role", (value) => { value.spreadsheets[0].role = "import"; }, "blueprint.spreadsheets[client-directory]"],
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
        value.spreadsheets.push({ key: `sheet-${index}`, name: `Sheet ${index}`, targetFolderKey: "company-admin", management: "owner", role: "reference" });
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

// Reproduced review defect: the sanitizer enforced unique KEYS but never unique sibling NAMES,
// so two clicks of "Add folder" saved two siblings both named "New folder". Drive resolves a
// blueprint folder by name whenever no stamped folder exists yet, so live provisioning adopted
// the first sibling for both keys and threw drive_folder_identity_conflict mid-walk — while
// simulation reported the very same blueprint as provisioned. Rejecting the state at save time
// is what restores live/simulation parity.
test("sibling folders cannot share a name within one scope", async (t) => {
  for (const [collection, colliding] of [
    ["roots", "99_Archive"],
    ["clientFolders", "Projects (shortcuts only)"],
    ["projectFolders", "06_Closeout"],
  ]) {
    await t.test(collection, () => {
      const error = validationError((value) => {
        value.drive[collection].push({ key: "new-folder", name: colliding, management: "owner", children: [] });
      });
      assert.match(error.message, /duplicates the sibling folder name/u);
      assert.ok(error.message.includes(colliding), `${error.message} should name the collision`);
      assert.match(error.path, new RegExp(`^blueprint\\.drive\\.${collection}\\[\\d+\\]\\.name$`, "u"));
    });
  }

  await t.test("nested siblings", () => {
    const error = validationError((value) => {
      value.drive.roots.find((folder) => folder.key === "company-admin").children.push({
        key: "new-folder",
        name: "Templates",
        management: "owner",
        children: [],
      });
    });
    assert.match(error.message, /duplicates the sibling folder name Templates\./u);
    assert.match(error.path, /^blueprint\.drive\.roots\[0\]\.children\[1\]\.name$/u);
  });

  await t.test("comparison is trimmed and case-insensitive", () => {
    const error = validationError((value) => {
      value.drive.projectFolders.push({ key: "new-folder", name: "  06_closeout  ", management: "owner", children: [] });
    });
    assert.match(error.message, /duplicates the sibling folder name 06_closeout\./u);
  });
});

// Sibling-name uniqueness is a WRITE rule. Persisted blueprints are re-sanitized on every read,
// so enforcing it there would make a blueprint saved before the rule existed throw on load and
// take down the settings screen that is the only place to repair it — trading one permanently
// bricked state for a worse one. The read path opts out; nothing else may.
test("an already-persisted duplicate sibling name still loads so it stays repairable", () => {
  const value = draft();
  value.drive.projectFolders.push({ key: "new-folder", name: "06_Closeout", management: "owner", children: [] });

  assert.throws(() => sanitizeWorkspaceBlueprint(value), WorkspaceBlueprintValidationError);
  const tolerated = sanitizeWorkspaceBlueprint(value, { enforceUniqueSiblingNames: false });
  assert.equal(tolerated.drive.projectFolders.filter((folder) => folder.name === "06_Closeout").length, 2);
  // Opting out relaxes only this rule — every other contract still applies.
  assert.throws(
    () => sanitizeWorkspaceBlueprint({ ...value, naming: { ...value.naming, clientFolderPattern: "{name}" } }, { enforceUniqueSiblingNames: false }),
    WorkspaceBlueprintValidationError,
  );
});

// The rule is per sibling set, not global: folders in different collections and at different
// depths are created under different Drive parents, so reusing one name across them is normal.
test("the same folder name may be reused across scopes and depths", () => {
  const value = draft();
  value.drive.clientFolders.push({ key: "client-photos", name: "Photos", management: "owner", children: [] });
  value.drive.projectFolders.push({ key: "project-photos", name: "Photos", management: "owner", children: [] });
  value.drive.roots.find((folder) => folder.key === "company-admin").children.push({
    key: "admin-photos",
    name: "Photos",
    management: "owner",
    children: [],
  });
  value.drive.roots.push({ key: "photos-root", name: "Photos", management: "owner", children: [] });

  const sanitized = sanitizeWorkspaceBlueprint(value);
  assert.equal(sanitized.drive.clientFolders.find((folder) => folder.key === "client-photos").name, "Photos");
  assert.equal(sanitized.drive.projectFolders.find((folder) => folder.key === "project-photos").name, "Photos");
  assert.equal(sanitized.drive.roots.find((folder) => folder.key === "photos-root").name, "Photos");
  assert.equal(
    sanitized.drive.roots.find((folder) => folder.key === "company-admin").children.find((folder) => folder.key === "admin-photos").name,
    "Photos",
  );
});

// The editor must not mint the collision the sanitizer now rejects, or "Add folder" twice would
// meet a validation error instead of adding a folder. The helpers stay unexported because
// settings-component-boundaries pins this module's single export, so pin the wiring by source.
test("the blueprint editor mints a unique default name for each added sibling", async () => {
  const editor = await readFile(new URL("../app/settings/components/WorkspaceBlueprintEditor.tsx", import.meta.url), "utf8");
  assert.match(editor, /function unusedFolderName\(base: string, existing: Set<string>\)[\s\S]{0,220}\$\{base\} \$\{suffix\+\+\}/u);
  assert.match(editor, /function siblingFolderNames\([\s\S]{0,400}folder\.name\.trim\(\)\.toLowerCase\(\)/u);
  assert.match(editor, /const name = unusedFolderName\("New folder", siblingFolderNames\(next\.drive\[collection\], parentKey\)\);/u);
  assert.match(editor, /const folder: FolderDraft = \{ key, name, management: "owner", children: \[\] \};/u);
});

test("spreadsheet roles accept import and reference while reserving system-mirror", () => {
  const value = draft();
  value.spreadsheets.push(
    { key: "first-run-import", name: "First-run Import", targetFolderKey: "company-admin", management: "owner", role: "import" },
    { key: "project-ledger", name: "Project Ledger", targetFolderKey: "company-admin", management: "owner", role: "reference" },
  );
  assert.deepEqual(
    sanitizeWorkspaceBlueprint(value).spreadsheets.map((spreadsheet) => spreadsheet.role),
    ["system-mirror", "import", "reference"],
  );

  const invalidRole = validationError((blueprint) => {
    blueprint.spreadsheets.push({ key: "bad-role", name: "Bad Role", targetFolderKey: "company-admin", management: "owner", role: "write-back" });
  });
  assert.equal(invalidRole.path, "blueprint.spreadsheets[1].role");

  const ownerMirror = validationError((blueprint) => {
    blueprint.spreadsheets.push({ key: "owner-mirror", name: "Owner Mirror", targetFolderKey: "company-admin", management: "owner", role: "system-mirror" });
  });
  assert.equal(ownerMirror.path, "blueprint.spreadsheets[owner-mirror].role");
});

test("spreadsheet targets stay in the Shared Drive root tree while templates retain per-record targets", async (t) => {
  for (const [collection, targetFolderKey] of [
    ["client", "client-profile"],
    ["project", "admin"],
  ]) {
    await t.test(`rejects a ${collection} folder target for a spreadsheet`, () => {
      const error = validationError((value) => {
        value.spreadsheets.push({
          key: `${collection}-sheet`,
          name: `${collection} sheet`,
          targetFolderKey,
          management: "owner",
          role: "reference",
        });
      });

      assert.equal(error.path, "blueprint.spreadsheets[1].targetFolderKey");
      assert.match(error.message, /Shared Drive root-tree folder key/u);
    });
  }

  const value = draft();
  value.templates.push(
    { key: "client-template", name: "Client template", kind: "doc", targetFolderKey: "client-profile", management: "owner" },
    { key: "project-template", name: "Project template", kind: "doc", targetFolderKey: "admin", management: "owner" },
  );

  assert.deepEqual(
    sanitizeWorkspaceBlueprint(value).templates.slice(-2).map((template) => template.targetFolderKey),
    ["client-profile", "admin"],
  );
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
