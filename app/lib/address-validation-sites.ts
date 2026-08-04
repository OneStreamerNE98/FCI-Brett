import { env } from "cloudflare:workers";

import type { AddressValidationRuntime } from "../features/address-validation/address-validation";
import { getGoogleRuntimeConfig } from "./google-oauth-sites";

export const GOOGLE_MAPS_SERVER_API_KEY_ENV = "GOOGLE_MAPS_SERVER_API_KEY";
export const GOOGLE_MAPS_ADDRESS_VALIDATION_ENABLED_ENV =
  "GOOGLE_MAPS_ADDRESS_VALIDATION_ENABLED";
export const GOOGLE_MAPS_ENABLE_USPS_CASS_ENV = "GOOGLE_MAPS_ENABLE_USPS_CASS";

type RuntimeEnvironment = Record<string, string | undefined>;

function runtimeValue(name: string, input?: RuntimeEnvironment) {
  return input?.[name]
    ?? (env as unknown as RuntimeEnvironment)[name]
    ?? process.env[name];
}

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

/**
 * Live Address Validation remains closed until the owner turns on the explicit
 * gate and supplies the restricted server key. Key presence alone never opens
 * a billable Google call.
 */
export function getSitesAddressValidationRuntime(
  input?: RuntimeEnvironment,
): AddressValidationRuntime {
  const google = getGoogleRuntimeConfig(input);
  return Object.freeze({
    simulation: google.simulation,
    liveEnabled: !google.simulation
      && enabled(runtimeValue(GOOGLE_MAPS_ADDRESS_VALIDATION_ENABLED_ENV, input)),
    serverApiKey: runtimeValue(GOOGLE_MAPS_SERVER_API_KEY_ENV, input)?.trim() || undefined,
    enableUspsCass: enabled(runtimeValue(GOOGLE_MAPS_ENABLE_USPS_CASS_ENV, input)),
  });
}
