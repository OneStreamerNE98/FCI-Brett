# Production persistence boundary

Status: Source complete; extended by unapplied migrations 4–5, fixed administration commands, the People projection/page, and the minimized audit reader. No production database/runtime deployment
Branch: `codex/production-persistence-boundary`
Date: July 15, 2026

## Outcome

The repository now defines the production-owned persistence and storage seams that must exist before authorization behavior or Google Workspace employee login is implemented. This is a source-only foundation:

- PostgreSQL migration `3`, `production_persistence_boundary`, adds generic identity, security-audit, integration, and file metadata. Unapplied migration `4`, `admin_access_persistence`, adds the fixed three-role catalog and bounded assignment/invitation state. Unapplied migration `5`, `admin_audit_activity`, adds the security-barrier minimized Activity projection and separately granted reader boundary.
- Aggregate-oriented PostgreSQL repositories keep protected mutations and their audit evidence in one bounded transaction.
- A provider-neutral object-storage port plus memory, R2, and source-only GCS adapters define conditional write, exact-generation metadata, and chunked reads without exposing provider URLs or overwrite/list/delete operations. The existing development upload route is composed through R2; GCS remains deliberately uncomposed.
- Production source composition creates singleton identity, fixed administration, minimized audit-reader, integration, and file repositories around the existing bounded pool. The five Administrator commands, bounded People projection/page, and minimized Activity reader exist in source; invitation fulfillment, login/session issuance, migration/grant apply, and provider actions remain absent.
- Runtime readiness verifies an exact relation/privilege matrix as well as the immutable migration history.

No database, role, grant, Google Cloud resource, hosted configuration, Workspace connector, or production route was changed or applied.

## Migration-owned structures

### Employee identity and authorization data

- `users`
- `external_identities`
- `invitations`
- `invitation_project_assignments`
- `sessions`
- `roles`
- `capabilities`
- `role_capabilities`
- `user_roles`
- `project_memberships`

Migration 4 seeds exactly the three approved fixed roles and their capability ceilings, but no invitation, user, external identity, session, or live assignment row. Invitations bind one role and any intended Project Manager projects. External identities remain unique by issuer plus immutable provider subject; email is not the stable identity key. Invitation, session, state, and browser-nonce values are stored only as canonical SHA-256 digests.

Migration 4 is deliberately fresh-access-data-only: it fails before writing when version-3 role, capability, invitation, role-assignment, or project-membership tables contain rows. No production database has applied version 3. A future populated upgrade requires a separately reviewed backfill rather than guessing old access meaning.

The version-3 partial indexes for expiring role and project assignments remain as harmless empty legacy indexes because version 4 requires permanent `NULL` expiry and the migration safety contract prohibits destructive `DROP` statements. A later maintenance migration may remove them only through a separately reviewed destructive-DDL exception.

### Security evidence

- `audit_events`

Security audit is separate from the client/project activity timeline. It records executor and originating actor independently, action, target, result, reason, correlation, minimized JSON metadata, occurrence time, and retention-policy evidence. A database trigger rejects update and delete with SQLSTATE `55000`; the runtime receives insert-only table access and no audit read privilege.

### Company data connector metadata

- `integration_connections`
- `integration_credentials`
- `integration_connection_scopes`
- `integration_oauth_attempts`
- `integration_resources`
- `integration_cursors`
- `integration_events`

The company connector remains separate from employee OIDC identity. A source-only production OAuth workflow now hashes state and browser nonce, encrypts PKCE and refresh-token material with AES-GCM plus purpose-bound AAD, resolves ciphertext by its exact stored key version, and consumes OAuth attempts once through `IntegrationMetadataRepository`. OAuth completion atomically binds verified external identity, the current-version refresh ciphertext, granted scopes, and security-audit evidence in the version-3 tables. Its source-only rotation operation decrypts an exact old version, re-encrypts with the current writer, verifies the new ciphertext before persistence, and applies an exact-version-fenced audited update. The general runtime still has no direct `integration_credentials` or `integration_connection_scopes` grant, and the workflow is not composed into a route; its credential-specific grant/composition review remains part of Gate C. Operational integration events remain append-only at the database layer, but the runtime has no access until a reviewed event-writer adapter exists.

The development D1 Workspace connector keeps its existing data and behavior behind thin D1 composition adapters. It remains current-key-only, so WS-04's documented disconnect/rotate/reconnect procedure still governs Sites; production multi-key support does not silently change that procedure. The development credential is not eligible for automatic production migration; production connection requires a separately approved reauthorization.

### File and provider-neutral object metadata

- `files`
- `file_versions`
- `storage_objects`
- `file_links`

Production file reservations require a typed client or project relationship at the database level. The implemented repository permits only project-associated reservations and creates the logical file, version, quarantine object intent, project link, and security audit atomically. Object bytes are written outside the database transaction. Finalization uses row-version and state fences and records a stored upload as `quarantined`, not released; no scanner or download authorization is claimed.

