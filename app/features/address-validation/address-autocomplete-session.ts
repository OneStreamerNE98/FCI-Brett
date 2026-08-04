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

/** Explains only the unavailable capability without guessing at server-key state. */
export function addressAvailabilityHint(
  runtime: JobSiteMapsRuntimeConfig,
): string | null {
  if (runtime.simulation) return null;
  if (!runtime.addressValidationEnabled) {
    return "Maps address validation and autocomplete are unavailable until the owner enables them. Typed addresses stay unvalidated with no coordinates.";
  }
  if (!runtime.browserApiKey?.trim()) {
    return "Autocomplete is unavailable because its browser configuration is missing. Server review remains available and reports whether validation succeeded.";
  }
  return null;
}
import type { JobSiteMapsRuntimeConfig } from "../maps/job-site-map";
