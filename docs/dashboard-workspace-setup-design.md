# Dashboard-driven Google Workspace setup with an owner-definable blueprint

Design date: July 20, 2026 · Owner-approved scope (Jason) · Baseline: `main` after
PR #55 · Packets: SET-13…SET-21 + WS-14 in the
[agent execution plan](agent-plan-architecture-workspace-and-setup.md).

The admin completes most Google Workspace setup from Settings instead of manual
Google-console work, and — critically — **defines the setup itself** (folder tree,
spreadsheets, templates, business attributes) in the dashboard so future maintenance is
a dashboard edit, not a code change. Lifecycle: **Define (blueprint) → Create (setup
actions) → Verify (button-driven live checks) → Maintain (drift/reconcile)** — all
admin-only, simulation-testable, and the engine **never deletes Google content**.

Owner-locked decisions:

1. **Create + verify.** Dashboard actions create resources via the connected account,
   detect/adopt pre-existing ones, and verify afterward.
2. **App-managed config + env fallback.** Created resource IDs persist app-side and are
   runtime-authoritative; `GOOGLE_WORKSPACE_*` env values remain override/seed; the
   source is always visible. Secrets stay env-only.
3. **Starter set.** Shared Drive adopt/verify + folder tree; client-directory sheet;
   Doc/Sheet templates; calendars + Gmail labels.
4. **Domain setup stays a guided checklist.** Admin console/DNS/OAuth client/API
   enablement/secret entry/Google Groups remain manual owner steps with instructions,
   external deep links, and safe verification chips.
5. **Owner-definable blueprint.** The definitions are config-as-data, edited in a
   structured dashboard editor (never freeform JSON), with system-managed structures
   visibly locked and drift resolved through a reconcile view.

## 1. Architecture — three layers

