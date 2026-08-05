import { formatUsd } from "./format-usd";
import {
  LEAD_STAGE_FILTERS,
  LEAD_STAGE_LABELS,
} from "./operations-routes";
import type { Project } from "./record-types";

export const leadStages = LEAD_STAGE_FILTERS
  .filter((stage) => stage !== "other")
  .map((stage) => LEAD_STAGE_LABELS[stage]);

export const terminalProjectStatuses = new Set(["archived", "completed", "cancelled"]);

export function recordInitials(value: string) {
  return value.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "FC";
}

export function displayStatus(value: unknown, fallback: string) {
  const status = String(value ?? "").trim();
  return status ? status.split(/[-_\s]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ") : fallback;
}

export function money(value: number) {
  return formatUsd(value);
}

export function isActiveProject(project: Project) {
  return !terminalProjectStatuses.has(project.status.toLowerCase());
}
