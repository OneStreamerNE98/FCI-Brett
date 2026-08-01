import {
  GOOGLE_FORM_LEAD_HEADERS,
  GOOGLE_FORM_LEAD_MAX_ROWS,
} from "../domain/google-form-lead-intake";

const SIMULATION_ROWS = Object.freeze([
  Object.freeze([
    "2026-07-31T13:00:00Z",
    "FCI TEST — DO NOT USE — GI-01 Form Lead",
    "101 Simulation Way, Cherry Hill, NJ",
    "Lobby and two offices",
    "Luxury vinyl plank",
    "gi01-form@example.test",
  ]),
] as const);

/** Source-safe fixture. Simulation never asks Google for a token or makes a live call. */
export function googleFormLeadSimulationHeaders() {
  return Object.freeze([Object.freeze([...GOOGLE_FORM_LEAD_HEADERS])]);
}

export function googleFormLeadSimulationRows(firstSourceRow: number, limit: number) {
  if (
    !Number.isSafeInteger(firstSourceRow) || firstSourceRow < 2
    || !Number.isSafeInteger(limit) || limit < 1 || limit > GOOGLE_FORM_LEAD_MAX_ROWS
  ) throw new TypeError("Simulation Google Form row range is invalid");
  const offset = firstSourceRow - 2;
  return Object.freeze(SIMULATION_ROWS.slice(offset, offset + limit));
}
