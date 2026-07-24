import type { GoogleFetch } from "./google-oauth";

export const GOOGLE_PROVIDER_TIMEOUT_MS = 20_000;
const GOOGLE_RETRY_BASE_DELAY_MS = 125;
const GOOGLE_RETRY_JITTER_MS = 125;

export type GoogleFetchPolicy = Readonly<{
  /**
   * Opt in only when replaying the exact request cannot duplicate a mutation.
   * Ambiguous provider failures may arrive after Google committed a write.
   */
  idempotent?: boolean;
}>;

export type GoogleFetchResilienceDependencies = Readonly<{
  timeoutSignal?: (milliseconds: number) => AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}>;

function timeoutSignal(
  dependencies: GoogleFetchResilienceDependencies,
) {
  const createTimeout = dependencies.timeoutSignal
    ?? ((milliseconds: number) => AbortSignal.timeout(milliseconds));
  return createTimeout(GOOGLE_PROVIDER_TIMEOUT_MS);
}

function requestSignal(
  existing: AbortSignal | null | undefined,
  timeout: AbortSignal,
) {
  return existing ? AbortSignal.any([existing, timeout]) : timeout;
}

function retryDelay(
  dependencies: GoogleFetchResilienceDependencies,
) {
  const sample = (dependencies.random ?? Math.random)();
  const boundedSample = Number.isFinite(sample)
    ? Math.min(1, Math.max(0, sample))
    : 0;
  return GOOGLE_RETRY_BASE_DELAY_MS
    + Math.floor(boundedSample * GOOGLE_RETRY_JITTER_MS);
}

/**
 * Bounds every Google provider attempt and permits one 429/503 retry only when
 * the exact call site explicitly proves that replay is idempotent.
 */
export async function fetchGoogleProvider(
  fetcher: GoogleFetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
  policy: GoogleFetchPolicy = {},
  dependencies: GoogleFetchResilienceDependencies = {},
) {
  const sleep = dependencies.sleep
    ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  // One deadline spans both attempts, so a retry cannot double the per-call
  // budget and let a bounded directory-sync batch outlive its five-minute lease.
  const signal = requestSignal(init.signal, timeoutSignal(dependencies));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetcher(input, {
      ...init,
      signal,
    });
    const mayRetry = policy.idempotent === true
      && attempt === 0
      && (response.status === 429 || response.status === 503);
    if (!mayRetry) return response;
    await sleep(retryDelay(dependencies));
  }
  throw new Error("The bounded Google provider retry loop exited unexpectedly.");
}
