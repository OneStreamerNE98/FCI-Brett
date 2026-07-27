import type { ClientStatus } from "../domain/client-creation";
import type { VersionConflict } from "../domain/record-version";

export type ClientActivityIntent = {
  id: string;
  recordId: string;
  action: "Client created" | "Client fields updated";
  actor: string;
  detail: string;
  createdAt: number;
};

export type ClientCreationIntent = {
  client: {
    id: string;
    clientCode: string;
    name: string;
    status: ClientStatus;
    industry: string | null;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
  };
  primaryContact: {
    id: string;
    clientId: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
    isPrimary: true;
    createdAt: number;
    updatedAt: number;
  } | null;
  activity: ClientActivityIntent & { action: "Client created" };
};

export type AcceptedClientCreation = {
  id: string;
  clientCode: string;
  name: string;
  createdAt: number;
  /** PostgreSQL bigint values stay strings so callers cannot lose precision. */
  version: string;
};

export type ClientCreationRepositoryResult =
  | { outcome: "created" }
  | { outcome: "accepted"; value: AcceptedClientCreation; replayed: boolean }
  | { outcome: "duplicate" }
  | { outcome: "identifier-collision" }
  | { outcome: "idempotency-conflict" }
  | { outcome: "in-progress" };

export type ClientRow = {
  id: string;
  clientCode: string;
  name: string;
  status: ClientStatus;
  industry: string | null;
  updatedAt: number;
  version: string;
};

export type ClientFieldUpdateIntent = {
  clientId: string;
  expectedVersion: string;
  values: {
    name: string;
    status: ClientStatus;
    industry: string | null;
  };
  updatedAt: number;
  updatedBy: string;
  activity: ClientActivityIntent & { action: "Client fields updated" };
};

export type ClientFieldUpdateRepositoryResult =
  | { outcome: "updated"; value: ClientRow }
  | { outcome: "client-not-found" }
  | VersionConflict;

export interface ClientRepository {
  findById(clientId: string): Promise<ClientRow | null>;
  create(intent: ClientCreationIntent): Promise<ClientCreationRepositoryResult>;
  update(intent: ClientFieldUpdateIntent): Promise<ClientFieldUpdateRepositoryResult>;
}
