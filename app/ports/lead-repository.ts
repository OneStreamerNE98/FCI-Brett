import type { LeadRow, ValidatedLeadValues } from "../domain/lead";

export type LeadActivityIntent = {
  id: string;
  recordId: string;
  action: "Lead created" | "Lead stage changed" | "Lead next action changed";
  actor: string;
  detail: string;
  createdAt: number;
};

export type LeadCreationIntent = {
  lead: LeadRow;
  activity: LeadActivityIntent & { action: "Lead created" };
};

export type AcceptedLeadCreation = {
  row: LeadRow;
  /** PostgreSQL bigint values stay strings so callers cannot lose precision. */
  version: string;
};

export type LeadCreationRepositoryResult =
  | { outcome: "created"; value: LeadRow }
  | { outcome: "accepted"; value: AcceptedLeadCreation; replayed: boolean }
  | { outcome: "identifier-collision" }
  | { outcome: "idempotency-conflict" }
  | { outcome: "in-progress" };

export type LeadUpdateIntent = {
  leadId: string;
  values: ValidatedLeadValues;
  updatedAt: number;
  updatedBy: string;
  activities: LeadActivityIntent[];
};

export type LeadUpdateRepositoryResult =
  | { outcome: "updated"; value: LeadRow }
  | { outcome: "lead-not-found" };

export interface LeadRepository {
  list(): Promise<LeadRow[]>;
  findById(leadId: string): Promise<LeadRow | null>;
  create(intent: LeadCreationIntent): Promise<LeadCreationRepositoryResult>;
  update(intent: LeadUpdateIntent): Promise<LeadUpdateRepositoryResult>;
}