| Layer | What it is | Persistence | Authority |
| --- | --- | --- | --- |
| **Blueprint** (desired state) | Owner-editable definition of folders, spreadsheets, templates, calendars, naming, business attributes | `workspace_blueprints` (D1, append-only migration; one current row per connection, versioned JSON, seeded from today's `DRIVE_BLUEPRINT`) | Owner nodes editable; system nodes locked |
| **Registry** (actual state) | IDs of resources that exist (created/adopted), source-tagged | `workspace_resources` (D1, append-only migration; unique per connection+type+key) | Runtime-authoritative for resource IDs |
| **Effective config** (resolution) | app-saved > env > none, source-visible | Pure resolver, no I/O | Replaces per-route env reads incrementally |

`getGoogleRuntimeConfig` in `app/lib/google-oauth.ts` stays **byte-for-byte untouched**
(its `missingDetails {label, envVar, secret}` shape is pinned by ~40 tests). A new pure
module `app/lib/workspace-effective-config.ts` exposes
`resolveEffectiveWorkspaceResources(config, savedRows)` and
`applyEffectiveWorkspaceConfig(config, resources)`, which returns a frozen clone with
the four resource IDs (`drive.rootFolderId`, `clientDirectorySheetId`, both calendar
IDs) replaced by effective values, `missingDetails` recomputed by **filtering** (never
rewriting) the four resource-ID entries when app-satisfied, and a new
**`connectReady`** flag: true when nothing outside the resource-ID set is missing.
`connectReady` breaks today's chicken-and-egg — the authorize route currently gates on
`oauthReady`, which requires resource-ID env vars, so you cannot connect before
resources exist and cannot create resources before connecting. The authorize gate flips
to `connectReady` (a deliberate, mutation-tested change); OAuth-client/secrets/account
prerequisites still block connecting. Composition point:
`getEffectiveGoogleRuntimeConfig()` in `app/lib/google-oauth-sites.ts` (base config +
registry rows + resolver). Routes migrate incrementally, packet by packet; unmigrated
routes behave identically.

**Registry table** (`workspace_resources`): `id`, `connection_key`, `resource_type`
(`drive.shared-drive` | `drive.folder` | `drive.file` | `sheets.spreadsheet` |
`calendar.calendar`), `resource_key` (blueprint node key, e.g. `primary`,
`root:company-admin`, `templates`, `template:estimate-proposal`, `client-directory`,
`client-appointments`), `external_id`, `parent_external_id`, `external_url`, `origin`
(`created` | `adopted` | `env-adopted`), `metadata_json`, `created_by`, `created_at`,
`updated_at`; unique index on (`connection_key`,`resource_type`,`resource_key`).
The shape deliberately mirrors `RegisterIntegrationResourceIntent` in
`app/ports/integration-metadata.ts` (`owner` omitted — every setup resource is
`{type:"workspace"}`), so later production parity is a mechanical adapter.
**Production parity is deferred by design:** the Postgres `integration_resources`
store exists unwired, production runs none of these routes, and BE-08 is the
designated packet that ports integration flows to the production boundary —
coordination note, not a dependency.

**Blueprint table** (`workspace_blueprints`): one current row per connection with
`version` (optimistic concurrency; PUT carries `expectedVersion`) and
`blueprint_json`. History lives in `google_integration_events`
(`setup.blueprint_updated` with a change summary); no history UI in v1. Absent row ⇒
the seed with `version: 0`.

**Blueprint model** (`app/lib/workspace-blueprint.ts` — types, `seedWorkspaceBlueprint()`
built from the `DRIVE_BLUEPRINT` literals, `sanitizeWorkspaceBlueprint()`):

- `business.displayName` (consumed by template generation; timezone deliberately NOT
  here — a saved `workspace_settings.timezone` already exists and stays the single
  authority).
- `naming.clientFolderPattern` / `naming.projectFolderPattern` — closed token set
  `{code} {name} {number} {year}`.
- `drive.sharedDriveName`, `drive.roots[]`, `drive.clientFolders[]`,
  `drive.projectFolders[]` — folder nodes `{key, name, management, children?}` with
  immutable slug keys (`/^[a-z0-9][a-z0-9-]{0,40}$/`), depth ≤ 2, names without `/`.
- `spreadsheets[]` `{key, name, targetFolderKey, management}` — seed:
  the system `client-directory` entry targeting `00_Company Admin`.
- `templates[]` `{key, name, kind: doc|sheet, targetFolderKey}` — all owner-managed.
- `gmail.labels[]` (system, read-only v1) and `calendars[]` (system keys; owner-editable
  `name`, `defaultEventMinutes`, `workingHours`).
- Sanitizer bounds: ≤ 50 folder nodes, ≤ 20 templates, ≤ 10 spreadsheets, unique keys,
  `targetFolderKey` referential integrity, system-node immutability by deep-compare
  against the seed's system nodes (violation ⇒ 400 naming the exact path).

**System-managed vs owner-defined — grounded in code contracts:**

| Locked (visible with a reason badge) | Why |
| --- | --- |
| `99_Unsorted Intake` root; `05_Correspondence` subtree (`Email Archive`, `Email Attachments`) | `DEFAULT_FILING_RULES` in `app/lib/google-workspace.ts` pins these literal names — renaming breaks email filing |
| Client-directory sheet entry; its tabs/headers (tabs are not in the blueprint at all) | `ensureSheetTabs`/`ensureHeaders` in `app/lib/google-sheets.ts` own the structure |
| `FCI/*` Gmail labels | The filing flow depends on exact names |
| Calendar config keys (`client-appointments`, `field-schedule`, `holidays`) | Runtime config keys; display attributes stay editable |
| Folder identity `appProperties` (`fciRootKey`, `fciFolderKind`, `fciTemplateKey`, `fciResourceKind`) | Rename-safe reconciliation depends on them; never owner-visible |
| Project/client number formats (`L-YYYY-…`, `CL-…`) | Code + PostgreSQL CHECK constraints (`app/domain/lead.ts`, `app/application/create-client.ts`) — changing them is a data migration, not config |

Everything else — other folder nodes, extra spreadsheets, the template list, the Shared
Drive name, business display name, naming patterns, calendar display attributes — is
owner-editable. The engine iterates blueprint nodes and stamps `appProperties` with the
node **key** (not the name), so blueprint renames never orphan resources.

`DRIVE_BLUEPRINT` becomes the literal inside `seedWorkspaceBlueprint()`; a pin test
asserts seed ≡ legacy constant so the migration is provably behavior-neutral. Its
consumers migrate in SET-15 (storage name, labels) and SET-21 (live provisioning).

**Lease / audit / idempotency:** every mutating action copies the lease pattern from
`app/api/v1/projects/[projectId]/drive/route.ts` (`operation_key =
"<connectionKey>:setup:<action>"`, 5-minute lease; the `project_id` column is reused as
the setup-scope key `workspace-setup:<resource-key>` — an unconstrained text column,
noted here deliberately). Idempotency is adopt-before-create everywhere (appProperties
and key lookups, `drives.list` by name, `findOrUploadManagedFile`) plus registry
unique-index upserts. Every action writes a `setup.*` event through
`writeGoogleIntegrationEvent` (`setup.blueprint_updated`, `setup.shared_drive_adopted`,
`setup.drive_roots_ensured`, `setup.spreadsheets_ensured`, `setup.templates_ensured`,
`setup.calendar_verified`, `setup.calendar_created`, `setup.reconcile_run`,
`setup.folder_renamed`) — all appear in SET-09's audit viewer for free. Ambiguity is
always a 409 with candidates (review-first, never auto-pick). **The engine has no
delete path — a dedicated test records every outbound Google call across the setup
modules and asserts zero deletions.**

**Simulation parity:** all routes short-circuit in simulation with fixture IDs
(`workspace-simulation-shared-drive`, `workspace-simulation-directory-sheet`,
`workspace-simulation-template-<key>`), the same response shapes and events, and
registry/blueprint rows under `connection_key='workspace-simulation'`. The simulation
reset route additionally deletes both tables' simulation rows so the full
define→create→verify→maintain journey is repeatable in e2e.

## 2. Setup actions API

All routes: `requireSameOrigin` → `requireOfficeUser(request, {admin:true})` →
`ensureWorkspaceSchema()` → effective config → simulation branch → live call →
registry/blueprint write → audit event → `Cache-Control: no-store`.

- `GET /api/v1/integrations/google/setup/blueprint` → `{blueprint, version, seeded}`.
- `PUT /api/v1/integrations/google/setup/blueprint` — `{blueprint, expectedVersion}`,
  bounded body; sanitize → system-immutability 400 with exact path → version-conflict
  409 → write version+1 + event. Explicit Save only; no autosave.
- `GET /api/v1/integrations/google/setup/resources` — registry + env + blueprint
  resolution only, **no Google calls** (live truth stays button-driven): per resource
  `{key, label, blueprintName, externalId?, source, origin?, url?, updatedAt?,
  scopeGate?}` plus `connectReady`, `simulation`.
- `POST /api/v1/integrations/google/drive/shared-drive/adopt` — adopt/verify only
  (creation stays manual in checklist 01). With an ID: `drives.get` verify → register
  (`env-adopted` when env-sourced). Without: `drives.list` by
  `blueprint.drive.sharedDriveName`; one match adopts, zero → 404 with checklist
  guidance, multiple → 409 candidates for explicit re-POST. The `drives.get`
  `restrictions` field feeds the read-only external-sharing verification chip.
- `POST /api/v1/integrations/google/drive/folders/ensure-roots` — iterates
  `blueprint.drive.roots` with `getOrCreateFolder` identity `fciRootKey=<node.key>` +
  `reuseByName` (adopts and stamps same-name manual folders).
- `POST /api/v1/integrations/google/drive/folders/rename` — `{key, name}`, owner keys
  only (400 for system keys); updates Drive and the blueprint atomically.
- `POST /api/v1/integrations/google/sheets/ensure` — iterates `blueprint.spreadsheets`:
  find by `appProperties {fciResourceKind:<key>}` in the Shared Drive → else Drive
  `files.create` with the spreadsheet mimeType under the target folder (Drive scope
  creates the file — no new scopes). For the system `client-directory` entry only,
  run the exported `prepareGoogleDirectorySpreadsheet` (thin wrapper over
  `ensureSheetTabs` + `ensureHeaders`). `sheets/status` + `sheets/sync` migrate to
  effective config; the env var becomes fallback with visible source.
- `POST /api/v1/integrations/google/drive/templates/ensure` — ensures the Templates
  folder, then iterates `blueprint.templates` with `findOrUploadManagedFile` keyed on
  `fciTemplateKey`. One `GoogleDriveClient` extension: multipart metadata `mimeType`
  (Google-native target) may differ from the media content type — Drive
  upload-conversion under the already-held `auth/drive` scope; **no Docs API scope**.
  Seed templates ship bundled HTML/CSV bodies in `app/lib/workspace-templates.ts`
  rendered with `business.displayName` + the token legend; owner-added templates get a
  minimal titled shell and are authored in Google afterward (definition in the
  blueprint, content in Google). Seed set (5): `estimate-proposal`,
  `installation-work-order`, `change-order`, `pre-install-checklist` (Docs),
  `project-budget` (Sheet).
- `POST /api/v1/integrations/google/setup/reconcile` — Google reads only; key-matched
  drift: `missing` → Create; `renamed` → "Rename in Drive" or "Adopt name into
  blueprint" (system keys offer rename-drive only); `unmanaged` (left the blueprint or
  unstamped inside a managed root) → informational, optional re-add, **never deleted**.
  Mutations happen only through the per-item follow-up actions.
