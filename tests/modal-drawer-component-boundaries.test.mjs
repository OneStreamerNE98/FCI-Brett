import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const overlayModules = [
  {
    path: "app/leads/components/LeadModal.tsx",
    exports: ["LeadEditConflictError", "LeadModal"],
    recordTypes: ["Lead", "LeadConflictValues", "LeadEditPatch"],
  },
  {
    path: "app/leads/components/LeadDrawer.tsx",
    exports: ["LeadDrawer"],
    recordTypes: ["Lead", "LeadEditPatch"],
  },
  {
    path: "app/clients/components/ClientModals.tsx",
    exports: ["ClientEditConflictError", "ContactEditConflictError", "ClientModal", "ClientEditModal", "ContactEditModal"],
    recordTypes: ["Client", "ClientConflictValues", "ClientEditPatch", "ContactConflictValues", "ContactEditPatch"],
  },
  {
    path: "app/clients/components/ClientDrawer.tsx",
    exports: ["ClientDrawer"],
    recordTypes: ["Client", "ClientEditPatch", "ContactEditPatch", "Project"],
  },
  {
    path: "app/projects/components/ProjectModals.tsx",
    exports: ["ProjectEditConflictError", "optionalFlooringCategory", "projectManagerLabel", "NewProjectModal", "ProjectEditModal", "InstallationDatesModal", "FollowUpResultModal"],
    recordTypes: ["Client", "Project", "ProjectConflictValues", "ProjectEditPatch"],
  },
  {
    path: "app/projects/components/ProjectDrawer.tsx",
    exports: ["ProjectDrawer"],
    recordTypes: ["Client", "Notify", "Project", "ProjectEditPatch"],
  },
  {
    path: "app/projects/components/ProjectMeetings.tsx",
    exports: ["ProjectMeetings", "MeetingModal"],
    recordTypes: ["Notify", "Project", "ProjectMeeting"],
  },
];

const shellMounts = [
  ["LeadModal", ["mode", "initialValues", "isAdmin", "mapsRuntime", "onClose", "onSave"]],
  ["ClientModal", ["mapsRuntime", "onClose", "onSave"]],
  ["NewProjectModal", ["clients", "initialClientId", "managerId", "managerLabel", "isAdmin", "mapsRuntime", "onClose", "onSave"]],
  ["LeadDrawer", ["lead", "isAdmin", "mapsRuntime", "onClose", "onAdvance", "onSaveLead", "returnFocusRef", "fallbackFocusRef"]],
  ["ProjectDrawer", ["project", "clients", "jobSiteMaps", "onClose", "notify", "onSaveProject", "onProvisionDrive", "onAssignToMe", "onRecordInstallationDates", "onRecordFollowUpResult", "onMeetingRecorded", "isAdmin", "currentUserEmail", "returnFocusRef"]],
  ["ClientDrawer", ["client", "projects", "jobSiteMaps", "onClose", "onSaveClient", "onSaveContact", "onNewProject", "onProject", "returnFocusRef"]],
];

function mountedProps(source, component) {
  const match = source.match(new RegExp(`<${component}\\b([\\s\\S]*?)\\s*/>`, "u"));
  assert.ok(match, `${component} must remain mounted by FloorOpsApp`);
  return [...match[1].matchAll(/\b([A-Za-z][A-Za-z0-9]*)=/gu)].map((entry) => entry[1]);
}

test("moves the modal and drawer cluster into explicit per-surface modules", async () => {
  const app = await read("app/FloorOpsApp.tsx");

  for (const { path, exports } of overlayModules) {
    const source = await read(path);
    assert.doesNotMatch(source, /from ["'][^"']*FloorOpsApp["']/u, `${path} must not import back into FloorOpsApp`);
    for (const exportName of exports) {
      assert.match(source, new RegExp(`export (?:class|function) ${exportName}\\b`, "u"), `${path} must export ${exportName}`);
      assert.doesNotMatch(app, new RegExp(`(?:class|function) ${exportName}\\b`, "u"), `${exportName} must not remain declared in FloorOpsApp`);
    }
  }
});

test("keeps extracted overlays on the shared record contracts", async () => {
  for (const { path, recordTypes } of overlayModules) {
    const source = await read(path);
    assert.match(source, /import type \{[\s\S]*?\} from "\.\.\/\.\.\/lib\/record-types";/u, `${path} must import shared record contracts`);
    for (const recordType of recordTypes) {
      assert.doesNotMatch(
        source,
        new RegExp(`\\b(?:type|interface)\\s+${recordType}\\b`, "u"),
        `${path} must not redeclare ${recordType}`,
      );
    }
  }
});

test("keeps the six FloorOpsApp overlay mount prop boundaries exact", async () => {
  const app = await read("app/FloorOpsApp.tsx");
  for (const [component, expectedProps] of shellMounts) {
    assert.deepEqual(mountedProps(app, component), expectedProps, `${component} shell props changed`);
  }
});
