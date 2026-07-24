# Nightly Review Program — findings ledger (July 2026)

**Target:** `origin/main`, re-synced at each night's kickoff. **Method:** per
night — automated scans (viewport capture matrix; overlap / overflow /
touch-target / control-gap / mid-word-wrap detectors with WCAG 2.2 SC 2.5.8
geometry as the violation threshold) followed by 2–3 focused review lenses,
adversarial verification of every P1/P2 candidate, and dedup-first filing
against the open packet backlog and all prior nights. Program index:
[`nightly-reviews/README.md`](nightly-reviews/README.md).

**Grammar note:** findings use four-hash headings `#### N<night>-<seq> ·
<title> (P<sev>)` (outside the tracking guard's packet-structure assertions);
fix-packet drafts use `## NFIX-<nn> · <title>` with a grammar-legal status
line and appear in the Packets section below. This document joins the tracking
guard's tracked-document list in the same PR that files the first NFIX packet.

---

## Nights

*(Findings append here per night as `## Night N — <theme>` sections.)*

---

## Packets

*(NFIX packet drafts append here; none filed yet.)*
