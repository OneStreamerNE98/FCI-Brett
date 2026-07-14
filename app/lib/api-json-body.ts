export type JsonObjectBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string; status: 400 | 413 };

type JsonObjectBodyOptions = {
  maximumBytes: number;
  invalidMessage: string;
  tooLargeMessage: string;
};

function invalidResult(options: JsonObjectBodyOptions): JsonObjectBodyResult {
  return { ok: false, error: options.invalidMessage, status: 400 };
}

function tooLargeResult(options: JsonObjectBodyOptions): JsonObjectBodyResult {
  return { ok: false, error: options.tooLargeMessage, status: 413 };
}

/**
 * Reads a JSON object without buffering more than the route's byte allowance.
 * Content-Length is an early rejection only; the streamed byte count remains
 * authoritative because clients can omit or misstate that header.
 */
export async function parseBoundedJsonObject(
  request: Request,
  options: JsonObjectBodyOptions,
): Promise<JsonObjectBodyResult> {
  if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1) {
    throw new Error("maximumBytes must be a positive safe integer.");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > options.maximumBytes) {
    return tooLargeResult(options);
  }

  const reader = request.body?.getReader();
  if (!reader) return invalidResult(options);

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let rawBody = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > options.maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return tooLargeResult(options);
      }
      rawBody += decoder.decode(value, { stream: true });
    }
    rawBody += decoder.decode();
  } catch {
    return invalidResult(options);
  }

  try {
    const body = JSON.parse(rawBody) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return invalidResult(options);
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return invalidResult(options);
  }
}
