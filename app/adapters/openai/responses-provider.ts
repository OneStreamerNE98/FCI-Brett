import type {
  AssistantProvider,
  AssistantProviderCompletion,
  AssistantProviderRequest,
} from "../../ports/assistant-provider";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type OpenAIResponsesProviderOptions = {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMilliseconds?: number;
};

export type OpenAIModelLookupResult = Readonly<
  | { ok: true; model: string }
  | { ok: false; model: string; reason: string; status: number }
>;

type OpenAIContinuation = {
  input: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerErrorMessage(value: unknown, secrets: readonly string[] = []) {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  if (typeof value.error.message !== "string") return null;
  let message = value.error.message
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .trim();
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message ? message.slice(0, 500) : null;
}

/** Validates a caller-supplied model against the provider; no local allowlist. */
export async function lookupOpenAIModel(input: Readonly<{
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
}>): Promise<OpenAIModelLookupResult> {
  const model = input.model.trim();
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${input.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return Object.freeze({
      ok: false,
      model,
      reason: "OpenAI model validation is temporarily unavailable. Try again.",
      status: 503,
    });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return Object.freeze({
      ok: false,
      model,
      reason: providerErrorMessage(body, [input.apiKey])
        ?? `OpenAI model lookup failed with status ${response.status}.`,
      status: response.status,
    });
  }
  if (!isRecord(body) || typeof body.id !== "string" || body.id !== model) {
    return Object.freeze({
      ok: false,
      model,
      reason: "OpenAI returned an unexpected model record.",
      status: 502,
    });
  }
  return Object.freeze({ ok: true, model });
}

function continuationInput(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.input)) return null;
  return value.input;
}

/** The raw Responses wire shape is deliberately isolated in this adapter. */
export function responseOutputText(value: unknown) {
  if (!isRecord(value)) return null;
  const chunks: string[] = [];
  if (Array.isArray(value.output)) {
    for (const item of value.output) {
      if (!isRecord(item) || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (!isRecord(part)) continue;
        if (part.type === "output_text" && typeof part.text === "string") {
          chunks.push(part.text);
        }
      }
    }
  }
  const nestedOutput = chunks.join("").trim();
  if (nestedOutput) return nestedOutput;
  return typeof value.output_text === "string" && value.output_text.trim()
    ? value.output_text
    : null;
}

function providerInput(request: AssistantProviderRequest) {
  const previous = continuationInput(request.continuation);
  const initial = request.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const toolOutputs = (request.toolOutputs ?? []).map((item) => ({
    type: "function_call_output",
    call_id: item.callId,
    output: item.output,
  }));
  return [...(previous ?? initial), ...toolOutputs];
}

function completionFromResponse(
  response: unknown,
  input: unknown[],
): AssistantProviderCompletion {
  if (!isRecord(response)) throw new Error("OpenAI Responses returned an invalid object.");
  const rawOutput = Array.isArray(response.output) ? response.output : [];
  const calls = rawOutput.flatMap((item) => {
    if (
      !isRecord(item)
      || item.type !== "function_call"
      || typeof item.call_id !== "string"
      || typeof item.name !== "string"
      || typeof item.arguments !== "string"
    ) {
      return [];
    }
    let parsedArguments: unknown = null;
    try {
      parsedArguments = JSON.parse(item.arguments);
    } catch {
      parsedArguments = null;
    }
    return [{
      callId: item.call_id,
      name: item.name,
      arguments: parsedArguments,
    }];
  });
  if (calls.length > 0) {
    const continuation: OpenAIContinuation = {
      input: [...input, ...rawOutput],
    };
    return { kind: "tool-calls", calls, continuation };
  }
  const outputText = responseOutputText(response);
  if (!outputText) throw new Error("OpenAI Responses did not return structured output.");
  try {
    return { kind: "output", value: JSON.parse(outputText) };
  } catch {
    throw new Error("OpenAI Responses returned malformed structured output.");
  }
}

function beforeAbort<T>(operation: () => Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("OpenAI request aborted."));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason;
      return operation();
    }).then(
      (response) => {
        signal.removeEventListener("abort", abort);
        resolve(response);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export class OpenAIResponsesProvider implements AssistantProvider {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMilliseconds: number;

  constructor(options: OpenAIResponsesProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? "gpt-5.4";
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 20_000;
  }

  async complete(request: AssistantProviderRequest) {
    const input = providerInput(request);
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(request.signal.reason);
    if (request.signal.aborted) abortFromCaller();
    else request.signal.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);
    try {
      const responseData = await beforeAbort(async () => {
        const response = await this.#fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.#model,
            store: false,
            input,
            ...(request.tools.length > 0
              ? {
                  tools: request.tools.map((tool) => ({
                    type: "function",
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                    strict: true,
                  })),
                }
              : {}),
            text: {
              format: {
                type: "json_schema",
                name: request.output.name,
                strict: true,
                schema: request.output.schema,
              },
            },
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const reason = providerErrorMessage(body, [this.#apiKey]);
          if (response.status === 404) {
            throw new Error(
              `OpenAI model "${this.#model}" was not found or is unavailable${reason ? `: ${reason}` : "."}`,
            );
          }
          throw new Error(
            reason
              ? `OpenAI Responses failed for model "${this.#model}": ${reason}`
              : `OpenAI Responses failed for model "${this.#model}" with status ${response.status}.`,
          );
        }
        return body;
      }, controller.signal);
      return completionFromResponse(responseData, input);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abortFromCaller);
    }
  }
}
