import assert from "node:assert/strict";
import test from "node:test";
import { responseOutputText } from "../app/api/v1/assistant/response-output.ts";

test("extracts structured text from a raw Responses API REST object", () => {
  const structured = JSON.stringify({ answer: "Grounded answer", citationIds: ["project:1"], missingEvidence: "" });
  assert.equal(responseOutputText({
    output: [{ type: "message", content: [{ type: "output_text", text: structured, annotations: [] }] }],
  }), structured);
});

test("prefers raw nested output and supports the SDK convenience field defensively", () => {
  assert.equal(responseOutputText({
    output_text: "SDK fallback",
    output: [{ content: [{ type: "output_text", text: "Raw REST output" }] }],
  }), "Raw REST output");
  assert.equal(responseOutputText({ output_text: "SDK fallback" }), "SDK fallback");
});

test("does not treat input or non-text response items as generated output", () => {
  assert.equal(responseOutputText({ output: [{ content: [{ type: "input_text", text: "not generated" }] }] }), null);
  assert.equal(responseOutputText(null), null);
});
