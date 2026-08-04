# FCI Operations exhaustive responsive-layout audit

> Owner-commissioned Opus review, delivered August 4, 2026, and committed verbatim as the
> evidence record for the DES-19…DES-24 packet series (filed the same day in the plan
> ledger). Figma evidence board:
> https://www.figma.com/design/9vQmt62QJLuOoAQ6ObAUcs

**Audit date:** August 4, 2026
**Live/source commit:** `e8a4a882a1c6e00c4749acff57b4efc7a79dd78a` (`origin/main`)
**Live URL:** https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/
**Figma evidence board:** https://www.figma.com/design/9vQmt62QJLuOoAQ6ObAUcs
**Method:** read-only live-browser review plus source/test review. No form was submitted and no mutation, deployment, configuration, migration, or data change was made.

## Executive verdict

The default screens are more stable than they feel: across 18 live surfaces at 390×844, 820×1000, and 1280×900 (54 baseline screenshots), I found **no static interactive-control overlaps** and no page-level horizontal overflow outside the intentionally horizontally scrolling Leads board. The weakness is the state-change framework. Conditional controls are laid out by many local flex/grid rules and breakpoint patches, so the layout can become visibly uneven only after an action reveals edit controls, a nested modal, a result panel, or a busy state. That is why default-route checks stay green while the product still feels fragile.

Overall responsive health: **Fair (C+/B-)**. The shell, core cards, and most phone forms are solid. The Settings information architecture, conditional action groups, and nested-overlay scroll model need structural repair before calling the framework phone/tablet/laptop-ready.

## Review coverage

1. **Baseline route sweep — Good.** Captured Overview, Leads, Clients, Projects, Schedule, Inbox, Assistant, Reports, People & Access, and all nine Settings destinations at phone/tablet/laptop sizes.
2. **Conditional-state sweep — Needs work.** Exercised safe read-only states: Overview layout edit, lead and project drawers, project edit modal, filing-rule modal, Assistant tabs/help, Workspace Stage 3/4 disclosures, and Calendar loading/result states.
3. **Responsive breakpoint sweep — Needs work.** Inspected 390, 820, 834, 960, 1024, 1180, and 1280 widths. The 820/821 and 1180/1181 boundaries are the two important cliffs.
4. **Accessibility/keyboard — Generally good, incomplete by design.** Escape closes tested modals; the shared overlay stack inerts the background and retains focus containment. This was not a full WCAG conformance audit.
5. **Source architecture and test review — Needs work.** Reviewed layout primitives, global responsive rules, overlay behavior, Workspace actions, and the relevant Playwright suites.

## Highest-priority findings

### P1 — Conditional layout-edit controls break card alignment on ordinary laptop widths

At 1280px, the Overview page switches to a two-column section grid. Edit mode then injects up to four controls into each half-width section header. `Lead pipeline` and `Scheduling` visibly wrap their titles and controls into uneven two-line arrangements, while full-width sections remain one line. This is the clearest reproduction of the reported problem.

The cause is structural:

- `.page-layout-grid-overview` returns to two columns above 1180px.
- PageLayoutEditor controls remain one flex row above 820px.
- The ordinary keyboard controls are only 32px high; only `Full width` is forced to 44px.
- The current test asserts no document overflow, Axe results, and a 44px `Full width` button, but not control-row wrapping, equal header height, title integrity, or the other buttons' target sizes.

**Fix direction:** introduce a shared `ResponsiveActionGroup`/`EditableSectionHeader` contract. Use a container query based on the section's available width—not viewport width—to switch the actions to a compact menu or a stable two-row grid. Give every control the same minimum target height and pin the 1181/1280 half-width states in tests.

Evidence: `dynamic-laptop-overview-edit.png`; `PageLayoutEditor.module.css` lines 66–67 and 164–192; `globals.css` line 85; `page-layouts.spec.ts` lines 322–346.

### P1 — Settings has a phone/tablet navigation architecture problem, not just spacing bugs

At 390px the nine-item Settings section index is placed in normal flow before the active panel. The active Google Workspace panel starts around **y=906**, below the 844px first viewport. At 820px the index is still about 431px tall, so only the beginning of the selected panel appears below it. Immediately above that breakpoint (measured at 834px), the desktop sidebar and 220px Settings rail remain active, leaving only **278px** for the selected panel.

The source already contains a detailed 821–900 patch explaining that settings headings overhang in this narrow column. That patch fixes individual headings, not the underlying three-column pressure.

**Fix direction:** at tablet/phone sizes replace the full section index with a compact sticky section selector/disclosure. At intermediate widths, collapse either the app rail or the Settings rail before shrinking content below a defined minimum. Use a container query/minimum-content contract so 820/821 is not a cliff.

Evidence: `phone-contact-sheet.png`, `tablet-contact-sheet.png`; measured panel positions; `globals.css` lines 78, 253, and 860–886.

### P2 — Nested drawer + edit modal produces two visible scroll systems

Opening a project drawer and then `Edit project` leaves the drawer mounted behind the modal. The shared overlay correctly makes the drawer inert, so this is not an authorization or focus-escape bug. Visually, however, phone and tablet show the modal scrollbar beside the background drawer scrollbar. The user must infer which layer owns scrolling, and the underlying drawer remains visible as a second context.