Original filenames are metadata and cannot be used as opaque storage keys. The storage port supports only:

- `putIfAbsent`
- exact-generation `head`
- exact-generation `openRead` using `AsyncIterable<Uint8Array>`

It deliberately has no overwrite, list, delete, public URL, or signed URL surface.

## Repository boundary

The source includes these ports and adapters:

- `IdentityPersistenceRepository`: user/external-identity registration plus secure session issuance/revocation. Generic role/capability/assignment mutation methods were removed.
- `AdminAccessPersistenceRepository`: the five fixed Administrator commands only—create/revoke invitation, set one role and any Project Manager projects, disable, and sign out everywhere. The immutable role/capability catalog has no mutation method.
- `SecurityAuditRepository`: standalone append plus a same-client helper for atomic evidence inside another repository transaction.
- `IntegrationMetadataRepository`: connection, one-time OAuth-attempt, atomic OAuth identity/refresh-credential/scope completion, and typed external-resource metadata. Provider calls and AES-GCM work remain outside its PostgreSQL transactions.
- `FileMetadataRepository`: atomic project upload reservation, stored-object confirmation/failure, and released-reference lookup. It does not stream bytes inside PostgreSQL.
- `ObjectStorage`: provider-neutral conditional object storage with memory and R2 contract adapters plus a GCS adapter using injected configuration. The development upload route uses the R2 adapter. The GCS adapter is not composed into Cloud Run, and no Cloud Storage bucket is provisioned.

Network, provider, encryption, and decryption work must stay outside PostgreSQL transactions. Mutable transitions use state and `bigint` version fences; versions remain decimal strings in TypeScript so values above JavaScript's safe-integer range are not truncated. Session issuance holds a shared user-row lock and rejects disabled users, changed authorization versions, and issuance before `sessions_valid_after`. Each mutation repository derives its own audit action, target, result, and stale/conflict reason instead of trusting caller-selected semantics. Named uniqueness conflicts roll back all attempted state and then require a separate denied audit transaction before returning a conflict result; if that audit cannot be recorded, the repository fails closed instead of reporting a handled conflict.

## Runtime privileges and readiness

`infrastructure/postgres/least-privilege.sql` resets privileges before granting the exact reviewed matrix. Important restrictions include:

- no runtime schema `CREATE`, grant option, sequence access, `DELETE`, `TRUNCATE`, `REFERENCES`, or `TRIGGER` privilege;
- exact column-only `UPDATE` grants for the implemented user, invitation, session, role-assignment, and project-membership transitions; primary identity keys, permanent-expiry columns, and table-wide identity/security updates remain unavailable;
- insert-only access to `audit_events`;
- no direct runtime access to migration history, credentials, connector scopes/cursors/events, or any not-yet-implemented integration writer;
- a single owner-checked, fixed-search-path security-definer function for readiness to read non-secret migration history;
- no rehearsal-importer access to identity, audit, integration, or file tables.

Database readiness now fails for missing or extra expected relations, incorrect table or column privileges, sequence access, grant-option drift, unexpected executable functions, unsafe schema rights, a runtime login able to assume migration/rehearsal capability roles, or an incomplete/changed migration history.

The SQL policy and readiness checks remain source-only. Applying the role policy and capturing positive/negative statements under an actual runtime login is still an owner-approved isolated staging/CI acceptance step; the local PostgreSQL migration integration test does not claim that evidence.

## Intentionally deferred

- any custom role, per-user capability override, or runtime role/capability mutation;
- atomic secure-session rotation; non-null predecessor rotation is rejected until implemented;
- durable invitation fulfillment and production employee-session/CSRF composition for the People & Access and Activity routes;
- Google Workspace employee OIDC or a second user;
- live company-connector OAuth, credential brokering, watches, notification channels, or provider calls;
- Cloud Storage provisioning or GCS adapter composition;
- malware scanning, release decisions, retention holds, purge, download/share authorization, and untrusted uploads;
- D1 route replacement, D1/R2 data migration, staging application, and production cutover;
- scheduling, messaging, durable job expansion, and AI document indexing.

## Acceptance and next gate

This source boundary was accepted without Brett's open Google Cloud/Workspace inputs because it did not apply or configure production infrastructure. The follow-on [authorization and employee-route work](authorization-simulation.md) now adds explicit access contexts, the approved granular Administrator/Office/Project Manager ceilings, secure session/CSRF behavior, project-scoped queries, fixed-operation provider gates, denial evidence, a narrow dashboard/search/project/client/logout Cloud Run source boundary, the five fixed Administrator commands, the bounded People projection/page, and the minimized Activity reader. The private Sites development presentation adapter is deployed, but durable invitation fulfillment/session issuance, production employee-session/CSRF composition, provider adapters, the broader application surface, PostgreSQL migration/grant apply, and production deployment remain open.

Live Workspace OIDC, staging migration/restore, a second employee, and real client data remain blocked by their separate platform, owner-approval, recovery, authorization, and acceptance gates.
