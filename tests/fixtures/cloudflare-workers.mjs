export const env = globalThis.__FCI_TEST_CLOUDFLARE_ENV__;

export function waitUntil(promise) {
  const defer = globalThis.__FCI_TEST_CLOUDFLARE_WAIT_UNTIL__;
  if (typeof defer === "function") return defer(promise);
  void promise.catch(() => undefined);
}
