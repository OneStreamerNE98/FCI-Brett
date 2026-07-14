import { normalizeClientCreation } from "../domain/client-creation";
import type { ClientRepository } from "../ports/client-repository";
import type { DirectoryMirror } from "../ports/directory-mirror";
import { canCreate, CREATION_CAPABILITIES, type CreationAuthorizationContext } from "./creation-authorization";
import { mirrorAfterDurableCreate, queuedMirrorAfterDurableCreate } from "./mirror-after-create";

export type CreateClientFailure = {
  ok: false;
  kind: "forbidden" | "invalid" | "duplicate" | "identifier-collision" | "idempotency-conflict" | "in-progress";
  message: string;
};

export type CreateClientSuccess = {
  ok: true;
  value: {
    id: string;
    clientCode: string;
    name: string;
    createdAt: number;
    version?: string;
    sheetSync: Awaited<ReturnType<typeof mirrorAfterDurableCreate>>;
  };
};

export type CreateClientResult = CreateClientFailure | CreateClientSuccess;

export type CreateClientDependencies = {
  repository: ClientRepository;
  directoryMirror: DirectoryMirror;
  newId: () => string;
  now: () => number;
};

export async function createClient(
  input: unknown,
  authorization: CreationAuthorizationContext,
  dependencies: CreateClientDependencies,
): Promise<CreateClientResult> {
  if (!canCreate(authorization, CREATION_CAPABILITIES.createClient)) {
    return { ok: false, kind: "forbidden", message: "You do not have permission to create clients." };
  }

  const normalized = normalizeClientCreation(input);
  if (!normalized.ok) return { ok: false, kind: "invalid", message: normalized.message };

  const createdAt = dependencies.now();
  const id = dependencies.newId();
  const clientCode = `CL-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const activityId = dependencies.newId();
  const contactId = normalized.value.primaryContact ? dependencies.newId() : null;
  const repositoryResult = await dependencies.repository.create({
    client: {
      id,
      clientCode,
      name: normalized.value.name,
      status: normalized.value.status,
      industry: normalized.value.industry,
      createdBy: authorization.actorId,
      createdAt,
      updatedAt: createdAt,
    },
    primaryContact: normalized.value.primaryContact && contactId
      ? {
          id: contactId,
          clientId: id,
          ...normalized.value.primaryContact,
          isPrimary: true,
          createdAt,
          updatedAt: createdAt,
        }
      : null,
    activity: {
      id: activityId,
      recordId: id,
      action: "Client created",
      actor: authorization.actorId,
      detail: `${clientCode} · ${normalized.value.name}`,
      createdAt,
    },
  });

  if (repositoryResult.outcome === "duplicate") {
    return { ok: false, kind: "duplicate", message: "A client with this business name already exists." };
  }
  if (repositoryResult.outcome === "identifier-collision") {
    return { ok: false, kind: "identifier-collision", message: "A client identifier collision occurred. Retry the request." };
  }
  if (repositoryResult.outcome === "idempotency-conflict") {
    return { ok: false, kind: "idempotency-conflict", message: "This request key was already used for different client details." };
  }
  if (repositoryResult.outcome === "in-progress") {
    return { ok: false, kind: "in-progress", message: "This client request is already being processed. Retry with the same request key." };
  }

  if (repositoryResult.outcome === "accepted") {
    return {
      ok: true,
      value: {
        id: repositoryResult.value.id,
        clientCode: repositoryResult.value.clientCode,
        name: repositoryResult.value.name,
        createdAt: repositoryResult.value.createdAt,
        version: repositoryResult.value.version,
        sheetSync: queuedMirrorAfterDurableCreate(),
      },
    };
  }

  const sheetSync = await mirrorAfterDurableCreate(dependencies.directoryMirror, {
    actorId: authorization.actorId,
    cause: "client-created",
    recordId: id,
  });
  return { ok: true, value: { id, clientCode, name: normalized.value.name, createdAt, sheetSync } };
}
