# Brett — Google console handoff (one page)

**Who this is for:** Brett (Workspace/Cloud administrator).
**Total time:** roughly 3–4 hours, in four independent blocks — they don't have
to happen in one sitting, and the app build continues regardless (everything is
simulation-tested until these land).
**The two ground rules, before anything else:**
1. **Read-only first.** Blocks 1 and 2 are inventory/verification only. Do not
   change APIs, IAM, billing, OAuth, or Admin-console settings until Jason has
   reviewed what you found and approved the exact changes.
2. **No secrets in email or GitHub — ever.** Client secrets, keys, and tokens go
   only into the hosting configuration Jason points you to. Names and IDs of
   things (project ID, domain, calendar names) are fine to report.

---

## Block 1 · Workspace resources verification (~45 min, read-only)

Confirm what the company Workspace already has, using
[Workspace resources — checklist 01](task-checklists/01-workspace-resources.md):
the verified domain, the operations connector account (the ONE account the app
will connect as — not a personal account), that Drive/Gmail/Calendar/Sheets are
enabled for it, Shared Drive support on the current Workspace edition, the
client-directory Sheet, the intake mailbox, and the two calendars. **Report
back:** the checklist's facts list — names/IDs only.

## Block 2 · Google Cloud + OAuth inventory (~1–1.5 hr, read-only, then gated changes)

Using [Google Cloud and OAuth — checklist 02](task-checklists/02-google-cloud-and-oauth.md):
inventory the company's existing Cloud project candidate — project ID, parent
organization, what it's currently used for, who has IAM roles, billing state,
which APIs are enabled. **Report back the checklist's non-secret facts and
STOP.** After Jason reviews and approves, the follow-up (same checklist) is:
enable the required APIs, configure the **Internal** OAuth consent screen, and
create the OAuth client with the exact redirect URI the app's setup screen
displays (copy-paste it — one wrong character and sign-in fails).

## Block 3 · Maps key (~30 min, after Jason approves Block 2 changes)

Enable Maps billing on the approved project and create a **restricted browser
key** (HTTP-referrer locked to the app's domains, Maps APIs only). This is the
one thing blocking live job-site maps on the client/project screens. Hand the
key to Jason for hosting configuration — not by email.

## Block 4 · Google-native quick wins (~1 hr, no code involved)

The items in [Google quick wins — checklist 11](task-checklists/11-google-quick-wins.md) —
small Workspace-side setup (labels, templates, calendar sharing conventions)
that makes the app's integrations land cleanly later.

---

**What happens with what you report:** Jason reviews Blocks 1–2 findings, then
approves the exact changes; the app connects only the one operations account,
only after that approval, and nothing in these blocks admits a second app user
or touches real client data. If anything looks off (wrong project, unexpected
IAM members, billing surprises), stop and flag it — that's exactly what the
read-only pass is for.
