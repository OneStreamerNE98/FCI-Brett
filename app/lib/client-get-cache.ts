type CachedJsonOptions = {
  force?: boolean;
  ttlMs?: number;
};

type CachedJsonEntry = {
  expiresAt: number;
  hasValue: boolean;
  value?: unknown;
  inFlight?: Promise<unknown>;
};

const DEFAULT_TTL_MS = 15_000;
const jsonGetCache = new Map<string, CachedJsonEntry>();

/**
 * Shares short-lived same-origin GETs across panels without retaining errors.
 * Mutations must invalidate their corresponding URL explicitly.
 */
export function cachedGetJson<T>(url: string, options: CachedJsonOptions = {}): Promise<T> {
  const existing = jsonGetCache.get(url);
  if (!options.force && existing?.inFlight) return existing.inFlight as Promise<T>;
  if (!options.force && existing?.hasValue && existing.expiresAt > Date.now()) {
    return Promise.resolve(existing.value as T);
  }

  const ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS);
  const request = fetch(url, { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`GET ${url} failed (${response.status})`);
      return response.json() as Promise<T>;
    })
    .then((value) => {
      if (jsonGetCache.get(url)?.inFlight === request) {
        jsonGetCache.set(url, { expiresAt: Date.now() + ttlMs, hasValue: true, value });
      }
      return value;
    })
    .catch((error) => {
      if (jsonGetCache.get(url)?.inFlight === request) jsonGetCache.delete(url);
      throw error;
    });

  jsonGetCache.set(url, { expiresAt: 0, hasValue: false, inFlight: request });
  return request;
}

export function invalidateCachedGet(url: string) {
  jsonGetCache.delete(url);
}

export function clearCachedGets() {
  jsonGetCache.clear();
}
