export const APPLICATION_CONTENT_SECURITY_POLICY = "frame-src 'self' https://www.google.com";

function contentSecurityPolicyWithMapsFrameSource(existingPolicy: string | null) {
  const directives = (existingPolicy ?? "")
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean);
  const frameSources = directives
    .filter((directive) => /^frame-src(?:\s|$)/i.test(directive))
    .flatMap((directive) => directive.split(/\s+/).slice(1))
    .filter((source) => source.toLowerCase() !== "'none'");
  const requiredFrameSources = ["'self'", "https://www.google.com"];
  const uniqueFrameSources = [...new Set([...frameSources, ...requiredFrameSources])];
  const retainedDirectives = directives.filter((directive) => !/^frame-src(?:\s|$)/i.test(directive));
  return [...retainedDirectives, `frame-src ${uniqueFrameSources.join(" ")}`].join("; ");
}

export function applyApplicationSecurityHeaders(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) return response;

  const headers = new Headers(response.headers);
  headers.set(
    "Content-Security-Policy",
    contentSecurityPolicyWithMapsFrameSource(headers.get("Content-Security-Policy")),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
