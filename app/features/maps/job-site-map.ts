export const GOOGLE_MAPS_BROWSER_API_KEY_ENV = "GOOGLE_MAPS_BROWSER_API_KEY";
export const GOOGLE_MAPS_EMBED_ORIGIN = "https://www.google.com";
export const GOOGLE_MAPS_DIRECTIONS_BASE_URL = "https://www.google.com/maps/dir/?api=1";

export type JobSiteLocation = Readonly<{
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}>;

export type JobSiteMapsRuntimeConfig = Readonly<{
  simulation: boolean;
  browserApiKey: string | null;
}>;

export type JobSiteMapState = Readonly<{
  kind: "no-address" | "simulation" | "missing-key" | "live";
  location: JobSiteLocation | null;
  destination: string | null;
  directionsUrl: string | null;
  embedUrl: string | null;
}>;

const NON_ADDRESS_VALUES = new Set([
  "address pending",
  "not provided",
  "site pending",
  "unknown",
]);

function normalizedAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const address = value.trim().replace(/\s+/g, " ");
  if (!address || NON_ADDRESS_VALUES.has(address.toLowerCase())) return null;
  return address;
}

function normalizedCoordinate(value: unknown, minimum: number, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  const coordinate = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.trim())
      : Number.NaN;
  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum
    ? coordinate
    : null;
}

export function normalizeJobSiteLocation(input: Readonly<{
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}>): JobSiteLocation | null {
  const address = normalizedAddress(input.address);
  const latitude = normalizedCoordinate(input.latitude, -90, 90);
  const longitude = normalizedCoordinate(input.longitude, -180, 180);
  const hasGeocode = latitude !== null && longitude !== null;
  if (!address && !hasGeocode) return null;
  return Object.freeze({
    address,
    latitude: hasGeocode ? latitude : null,
    longitude: hasGeocode ? longitude : null,
  });
}

export function jobSiteDestination(location: JobSiteLocation | null) {
  if (!location) return null;
  if (location.latitude !== null && location.longitude !== null) {
    return `${location.latitude},${location.longitude}`;
  }
  return location.address;
}

export function buildGoogleMapsDirectionsUrl(location: JobSiteLocation | null) {
  const destination = jobSiteDestination(location);
  return destination
    ? `${GOOGLE_MAPS_DIRECTIONS_BASE_URL}&destination=${encodeURIComponent(destination)}`
    : null;
}

export function buildGoogleMapsEmbedUrl(
  location: JobSiteLocation | null,
  browserApiKey: string | null,
) {
  const destination = jobSiteDestination(location);
  const key = browserApiKey?.trim();
  if (!destination || !key) return null;
  return `${GOOGLE_MAPS_EMBED_ORIGIN}/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(destination)}&maptype=satellite`;
}

export function resolveJobSiteMapsRuntimeConfig(input: Readonly<{
  simulation: boolean;
  browserApiKey?: unknown;
}>): JobSiteMapsRuntimeConfig {
  const browserApiKey = typeof input.browserApiKey === "string" && input.browserApiKey.trim()
    ? input.browserApiKey.trim()
    : null;
  return Object.freeze({
    simulation: input.simulation,
    // Simulation never places a key in rendered markup or creates an iframe.
    browserApiKey: input.simulation ? null : browserApiKey,
  });
}

export function resolveJobSiteMapState(
  location: JobSiteLocation | null,
  runtime: JobSiteMapsRuntimeConfig,
): JobSiteMapState {
  const destination = jobSiteDestination(location);
  if (!destination) {
    return Object.freeze({
      kind: "no-address",
      location: null,
      destination: null,
      directionsUrl: null,
      embedUrl: null,
    });
  }

  const directionsUrl = buildGoogleMapsDirectionsUrl(location);
  if (runtime.simulation) {
    return Object.freeze({
      kind: "simulation",
      location,
      destination,
      directionsUrl,
      embedUrl: null,
    });
  }

  const embedUrl = buildGoogleMapsEmbedUrl(location, runtime.browserApiKey);
  return Object.freeze({
    kind: embedUrl ? "live" : "missing-key",
    location,
    destination,
    directionsUrl,
    embedUrl,
  });
}
