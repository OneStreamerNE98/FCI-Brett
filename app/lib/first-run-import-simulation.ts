import {
  GOOGLE_IMPORT_CLIENT_HEADERS,
  GOOGLE_IMPORT_PROJECT_HEADERS,
} from "./google-sheets";
import type { FirstRunImportEntity } from "../domain/first-run-import";

const SIMULATION_CLIENT_NAME =
  "FCI TEST — DO NOT USE — SET-25 imported client";
const SIMULATION_CLIENT_EMAIL = "set25-import@example.test";

const SIMULATION_ROWS = Object.freeze({
  clients: Object.freeze([
    Object.freeze([...GOOGLE_IMPORT_CLIENT_HEADERS]),
    Object.freeze([
      "LEGACY-SET25",
      SIMULATION_CLIENT_NAME,
      "active",
      "Commercial",
      "SET-25 Test Contact",
      SIMULATION_CLIENT_EMAIL,
      "555-0125",
      "25 Simulation Way, Cherry Hill, NJ",
    ]),
  ]),
  projects: Object.freeze([
    Object.freeze([...GOOGLE_IMPORT_PROJECT_HEADERS]),
    Object.freeze([
      "FCI TEST — DO NOT USE — SET-25 imported project",
      "LEGACY-SET25",
      SIMULATION_CLIENT_NAME,
      SIMULATION_CLIENT_EMAIL,
      "25 Simulation Way, Cherry Hill, NJ",
      "planning",
      "25000",
      "mixed",
      "1000",
      "25000",
      "commercial",
    ]),
  ]),
} as const);

/** Source-safe fixture: simulation returns rows without requesting a Google token. */
export function firstRunImportSimulationRows(entity: FirstRunImportEntity) {
  return SIMULATION_ROWS[entity];
}
