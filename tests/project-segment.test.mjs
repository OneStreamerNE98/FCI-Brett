import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeProjectSegment,
  PROJECT_SEGMENTS,
  projectSegmentFromClientIndustry,
  resolveProjectSegment,
} from "../app/domain/project-segment.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("project segment is a closed two-value catalog", () => {
  assert.deepEqual([...PROJECT_SEGMENTS], ["commercial", "residential"]);
  assert.equal(normalizeProjectSegment(" COMMERCIAL "), "commercial");
  assert.equal(normalizeProjectSegment("Residential"), "residential");
  for (const invalid of [undefined, null, 42, "", "mixed", "industrial"]) {
    assert.equal(normalizeProjectSegment(invalid), null);
  }
});

test("client industry supplies the creation default without inventing a third value", () => {
  assert.equal(projectSegmentFromClientIndustry(" Residential "), "residential");
  for (const industry of ["Commercial", "Healthcare", "Hospitality", "Education", "Other", "", null, "residential-commercial"]) {
    assert.equal(projectSegmentFromClientIndustry(industry), "commercial");
  }
});

test("stored choices win and old or invalid rows widen safely from client industry", () => {
  assert.equal(resolveProjectSegment("commercial", "Residential"), "commercial");
  assert.equal(resolveProjectSegment("residential", "Commercial"), "residential");
  assert.equal(resolveProjectSegment(null, "Residential"), "residential");
  assert.equal(resolveProjectSegment(undefined, "Commercial"), "commercial");
  assert.equal(resolveProjectSegment("future-third-value", "Residential"), "residential");
  assert.equal(resolveProjectSegment("future-third-value", "Healthcare"), "commercial");
});

test("the D1 route strips the private industry join and resolves every public segment", async () => {
  const route = await read("app/api/v1/projects/route.ts");
  assert.match(route, /c\.industry AS client_industry/u);
  assert.match(route, /const \{ client_industry: clientIndustry, \.\.\.publicRecord \} = record/u);
  assert.match(route, /\.\.\.publicRecord,[\s\S]*segment: resolveProjectSegment\(record\.segment, clientIndustry\)/u);
});

test("the optional creation tap stays closed and leaving it untouched reaches server defaulting", async () => {
  const [selector, app, projectModals] = await Promise.all([
    read("app/features/projects/ProjectSegmentSelector.tsx"),
    read("app/FloorOpsApp.tsx"),
    read("app/projects/components/ProjectModals.tsx"),
  ]);

  assert.match(selector, /PROJECT_SEGMENTS\.map/u);
  assert.match(selector, /type="radio" name="segment" value=\{segment\}/u);
  assert.match(selector, /type="radio" name="segment" value=""[\s\S]*<span>Derived<\/span>/u);
  assert.equal(selector.match(/name="segment"/gu)?.length, 2);
  assert.doesNotMatch(selector, /\brequired\b|\bdefaultChecked\b/u);
  assert.match(app, /segment: project\.segment \?\? undefined/u);
  assert.match(projectModals, /const segment = normalizeProjectSegment\(form\.get\("segment"\)\)/u);
});
