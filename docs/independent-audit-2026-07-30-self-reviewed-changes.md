# Independent audit of July 30 self-reviewed changes

**Audit base:** `dafb81d7a4268b223b8e86801850c3e36c538ec3`

**Scope:** behavior-changing commits `9cdf888`, `085ae75`, `37d75aa`,
`f6929ae`, and `b3799e4`, plus ledger/documentation commits `eaebbf5`,
`7b99311`, `d70d38c`, and `5885fd7`.

This audit treated the merged source and executable tests as evidence. Commit
messages and pull-request commentary were not used to validate behavior.

## Findings

### 1. AI-11 cannot currently distinguish an accepted lead from a dismissal

The AI-11 amendment says the stored status makes review outcomes and per-label
accept/dismiss counts answerable, and proposes adding only `reviewed_by` and
`reviewed_at` for attribution. That is not true for the shipped lead-accept
path:

- `InboxView` creates the lead, then calls `markReviewed(row, "lead-created")`.
- `markReviewed` sends only the row ID to the existing inbox-analysis PATCH.
- The route calls `dismissNeedsReview`.
- Both the D1 and PostgreSQL mail-item adapters set the row status to
  `dismissed`.

Consequently, a lead accepted through **Create lead** is indistinguishable in
`mail_items` from a manual **Mark reviewed** dismissal. An activity view built
from the current rows would misstate the accepted/dismissed outcome and its
per-label counts. Adding actor and timestamp columns alone does not close that
gap.

The follow-up must preserve the single-writer rule while passing an explicit,
server-validated review outcome through the inbox-analysis route so a
successful typed accept is stored as `accepted`. At audit time, draft PR #255
owns the AI-11 ledger and review paths, so this report intentionally does not
race that PR by editing the packet in place.

### 2. The EDIT-07 residual overstates which undated task is truncated

The EDIT-07 residual says undated rows sort last and “a newly created task with
no due date is therefore exactly what goes missing.” Both adapters instead
order the undated group by `updated_at DESC`:

- D1: `due_date IS NULL, due_date, updated_at DESC, id`
- PostgreSQL: `due_date NULLS LAST, updated_at DESC, id`

If any undated rows fit inside the 200-row result, the newest undated task is
retained ahead of older undated tasks. It can still be omitted when 200 dated
tasks consume the entire cap, but it is not inherently the first undated row
lost. The accurate statement is that undated tasks are at risk after dated
tasks, with the oldest undated tasks falling off first once the result reaches
that group.

This is a ledger accuracy defect, not a defect in the shipped truncation
notice.

## Behavior checks with no substantive finding

### `9cdf888` — D1 duplicate-name scan

The conditional normalized-name precheck does not let a genuine rename create
a new normalized duplicate:

- A changed NFKC/trimmed/whitespace-collapsed/lowercase key still runs the
  repository-wide precheck, including legacy rows whose stored normalized key
  is null.
- The partial unique index on `normalized_name_key` is the atomic race guard
  and catches normalized equivalents that the statement's `LOWER(name)` guard
  cannot express.
- The version fence protects the current row, and the post-failure scan
  classifies duplicate outcomes.

A same-normalized-key display edit can proceed within a duplicate class that
already existed in legacy data. It does not create a new normalized duplicate;
the lazy migration policy lets one legacy row claim the key and forces another
row in that pre-existing class to rename before it can claim the same key.

### `085ae75` — client industry split

The consumer census found no missed third representation:

- list chips and their accessible descriptions use display `industry`, whose
  legacy null fallback remains `Commercial`;
- the drawer, edit modal, and report buckets use `industryRaw`, whose null
  state is `Unspecified`;
- save paths update both projections;
- project-segment behavior remains intentionally independent;
- API, assistant, and persistence paths consume the raw database value;
- the Sheets mirror does not currently expose an industry column.

### `37d75aa` — task truncation notice

`tasks.length >= MAX_TASK_LIST_RESULTS` is a conservative boundary, not a false
statement. The API rejects limits above 200 and exposes no `hasMore` signal, so
exactly 200 returned tasks cannot prove whether another row exists. The notice
says there *may* be more rather than claiming truncation occurred.

Importing `MAX_TASK_LIST_RESULTS` into the client module is browser-safe:
`app/domain/task.ts` and its `record-version` dependency contain no
server-only, Node, Cloudflare, filesystem, environment, or secret-bearing
imports.

### `f6929ae` — workspace operations simulation copy

The simulation-only toolbar and empty integration-event paragraph both branch
on `payload.simulation`. No remaining card or route response string asserts
simulation-only behavior in workspace mode. The route derives `runtimeMode`
and `simulation` from the same runtime configuration.

### `b3799e4` — blank-contact test pin

The test is mutation-sensitive rather than an implementation restatement. It
separately proves that a supplied blank primary contact is rejected and that an
omitted contact still succeeds as `null`; reverting to silent blank-contact
discard or rejecting all omissions breaks one of those controls.

The other claims in all four ledger/documentation commits matched the shipped
source.

## Verification

- `npm test` — exit `0`; 1,344 tests total, 1,327 passed, 17 skipped.
- `npm run lint` — exit `0`.
- `npm run test:e2e` — exit `124` from the 1,204.1-second command timeout. The
  incomplete run left 126 failure contexts: 24 included Vinext
  `file:///.../.vinext/fonts/...` browser errors and 89 included
  `ERR_CONNECTION_REFUSED` after the local server became unreachable. This is
  not reported as a pass.
- Focused source/adapter audit suite — exit `0`; 32/32 passed:
  `edit06-client-contact-editing`, `client-industries`,
  `edit07-task-management-ui`, and `ws10-connection-operations`.
- Focused affected Playwright coverage — exit `0`; 12/12 passed across industry
  surfacing, client editing, task management, and workspace operations health.

This PR changes documentation only. It does not change application behavior,
data, authorization, hosted configuration, migrations, live resources, or
deployment state.
