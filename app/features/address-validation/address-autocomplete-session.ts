import type { JobSiteMapsRuntimeConfig } from "../maps/job-site-map";

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

/**
 * The browser key is usable only when WS-15 and both halves of the live
 * Places + Address Validation flow are configured. Starting autocomplete
 * without the server half would leave the billable session unterminated.
 */
export function placesAutocompleteBrowserKey(
  runtime: JobSiteMapsRuntimeConfig,
): string | null {
  if (
    runtime.simulation
    || !runtime.addressValidationEnabled
    || !runtime.serverAddressValidationAvailable
  ) return null;
  return runtime.browserApiKey?.trim() || null;
}

/** Explains the exact unavailable half without exposing either key. */
export function addressAvailabilityHint(
  runtime: JobSiteMapsRuntimeConfig,
): string | null {
  if (runtime.simulation) return null;
  if (!runtime.addressValidationEnabled) {
    return "Maps address validation and autocomplete are unavailable until the owner enables them. Typed addresses stay unvalidated with no coordinates.";
  }
  const browserAvailable = Boolean(runtime.browserApiKey?.trim());
  if (!browserAvailable && !runtime.serverAddressValidationAvailable) {
    return "Address review and autocomplete are unavailable because both Maps key configurations are missing. Typed addresses stay unvalidated with no coordinates.";
  }
  if (!runtime.serverAddressValidationAvailable) {
    return "Address review and autocomplete are unavailable because the server validation configuration is missing. Typed addresses stay unvalidated with no coordinates.";
  }
  if (!browserAvailable) {
    return "Autocomplete is unavailable because its browser configuration is missing. Server review remains available and reports whether validation succeeded.";
  }
  return null;
}
