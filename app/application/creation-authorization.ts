export const CREATION_CAPABILITIES = {
  createClient: "clients:create",
  createProject: "projects:create",
} as const;

export type CreationCapability = typeof CREATION_CAPABILITIES[keyof typeof CREATION_CAPABILITIES];

export type CreationIdentity = {
  actorId: string;
  capabilities: readonly CreationCapability[];
};

export type CreationAuthorizationContext = {
  actorId: string;
  capabilities: ReadonlySet<CreationCapability>;
};

export function creationAuthorizationFor(identity: CreationIdentity): CreationAuthorizationContext {
  return {
    actorId: identity.actorId.trim(),
    capabilities: new Set(identity.capabilities),
  };
}

export function canCreate(context: CreationAuthorizationContext, capability: CreationCapability) {
  return Boolean(context.actorId) && context.capabilities.has(capability);
}
