export const APPLICATION_CONTENT_SECURITY_POLICY =
  "frame-src 'self' https://www.google.com; connect-src 'self' https://places.googleapis.com";

function contentSecurityPolicyWithGoogleMapsSources(existingPolicy: string | null) {
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
  const connectSources = directives
    .filter((directive) => /^connect-src(?:\s|$)/i.test(directive))
    .flatMap((directive) => directive.split(/\s+/).slice(1))
    .filter((source) => source.toLowerCase() !== "'none'");
  const requiredConnectSources = ["'self'", "https://places.googleapis.com"];
  const uniqueConnectSources = [...new Set([...connectSources, ...requiredConnectSources])];
  const retainedDirectives = directives.filter((directive) => (
    !/^frame-src(?:\s|$)/i.test(directive)
    && !/^connect-src(?:\s|$)/i.test(directive)
  ));
  return [
    ...retainedDirectives,
    `frame-src ${uniqueFrameSources.join(" ")}`,
    `connect-src ${uniqueConnectSources.join(" ")}`,
  ].join("; ");
}

export function applyApplicationSecurityHeaders(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) return response;

  const headers = new Headers(response.headers);
  headers.set(
    "Content-Security-Policy",
    contentSecurityPolicyWithGoogleMapsSources(headers.get("Content-Security-Policy")),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
