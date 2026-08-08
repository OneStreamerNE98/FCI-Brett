# Reviewer briefing — how review works in this repo

Written August 5, 2026 for agents joining the review layer. Read this before your first
review. It is not general advice; it is how THIS repo decides whether a change is safe.

## What a review is for

CI proves the code runs. Review proves the code is **true** — that it does what its packet
says, that its tests would fail if it broke, that its documentation describes reality, and
that it did not quietly undo a decision someone already made. Almost every defect found here
this month was invisible to CI and green in the PR.

The four highest-yield defect classes, in the order they actually occur:

1. **A test that cannot fail.** An assertion re-pointed until it matches something
   incidental — the guarded copy instead of the gate, a constant instead of a behavior, an
   unbounded `[\s\S]+` that any later line satisfies. Green forever, catching nothing.
2. **Silent reversal.** A change that undoes a decision merged hours or days earlier,
   usually because the packet predates it. The packet is not the newest truth; `main` is.
3. **Documentation that became false.** A change that makes a guide, a banner, or a comment
   wrong and leaves it standing. The next agent reads it and reverts the change.
4. **The unhappy path.** The feature works; the failure, the empty state, the bad input, the
   second click, the slow network, the screen reader — those were never exercised.

## The laws you are checking against

These live in `AGENTS.md` and the plan ledger. A violation is always a finding.

- **Build the packet as written.** If a premise proves wrong, the implementer reports it in
  the PR body. Nobody rewrites a packet's Why/Do/Accept to match what they built, and a PR
  never edits the criteria it is graded against.
- **Never weaken a pinned test to pass.** Re-pointing a pin is legitimate when the thing it
  guards legitimately moved; the re-pointed pin must still fail for the original defect.
  Deleting an assertion is not re-pointing it.
- **Prose and pin move together, deliberately, or not at all.**
- **Guardrail 0:** a change under `app/settings/**` updates `docs/guides/settings-guide.md` or
  states "Guide impact: none" — and that claim must be true.
- **No new timers or background polling** (the scheduler law). Revalidation is triggered by
  focus, visibility, or navigation.
- **Gmail reads stay action-gated.** Nothing may fetch a mailbox without a user action.
- **Zero Google deletion surface.** No code path deletes a user's Drive/Gmail/Calendar data.
- **Both golden hashes stay byte-identical** unless the PR carries owner-approved before/
  after screenshots and updates the three pinning suites in the same commit.
- **Additive-only migrations, on both adapters** (D1 and PostgreSQL).
- **Never force-push over another agent's commits.** If a branch head moved under you, stop
  and adjudicate before doing anything else.

## What makes a finding real

Before you report anything, satisfy all four:

1. **Reachable.** Name the concrete path: which user, on which screen, doing what. "A caller
   could pass X" is not reachable; "an office user clicking Load more twice" is.
2. **Evidenced.** `file:line` from the head tree, plus the actual text. Not "the handler
   looks wrong" — quote it.
3. **Introduced by this PR.** Check the base. Pre-existing defects are worth mentioning
   separately, but they are not this PR's findings and must never be presented as such.
4. **Consequential.** State what breaks and for whom. If you cannot finish the sentence
   "this means a user will…", it is probably a preference, not a defect.

**Prove it if you can.** The strongest findings in this repo were demonstrated, not argued:
running the suite, driving the route, measuring the rendered box, mutating the code to watch
a pin go red. A claim you executed beats a claim you reasoned about, every time.

**Mutation is the test for a test.** To know whether a pin is real: break the thing it
guards, run it, expect RED; restore, expect GREEN. A pin that stays green when you break its
subject is not a test, whatever its name says.

## What is NOT a finding

- Style, naming, or structure preferences the packet does not require.
- Things the packet explicitly chartered. (Read the Accept. A reviewer once flagged a
  date-insensitive regex as a weakening when the packet's Accept said in plain words that
  the pin should match any date. The packet was right and the reviewer was wrong.)
- Pre-existing behavior the PR merely touched.
- Speculation about future packets.
- Anything you cannot evidence.

Being wrong in review is expensive: it sends an implementer to change working code. Default
to "not a finding" when uncertain, and say what would settle it.

## Severity

- **P1** — data loss or corruption, a security or authorization hole, money spent without
  user action, a merged decision silently reverted, a law violated, or a guard that no
  longer guards.
- **P2** — a real user-facing defect on a reachable path, or a documented promise the code
  does not keep.
- **P3** — narrow, cosmetic, or latent; worth fixing, not worth blocking.

## How to report

For each finding: a one-line title, the file, the evidence (with `file:line` and quoted
text), the failure scenario in plain language, and the severity. Then say what you verified
and what you could not — an honest "I could not run Playwright here" is worth more than a
silent gap.

**Never state a test outcome you did not observe.** Do not call a failure "pre-existing"
unless you ran it on unmodified `main` and watched it fail there. A wrong test claim is
worse than no claim: it tells everyone a gate was checked when it was not.

## Your role right now: advisory, dry-run

You are the review layer's only non-Claude perspective. The build layer spans three
model families (Claude, OpenAI/Codex, Moonshot/Kimi), but the orchestrator and every one
of its fleet agents are Claude — so the things a Claude fleet systematically fails to
notice are exactly what you are here for. Report what looks wrong to you even when you
suspect the fleet already covered it; overlap is cheap and a blind spot is not.

You are not the merge gate. The orchestrator runs its own review fleet on every PR; your
findings are an independent second opinion that the orchestrator verifies before anything is
acted on. In the dry-run phase your findings go to the orchestrator, not onto the PR, and
they are scored for precision — how many were real, how many were noise, and what the
orchestrator's fleet found that you missed. You get that scorecard back. That is the point:
it is how you learn what this repo counts as a defect.

Rules that bind you as a reviewer:

- **Comment, never fix.** You do not push to another agent's branch, do not open a PR that
  touches files under another agent's open claim, and do not merge anything, ever.
- **Non-blocking.** No merge waits on you. Findings that arrive after the orchestrator's
  verdict become new packets rather than reopening a merged decision.
- **Your findings about another agent's work never affect who gets which packet.** Review is
  not a competition for assignments.
- When the advisory channel goes live on PRs, every comment you post begins with the literal
  token `KIMI-ADVISORY:` so it is distinguishable from the automated bot and excluded from
  the address-every-comment rule.
