export type AddressAutocompleteSession = Readonly<{
  token: () => string;
  complete: () => void;
}>;

/**
 * Places Autocomplete (New) and the terminating Address Validation request
 * must share one token. Completing validation closes that session so the next
 * edit cannot accidentally reuse a billable session.
 */
export function createAddressAutocompleteSession(
  createToken: () => string = () => crypto.randomUUID(),
): AddressAutocompleteSession {
  let currentToken: string | null = null;
  return Object.freeze({
    token() {
      currentToken ??= createToken();
      return currentToken;
    },
    complete() {
      currentToken = null;
    },
  });
}

/** The browser key is usable only after the WS-15 owner gate is open. */
export function placesAutocompleteBrowserKey(
  runtime: JobSiteMapsRuntimeConfig,
): string | null {
  if (runtime.simulation || !runtime.addressValidationEnabled) return null;
  return runtime.browserApiKey?.trim() || null;
}
import type { JobSiteMapsRuntimeConfig } from "../maps/job-site-map";