**Fix direction:** use one active scroll owner. Either replace the drawer body with edit mode, close/hide the drawer while the editor is open, or make the nested modal backdrop visually cover the drawer scroll track. Add an assertion that only the top overlay has a visible scroll container and scrollbar.

Evidence: `dynamic-phone-project-edit.png`, `dynamic-tablet-project-edit.png`; `AccessibleOverlay.tsx` lines 100–211; the project drawer/edit composition in `FloorOpsApp.tsx`.

### P2 — Global overflow hiding can make clipping tests pass

Both `html/body` and `.app-shell` set `overflow-x:hidden`. The source itself notes a Settings card whose right edge was clipped by that box. A test that only compares document scroll width to viewport width can therefore pass while a child is visibly cut off.

**Fix direction:** keep any deliberate overflow containment local. Add a generic test that checks visible descendants against their nearest clipping ancestor, not only the document. Fail on hidden right edges unless the element is inside an explicitly allow-listed scroller.

Evidence: `globals.css` lines 32, 36, and 860–863; `nfix06-tablet-band.spec.ts` documents the nearest-clipping-box test pattern.

### P2 — Shared busy booleans change unrelated buttons' meaning

In Workspace Calendar verification, clicking the read-only `View upcoming events` action changes both buttons to disabled `Loading…` and `Creating…`. The second control claims a create operation is in progress even though none was requested. Shared busy state can also change button widths and destabilize horizontal action rows.

**Fix direction:** model per-action state (`calendarReadState`, `calendarCreateState`) and keep unaffected controls' labels stable. A row-level disabled state may remain, but it must not rename an action that was not invoked.

Evidence: `dynamic-phone-workspace-calendar-result.png`; `GoogleWorkspacePanel.tsx` lines 1607–1608.

### P2 — Border-on-border card nesting inflates Settings screens and weakens hierarchy

The Client Directory screen demonstrates a broader surface-depth problem. One selected Settings panel contains an outer bordered `.panel`, a bordered configuration warning, two individually bordered mirror-status cards, and two more bordered explanation cards. Additional full bordered panels continue immediately below. The content is not unusually large, but every nested outline adds padding, corner radius, and gap, making the screen look heavier, longer, and more complex than the task actually is. The effect is strongest on phone and tablet, where the same nested cards become a tall vertical stack.

The owner-provided Stage 4 screenshot is an even clearer reproduction. A Sheets status card sits inside four progressively inset visual layers: the bordered Setup Stage, bordered verification group, bordered verification row, and two bordered sheet-summary articles. Their padding totals roughly 49px per side before the innermost summary content, excluding the page and panel margins. The result is a narrow "card tunnel": content and buttons lose useful phone width while repeated outlines dominate the screen. Calendar has three of those structural layers and the same visual weight problem. This is therefore responsive-layout debt, not merely decorative taste; it will worsen at narrower widths and browser zoom.

This is not a request to remove every border. The configuration warning is semantic and should remain visually distinct. The problem is that structural grouping, semantic status, and ordinary supporting information all use nearly the same bordered-card treatment, so the hierarchy has too many equally strong containers.

**Fix direction — establish a surface-depth grammar:**

- Allow one primary bordered surface per major Settings section.
- Inside that surface, use spacing, headings, subtle background bands, or dividers for ordinary subgroups—not another complete card outline.
- Reserve colored/tinted borders for semantic warning, error, and success states.
- Flatten the Client Directory `.directory-sync-summary article` and `.directory-layout > div` treatments inside the parent panel; retain their headings and content grouping.
- Flatten Stage 4's `.verificationGroup` and/or `.verificationRow` hierarchy so a verification item never accumulates more than two simultaneous structural outlines; render the Sheets pair as divided rows or a light inset band rather than cards inside a card inside a card.
- Avoid placing two full bordered panels directly adjacent without a clear section-level reason.
- Preserve focus indicators and contrast; do not make border removal the only way groups are distinguished.

**Packet-ready acceptance:** at 390, 820, and 1280 widths, Client Directory has one clear primary container, the configuration warning remains visibly semantic, nested informational groups do not show full four-sided outlines, and Stage 4 shows no more than two simultaneous structural outlines around any verification content. Actions/copy remain unchanged; verification status remains obvious without relying on borders alone; screenshots demonstrate materially wider content and reduced vertical density without a golden-hash change unless separately authorized.

Evidence: `user-example-stage4-border-tunnel.png`, `phone-14-settings-client-directory.png`, `tablet-14-settings-client-directory.png`, and `laptop-14-settings-client-directory.png`; `DirectorySyncPanel.tsx` lines 587–650; `GoogleWorkspacePanel.module.css` lines 267–325; `globals.css` lines 643–674 and the `.directory-sync-summary article` / `.directory-layout > div` rules around line 83.

## Additional findings

### P2 — The mobile Leads board is responsive by scrolling, but not phone-optimized

