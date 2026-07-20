import {
  AUTHORIZATION_CAPABILITIES,
  type AuthorizationCapability,
} from "./authorization-capabilities";

export const CREATION_CAPABILITIES = {
  createClient: AUTHORIZATION_CAPABILITIES.clientsCreate,
  createProject: AUTHORIZATION_CAPABILITIES.projectsCreate,
  createLead: AUTHORIZATION_CAPABILITIES.leadsCreate,
  createProjectMeeting: AUTHORIZATION_CAPABILITIES.meetingsUpdate,
} as const;

export type CreationCapability = typeof CREATION_CAPABILITIES[keyof typeof CREATION_CAPABILITIES];

export type CreationIdentity = {
  actorId: string;
  capabilities: readonly AuthorizationCapability[];
};

export type CreationAuthorizationContext = {
  actorId: string;
  capabilities: ReadonlySet<AuthorizationCapability>;
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
