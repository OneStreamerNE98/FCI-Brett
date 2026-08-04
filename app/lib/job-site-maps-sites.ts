import { env } from "cloudflare:workers";
import {
  GOOGLE_MAPS_BROWSER_API_KEY_ENV,
  resolveJobSiteMapsRuntimeConfig,
} from "../features/maps/job-site-map";
import {
  GOOGLE_MAPS_ADDRESS_VALIDATION_ENABLED_ENV,
  GOOGLE_MAPS_SERVER_API_KEY_ENV,
} from "./address-validation-sites";
import { getGoogleRuntimeConfig } from "./google-oauth";

type RuntimeEnvironment = Record<string, string | undefined>;

function runtimeValue(name: string) {
  return (env as unknown as RuntimeEnvironment)[name] ?? process.env[name];
}

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function getSitesJobSiteMapsRuntimeConfig() {
  const googleRuntime = getGoogleRuntimeConfig({
    GOOGLE_INTEGRATION_MODE: runtimeValue("GOOGLE_INTEGRATION_MODE"),
    NODE_ENV: process.env.NODE_ENV,
  });
  return resolveJobSiteMapsRuntimeConfig({
    simulation: googleRuntime.simulation,
    browserApiKey: runtimeValue(GOOGLE_MAPS_BROWSER_API_KEY_ENV),
    addressValidationEnabled:
      enabled(runtimeValue(GOOGLE_MAPS_ADDRESS_VALIDATION_ENABLED_ENV)),
    serverAddressValidationAvailable:
      Boolean(runtimeValue(GOOGLE_MAPS_SERVER_API_KEY_ENV)?.trim()),
  });
}