- Calendars, split by scope reality: `POST /calendar/verify` (amended SET-05 —
  `events.list` probe, adopt-by-ID) works with today's `calendar.events` scope;
  `POST /calendar/ensure` (SET-20) requires the stored connection's granted scopes to
  include `auth/calendar` (hard 409 naming the scope otherwise), enabled by the
  `GOOGLE_WORKSPACE_CALENDAR_MANAGEMENT=true` opt-in at next Connect after the WS-14
  owner scope review; `assertGrantedGoogleServiceScopes` gains a superset mapping so a
  granted `auth/calendar` satisfies the `calendar.events` requirement.
- Gmail labels: no new backend — `POST /gmail/labels/prepare` stays the action; labels
  render locked in the blueprint and the resources card links to stepper Step 3.
- Project documents (SET-22, the daily-work payoff): `POST
  /api/v1/projects/[projectId]/drive/files` creates a Google Doc/Sheet/Slides file —
  blank (`files.create` with the Google-native mimeType) or from a blueprint template
  (`files.copy`) — inside the project's provisioned folder. Office-user gated (routine
  work, not admin), requires the folder mapping, returns the open-in-Google link.
  Project files are content, not setup resources: they get activity + integration
  events but no registry rows. The blueprint template `kind` enum gains `"slides"`.

