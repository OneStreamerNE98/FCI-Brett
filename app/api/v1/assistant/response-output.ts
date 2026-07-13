/** Extract text from the raw REST Responses API object, with SDK support as a fallback. */
export function responseOutputText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  const chunks: string[] = [];
  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== "object" || Array.isArray(part)) continue;
        const outputPart = part as Record<string, unknown>;
        if (outputPart.type === "output_text" && typeof outputPart.text === "string") chunks.push(outputPart.text);
      }
    }
  }
  const nestedOutput = chunks.join("").trim();
  if (nestedOutput) return nestedOutput;
  return typeof response.output_text === "string" && response.output_text.trim() ? response.output_text : null;
}
