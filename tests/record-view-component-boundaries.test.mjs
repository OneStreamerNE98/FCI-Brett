import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const viewContracts = [
  {
    directory: "leads",
    expectedFiles: ["LeadsView.tsx"],
    file: "LeadsView.tsx",
    exportName: "LeadsView",
    recordTypes: ["Lead", "LiveDataState"],
  },
  {
    directory: "clients",
    expectedFiles: ["ClientsView.tsx"],
    file: "ClientsView.tsx",
    exportName: "ClientsView",
    recordTypes: ["Client", "LiveDataState"],
  },
  {
    directory: "projects",
    expectedFiles: ["ProjectFilesPanel.tsx", "ProjectsView.tsx"],
    file: "ProjectsView.tsx",
    exportName: "ProjectsView",
    recordTypes: ["Project", "LiveDataState"],
  },
  {
    directory: "schedule",
    expectedFiles: ["ScheduleView.tsx"],
    file: "ScheduleView.tsx",
    exportName: "ScheduleView",
    recordTypes: ["DashboardSummary"],
  },
];

test("keeps each record-view component directory explicit", async () => {
  for (const { directory, expectedFiles } of viewContracts) {
    const directoryUrl = new URL(`app/${directory}/components/`, root);
    const files = (await readdir(directoryUrl)).filter((file) => file.endsWith(".tsx")).sort();
    assert.deepEqual(files, expectedFiles, `${directory} must keep its exact record-view component census`);
  }
});

test("keeps record views exported from their modules and outside FloorOpsApp", async () => {
  const app = await read("app/FloorOpsApp.tsx");

  for (const { directory, file, exportName } of viewContracts) {
    const source = await read(`app/${directory}/components/${file}`);
    assert.match(source, new RegExp(`export function ${exportName}\\b`), `${file} must export ${exportName}`);
    assert.doesNotMatch(app, new RegExp(`function ${exportName}\\b`), `${exportName} must not be defined in FloorOpsApp`);
  }
});

test("keeps record contracts shared and data loading out of record views", async () => {
  const forbiddenDataLoading = /\b(?:cachedGetJson|useCachedGetSubscription|invalidateCachedGet)\b|\bfetch\s*\(/;

  for (const { directory, file, recordTypes } of viewContracts) {
    const source = await read(`app/${directory}/components/${file}`);
    assert.match(
      source,
      /import type \{[\s\S]*?\} from "\.\.\/\.\.\/lib\/record-types";/,
      `${file} must import its record contract from app/lib/record-types`,
    );
    for (const recordType of recordTypes) {
      assert.doesNotMatch(
        source,
        new RegExp(`\\b(?:type|interface)\\s+${recordType}\\b`),
        `${file} must not redeclare ${recordType}`,
      );
    }
    assert.doesNotMatch(
      source,
      forbiddenDataLoading,
      `${file} must remain presentation-only and must not fetch or subscribe to cached data`,
    );
  }
});