## 3. Dashboard UX — define → create → verify → maintain

All inside `app/settings/components/GoogleWorkspacePanel.tsx`; the
`?section=google-workspace` slug and the five step headings do not change (SET-07);
every state comes from endpoint payloads (guardrail: UI never fabricates backend
state); `AdministratorActionButton` gates every action; office users see explanatory
cards and fire zero admin fetches.

1. **Stepper deltas (minimal):** Step 1 keeps SET-10's health card. Step 2 copy points
   to the setup area. Step 4 gains SET-05's source strings + Verify-access. Step 5's
   unconfigured state points at the spreadsheets row.
2. **New admin "Workspace setup" area** (three collapsible cards, rendered above
   SET-09's future audit card):
   - **Blueprint (Define):** structured editor — folder tree with add/rename/remove on
     owner nodes, lock badges + reason tooltips on system nodes ("Used by email
     filing — renaming would break it"); Templates and Spreadsheets list forms with
     target-folder dropdowns; Business attributes form (display name, naming patterns
     with a token legend, calendar defaults); "Planned" badge rows for catalog items
     not yet editable. Explicit Save (PUT with `expectedVersion`; conflict banner).
   - **Resources (Create/Verify):** one row per blueprint-driven resource — label,
     state chip (`Found` / `Created` / `Adopted` / `Not configured` / `Simulated`),
     source badge (`App-managed` / `Environment value` / `—`), Open link, action
     button (`Adopt` / `Create` / `Verify`). Multi-candidate 409s render an explicit
     picker. Calendar-create rows stay disabled with "Requires the calendar-management
     scope review" until the granted-scope gate opens.
   - **Reconcile (Maintain):** "Check for drift" → drift table with per-row actions;
     empty state "Blueprint and Drive are in sync." Adding a folder next year =
     blueprint edit → Save → drift shows missing → Create. Zero code changes.
3. **Domain & tenant guided checklist card** (pre-connection, collapsible after):
   domain verification, operations account, API enablement, OAuth client + redirect
   URI, hosted secrets, role-aligned Google Groups — one instruction sentence each,
   external console deep links, verification chips computed only from existing
   payloads (SET-04 `missingDetails` presence, connection GET, `connectReady`, and the
   Shared Drive `restrictions` chip once SET-15 lands). Presence/absence only, never
   values; no repo-doc links in UI copy.

## 4. Setup-attributes catalog

Legend: **B** blueprint (owner-editable) · **S** system-managed (visible, locked) ·
**E** env/secret (unchanged) · **W** existing `workspace_settings` · **P** planned-later
placeholder · **M** owner-manual guided checklist.

| Attribute | Lives where | Dashboard edits |
| --- | --- | --- |
| Business display name | **B** | Now (SET-14) |
| Business address / phone | **P** (add to `business` when letterhead templates consume them) | Later |
| Logo / brand assets | Code/repo (PR #57 SVGs) | Never v1 |
| Doc branding content | Google (owner edits template Docs directly) | Via Google, by design |
| Shared Drive name | **B** | Now |
| Folder naming patterns | **B** (closed token set) | Now; consumed at provisioning (SET-21) |
| Project number / client code formats | **S** (code + PostgreSQL CHECK) | Never v1 |
| Timezone | **W** (`workspace_settings.timezone` is the single authority; hardcoded KPI timezone migrates to it later — KPI-track note) | Already editable; consumption later |
| Business-month convention | **P** | Later |
| Default appointment duration + working hours | **B** on calendar nodes | Now (defined; scheduling consumes later) |
| Calendar display names | **B** (keys **S**) | Now |
| Shared Drive external-sharing policy | **M**, verified read-only via `drives.get` restrictions | Verify only |
| Correspondence retention policy | **P** (SET-12 territory) | Later |
| Gmail label taxonomy | **S**; owner extensions | Later |
| Intake/filing rules | Existing `InboxRulesPanel` | Already |
| System notification email | **W**, inert (SET-06) | Already saved; consumer later |
| Sheet mirrors (directory, project register) | **S** structure; enablement **E** | Extras now, structure never |
| Extra spreadsheets | **B** | Now (SET-16) |
| Starter/owner templates | **B** | Now (SET-17) |
| Template variables | **S** closed set, surfaced as a legend | Use, not edit |
| Archive policy for completed projects | **P** | Later |
| Role-aligned Google Groups | **M** (checklist 06) | Guided only |
| OAuth client, secrets, keys, authorized account, allowed domains, enabled services, provisioning flag | **E** | Never (by rule) |

## 5. Boundaries

Global out-of-scope for every packet: no live Google resources in CI or tests
(simulation + mocked fetch only); no secrets in repo, app, or responses; no deployment;
no Docs API scope; no Shared-Drive creation; **no deletion of Google content ever**; no
background jobs; no permissions editor; no freeform-JSON editing; no blueprint-history
UI. The WS owner track (WS-01/02/05–08), the one-account boundary, and the two-OAuth-
client separation are unchanged. Packet sequencing, acceptance criteria, and the test
strategy live in the agent execution plan (SET-13…SET-28, WS-14…WS-16, and
Workstream E).

## 6. July 21 owner additions (summary)

- **Spreadsheet roles:** blueprint `spreadsheets[]` entries carry
  `role: "system-mirror" | "import" | "reference"`. Import sheets feed the SET-25
  first-run client + project import; reference sheets (owner-named future example: a
  project details/ledger table) are registered and readable through SET-27's bounded
  generic reader with no consumers required up front and no write path ever.
- **Maps on client and project screens:** GI-03/GI-04 cover both surfaces; the
  directions link uses the Google Maps URL form that opens the phone's default/Google
  Maps app for turn-by-turn.
- **Two-audience settings:** SET-28 splits the Settings IA into admin "Workspace &
  company setup" and per-user "My settings" (profile display, notification
  preferences for GI-02, per-user defaults), own-rows-only server enforcement,
  honest Planned badges until consumers exist.
