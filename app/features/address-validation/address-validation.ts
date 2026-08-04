import {
  coordinatesAreValid,
  normalizeAddressText,
  type AddressReviewVerdict,
} from "../../domain/address-validation";

export const GOOGLE_ADDRESS_VALIDATION_ENDPOINT =
  "https://addressvalidation.googleapis.com/v1:validateAddress";

export type AddressValidationResult = Readonly<{
  inputAddress: string;
  standardizedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  verdict: AddressReviewVerdict;
  failureCode: string | null;
  simulated: boolean;
}>;

export type AddressValidationRuntime = Readonly<{
  simulation: boolean;
  liveEnabled: boolean;
  serverApiKey?: string;
  enableUspsCass: boolean;
}>;

export type AddressValidationDependencies = Readonly<{
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}>;

const SIMULATION_FIXTURE = Object.freeze({
  match: "123 test street",
  standardizedAddress: "123 Test Street, Portland, ME 04101",
  latitude: 43.6591,
  longitude: -70.2568,
});

function unvalidated(inputAddress: string, failureCode: string): AddressValidationResult {
  return Object.freeze({
    inputAddress,
    standardizedAddress: null,
    latitude: null,
    longitude: null,
    verdict: "unvalidated",
    failureCode,
    simulated: false,
  });
}

export function simulationAddressValidation(inputAddress: string): AddressValidationResult {
  if (!inputAddress.toLowerCase().includes(SIMULATION_FIXTURE.match)) {
    return unvalidated(inputAddress, "simulation_fixture_not_found");
  }
  return Object.freeze({
    inputAddress,
    standardizedAddress: SIMULATION_FIXTURE.standardizedAddress,
    latitude: SIMULATION_FIXTURE.latitude,
    longitude: SIMULATION_FIXTURE.longitude,
    // Simulation is evidence of the workflow only. It is never promoted to a
    // live provider verdict, even though the fixture carries map coordinates.
    verdict: "simulated",
    failureCode: null,
    simulated: true,
  });
}

function providerCandidate(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const result = (payload as Record<string, unknown>).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const record = result as Record<string, unknown>;
  const address = record.address;
  const geocode = record.geocode;
  const verdict = record.verdict;
  const formatted = address && typeof address === "object" && !Array.isArray(address)
    ? normalizeAddressText((address as Record<string, unknown>).formattedAddress)
    : undefined;
  const location = geocode && typeof geocode === "object" && !Array.isArray(geocode)
    ? (geocode as Record<string, unknown>).location
    : undefined;
  const latitude = location && typeof location === "object" && !Array.isArray(location)
    ? (location as Record<string, unknown>).latitude
    : undefined;
  const longitude = location && typeof location === "object" && !Array.isArray(location)
    ? (location as Record<string, unknown>).longitude
    : undefined;
  const verdictRecord = verdict && typeof verdict === "object" && !Array.isArray(verdict)
    ? verdict as Record<string, unknown>
    : {};

  return {
    formatted: formatted ?? null,
    latitude: coordinatesAreValid(latitude, longitude) ? latitude as number : null,
    longitude: coordinatesAreValid(latitude, longitude) ? longitude as number : null,
    possibleNextAction: typeof verdictRecord.possibleNextAction === "string"
      ? verdictRecord.possibleNextAction
      : null,
    addressComplete: verdictRecord.addressComplete === true,
    hasUnconfirmedComponents: verdictRecord.hasUnconfirmedComponents === true,
    hasInferredComponents: verdictRecord.hasInferredComponents === true,
    hasReplacedComponents: verdictRecord.hasReplacedComponents === true,
    hasSpellCorrectedComponents: verdictRecord.hasSpellCorrectedComponents === true,
  };
}

export function classifyGoogleAddressValidation(
  inputAddress: string,
  payload: unknown,
): AddressValidationResult {
  const candidate = providerCandidate(payload);
  if (!candidate?.formatted) return unvalidated(inputAddress, "provider_response_unusable");

  const hasCoordinates = coordinatesAreValid(candidate.latitude, candidate.longitude);
  const action = candidate.possibleNextAction;
  let verdict: AddressReviewVerdict;
  if (
    action === "ACCEPT"
    && candidate.addressComplete
    && hasCoordinates
    && !candidate.hasUnconfirmedComponents
    && !candidate.hasInferredComponents
    && !candidate.hasReplacedComponents
    && !candidate.hasSpellCorrectedComponents
  ) {
    verdict = "validated";
  } else if (action === "FIX") {
    verdict = "needs-correction";
  } else if (
    action === "CONFIRM"
    || action === "CONFIRM_ADD_SUBPREMISES"
    || (
      candidate.addressComplete
      && hasCoordinates
      && (
        candidate.hasUnconfirmedComponents
        || candidate.hasInferredComponents
        || candidate.hasReplacedComponents
        || candidate.hasSpellCorrectedComponents
      )
    )
  ) {
    verdict = "needs-confirmation";
  } else {
    verdict = "needs-correction";
  }

  return Object.freeze({
    inputAddress,
    standardizedAddress: candidate.formatted,
    latitude: hasCoordinates ? candidate.latitude : null,
    longitude: hasCoordinates ? candidate.longitude : null,
    verdict,
    failureCode: verdict === "needs-correction" ? "address_needs_correction" : null,
    simulated: false,
  });
}

export async function validateAddress(
  input: Readonly<{ address: string; sessionToken: string }>,
  runtime: AddressValidationRuntime,
  dependencies: AddressValidationDependencies,
): Promise<AddressValidationResult> {
  if (runtime.simulation) return simulationAddressValidation(input.address);
  if (!runtime.liveEnabled) return unvalidated(input.address, "owner_gate_closed");
  const apiKey = runtime.serverApiKey?.trim();
  if (!apiKey) return unvalidated(input.address, "server_key_missing");

  let response: Response;
  try {
    response = await dependencies.fetch(GOOGLE_ADDRESS_VALIDATION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify({
        address: {
          regionCode: "US",
          addressLines: [input.address],
        },
        sessionToken: input.sessionToken,
        ...(runtime.enableUspsCass ? { enableUspsCass: true } : {}),
      }),
      signal: dependencies.signal,
    });
  } catch {
    return unvalidated(input.address, "provider_unavailable");
  }
  if (!response.ok) return unvalidated(input.address, "provider_rejected_request");

  try {
    return classifyGoogleAddressValidation(input.address, await response.json());
  } catch {
    return unvalidated(input.address, "provider_response_unusable");
  }
}
