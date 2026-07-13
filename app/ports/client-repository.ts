import type { ClientStatus } from "../domain/client-creation";

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
  activity: {
    id: string;
    recordId: string;
    action: "Client created";
    actor: string;
    detail: string;
    createdAt: number;
  };
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

export interface ClientRepository {
  create(intent: ClientCreationIntent): Promise<ClientCreationRepositoryResult>;
}
