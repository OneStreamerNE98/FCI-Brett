import { normalizeClientCreation } from "../domain/client-creation";
import type { ClientRepository } from "../ports/client-repository";
import type { DirectoryMirror } from "../ports/directory-mirror";
import { canCreate, CREATION_CAPABILITIES, type CreationAuthorizationContext } from "./creation-authorization";
import { mirrorAfterDurableCreate } from "./mirror-after-create";

export type CreateClientFailure = {
  ok: false;
  kind: "forbidden" | "invalid" | "duplicate";
  message: string;
};

export type CreateClientSuccess = {
  ok: true;
  value: {
    id: string;
    clientCode: string;
    name: string;
    createdAt: number;
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

  const sheetSync = await mirrorAfterDurableCreate(dependencies.directoryMirror, {
    actorId: authorization.actorId,
    cause: "client-created",
    recordId: id,
  });
  return { ok: true, value: { id, clientCode, name: normalized.value.name, createdAt, sheetSync } };
}
