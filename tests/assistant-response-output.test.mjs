import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenAIResponsesProvider,
  responseOutputText,
} from "../app/adapters/openai/responses-provider.ts";

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    citationIds: { type: "array", items: { type: "string" } },
    missingEvidence: { type: "string" },
  },
  required: ["answer", "citationIds", "missingEvidence"],
};

test("extracts structured text from a raw Responses API REST object", () => {
  const structured = JSON.stringify({
    answer: "Grounded answer",
    citationIds: ["project:1"],
    missingEvidence: "",
  });
  assert.equal(responseOutputText({
    output: [{
      type: "message",
      content: [{ type: "output_text", text: structured, annotations: [] }],
    }],
  }), structured);
});

test("prefers raw nested output and supports the convenience field defensively", () => {
  assert.equal(responseOutputText({
    output_text: "SDK fallback",
    output: [{ content: [{ type: "output_text", text: "Raw REST output" }] }],
  }), "Raw REST output");
  assert.equal(responseOutputText({ output_text: "SDK fallback" }), "SDK fallback");
});

test("does not treat input or non-text response items as generated output", () => {
  assert.equal(responseOutputText({
    output: [{ content: [{ type: "input_text", text: "not generated" }] }],
  }), null);
  assert.equal(responseOutputText(null), null);
});

test("recorded tool fixture replays reasoning and function-call output for store:false", async () => {
  const requests = [];
  const reasoning = {
    type: "reasoning",
    id: "rs_123",
    encrypted_content: "recorded-encrypted-reasoning",
    summary: [],
  };
  const functionCall = {
    type: "function_call",
    id: "fc_123",
    call_id: "call_123",
    name: "search_records",
    arguments: JSON.stringify({ query: "Atlas" }),
    status: "completed",
  };
  const fixtures = [
    { id: "resp_1", output: [reasoning, functionCall] },
    {
      id: "resp_2",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            answer: "Atlas is saved.",
            citationIds: ["client:atlas"],
            missingEvidence: "",
          }),
        }],
      }],
    },
  ];
  const provider = new OpenAIResponsesProvider({
    apiKey: "fixture-key",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return Response.json(fixtures.shift());
    },
  });
  const signal = new AbortController().signal;
  const first = await provider.complete({
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "question" },
    ],
    tools: [{
      name: "search_records",
      description: "Search records.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    }],
    output: { name: "grounded_project_answer", schema: outputSchema },
    signal,
  });
  assert.equal(first.kind, "tool-calls");
  assert.deepEqual(first.calls, [{
    callId: "call_123",
    name: "search_records",
    arguments: { query: "Atlas" },
  }]);
  const second = await provider.complete({
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "question" },
    ],
    tools: [{
      name: "search_records",
      description: "Search records.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    }],
    output: { name: "grounded_project_answer", schema: outputSchema },
    continuation: first.continuation,
    toolOutputs: [{ callId: "call_123", output: "{\"evidence\":[]}" }],
    signal,
  });
  assert.deepEqual(second, {
    kind: "output",
    value: {
      answer: "Atlas is saved.",
      citationIds: ["client:atlas"],
      missingEvidence: "",
    },
  });

  assert.equal(requests[0].model, "gpt-5.4");
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].tools[0].strict, true);
  assert.equal(requests[0].text.format.strict, true);
  assert.deepEqual(requests[1].input, [
    { role: "system", content: "system" },
    { role: "user", content: "question" },
    reasoning,
    functionCall,
    {
      type: "function_call_output",
      call_id: "call_123",
      output: "{\"evidence\":[]}",
    },
  ]);
});

test("project-only calls omit the tools field and preserve the explicit model", async () => {
  let body;
  const provider = new OpenAIResponsesProvider({
    apiKey: "fixture-key",
    model: "recorded-model",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({
        output: [{
          content: [{
            type: "output_text",
            text: JSON.stringify({
              answer: "A",
              citationIds: ["project:1"],
              missingEvidence: "M",
            }),
          }],
        }],
      });
    },
  });
  await provider.complete({
    messages: [{ role: "user", content: "question" }],
    tools: [],
    output: { name: "grounded_project_answer", schema: outputSchema },
    signal: new AbortController().signal,
  });
  assert.equal(body.model, "recorded-model");
  assert.equal(Object.hasOwn(body, "tools"), false);
});

function minimalRequest(signal) {
  return {
    messages: [{ role: "user", content: "question" }],
    tools: [],
    output: { name: "grounded_project_answer", schema: outputSchema },
    signal,
  };
}

test("non-success and malformed provider responses fail with sanitized errors", async () => {
  const failed = new OpenAIResponsesProvider({
    apiKey: "fixture-key",
    fetchImpl: async () => new Response("sensitive upstream details", {
      status: 503,
    }),
  });
  await assert.rejects(
    failed.complete(minimalRequest(new AbortController().signal)),
    (error) => {
      assert.equal(error.message, "OpenAI Responses failed with status 503.");
      assert.doesNotMatch(error.message, /sensitive upstream details/);
      return true;
    },
  );

  const malformed = new OpenAIResponsesProvider({
    apiKey: "fixture-key",
    fetchImpl: async () => Response.json({
      output: [{ content: [{ type: "output_text", text: "{not json" }] }],
    }),
  });
  await assert.rejects(
    malformed.complete(minimalRequest(new AbortController().signal)),
    /malformed structured output/,
  );
});

test("caller abort and the per-call timeout dominate a fetch that ignores abort", async () => {
  let preAbortedFetches = 0;
  const preAbortedProvider = new OpenAIResponsesProvider({
    apiKey: "fixture-key",
    fetchImpl: async () => {
      preAbortedFetches += 1;
      return Response.json({});
    },
  });
  const preAborted = new AbortController();
  preAborted.abort(new Error("already stopped"));
  await assert.rejects(
    preAbortedProvider.complete(minimalRequest(preAborted.signal)),
    /already stopped/,
  );
  assert.equal(preAbortedFetches, 0);

  const never = () => new Promise(() => {});
  const callerProvider = new OpenAIResponsesProvider({
    apiKey: "fixture-key",
    fetchImpl: never,
    timeoutMilliseconds: 10_000,
  });
  const caller = new AbortController();
  const callerRequest = callerProvider.complete(minimalRequest(caller.signal));
  caller.abort(new Error("caller stopped"));
  await assert.rejects(callerRequest, /caller stopped/);

  const timeoutProvider = new OpenAIResponsesProvider({
    apiKey: "fixture-key",
    fetchImpl: never,
    timeoutMilliseconds: 15,
  });
  await assert.rejects(
    timeoutProvider.complete(minimalRequest(new AbortController().signal)),
    (error) => error?.name === "AbortError",
  );

  let jsonCalls = 0;
  const hangingJsonProvider = new OpenAIResponsesProvider({
    apiKey: "fixture-key",
    fetchImpl: async () => ({
      ok: true,
      json() {
        jsonCalls += 1;
        return never();
      },
    }),
    timeoutMilliseconds: 15,
  });
  await assert.rejects(
    hangingJsonProvider.complete(minimalRequest(new AbortController().signal)),
    (error) => error?.name === "AbortError",
  );
  assert.equal(jsonCalls, 1);
});