At 390px the four-stage board becomes a horizontal flex scroller with 260px columns. The next column is visibly clipped and the only affordance is the browser scrollbar. This is intentional CSS, but it is easy to miss stages and awkward with touch/keyboard.

**Fix direction:** use stage tabs/segmented control or a one-column accordion on phones; preserve the board for tablet/laptop. If the scroller remains, add an explicit stage-position cue and snap points.

Evidence: `phone-02-leads.png`; `globals.css` lines 255–256.

### P3 — Target sizes are inconsistent in conditional states

The Assistant tabs render at 40px on a 390px viewport; lead form controls render around 40–41px; PageLayoutEditor desktop controls are 32px. Some native checkbox inputs are smaller but have larger labels, so raw input dimensions are not automatically failures. The inconsistency is the problem: the 44px target is applied through long selector allowlists rather than one primitive contract.

**Fix direction:** make the interactive primitives own target size, and test the actual clickable label/control box. Keep dense desktop variants explicit and documented.

### P3 — Responsive behavior is maintained as many viewport patches

Across 25 CSS files, the census found 11 distinct breakpoint values and 142 action/header/footer/control layout rules; only nine explicitly wrap. Counts are directional rather than a defect count, but they explain the regression pattern: every new conditional button depends on the local author remembering the correct breakpoint override.

**Fix direction:** converge on a small set of container-aware primitives: `PageHeader`, `PanelHeader`, `ResponsiveActionGroup`, `ModalFooter`, `DisclosureHeader`, and `SettingsSectionSwitcher`.

### P3 — Tests are strong on defaults but weak on state transitions

Existing coverage is valuable: golden markup hashes, 390px overflow checks, project-drawer focus trapping, and serious/critical Axe checks. The general route Axe sweep covers only default route states at 1280 and 390. Page-layout tests verify the edit controls exist and do not create document overflow, but do not pin visual row alignment. Tablet breakpoint states and nested overlays are underrepresented.

**Fix direction:** add a reusable state-matrix test that takes `{route, trigger, stableState, viewports}` and asserts:

- no element escapes its nearest clipping ancestor;
- action groups use one of the sanctioned layouts;
- titles/buttons do not wrap unless that variant explicitly allows it;
- one visible scroll owner per overlay stack;
- focus remains inside the top overlay;
- controls retain stable labels unless they initiated the action;
- screenshots at 390, 820/834, 1181, and 1280.

## What is working well

- No static button-to-button overlaps were found in the 54 baseline screenshots.
- Core Clients, Projects, Reports, and most modal forms reflow cleanly at 390px.
- Phone drawer footers stack actions predictably.
- Workspace stage cards and the Assistant help disclosure are visually organized on phones.
- `AccessibleOverlay` has a real stack, body lock, outside `inert`, Escape handling, and focus restoration.
- No application console error appeared in the audited interactions; only a Google Maps debug message was observed.

## Recommended repair sequence

1. **UI-R1 — Responsive layout primitives and dynamic-state guard.** Build the shared action/header/overlay contracts and the generic nearest-clipping/state-matrix test first.
2. **UI-R2 — Settings navigation and 821–900 breakpoint architecture.** Remove the double-rail/tablet squeeze and the full phone section index before active content.
3. **UI-R3 — Conditional action migrations.** Move PageLayoutEditor, Workspace verification rows, Inbox headers, drawer footers, and form result panels to the primitives.
4. **UI-R4 — Overlay scroll ownership.** Resolve drawer→modal nesting and add one-scroll-owner/focus assertions.
5. **UI-R5 — Leads phone presentation and target-size cleanup.** Replace or clarify the horizontal board and consolidate the 44px target contract.
6. **UI-R6 — Settings surface-depth and border grammar.** Define one primary surface per section, reserve strong borders for semantic states, and flatten nested informational cards beginning with Client Directory.
7. **Regression pass.** Screenshot every route in default, loading, success, error, expanded, and modal/drawer states at 390, 430, 768, 820, 834, 1024, 1181, 1280, and 1440. Keep the current golden hashes unless a separately approved design packet changes their protected markup.

## Evidence files

- `phone-contact-sheet.png`
- `tablet-contact-sheet.png`
- `laptop-contact-sheet.png`
- `dynamic-laptop-overview-edit.png`
- `dynamic-phone-project-edit.png`
- `dynamic-tablet-project-edit.png`
- `dynamic-phone-workspace-calendar-result.png`
- `dynamic-phone-lead-drawer.png`
- `dynamic-phone-add-lead-modal.png`
- `dynamic-phone-add-rule-modal.png`
- `dynamic-phone-assistant-help.png`
- `phone-14-settings-client-directory.png`
- `tablet-14-settings-client-directory.png`
- `laptop-14-settings-client-directory.png`
- `user-example-stage4-border-tunnel.png`
- `phone-results.json`, `tablet-results.json`, `laptop-results.json`
- `layout-code-census.json`

(The screenshots and JSON live on the Figma evidence board linked above.)

## Limits

This review intentionally did not submit forms, sync Google data, create holds/files, invoke AI suggestions, or run destructive/mutating paths against the live development site. Those states were reviewed from source and existing tests. A separate implementation task should reproduce them with deterministic mocked fixtures before making changes.
