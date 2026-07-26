# Project meeting notes and Otter

## What the development environment supports now

Every durable project has a **Meetings** tab. An office user can save:

- meeting title, date, type, and attendees;
- a restricted Otter conversation link or another HTTPS source;
- the Otter summary, decisions, and action items;
- additional meeting notes; and
- an optional pasted transcript or exported Otter text.

The app stores the meeting against exactly one project, records an activity event, and makes the saved summary, decisions, action items, notes, and a bounded transcript excerpt available to the project assistant as cited evidence.

**Meeting types (updated July 24, 2026; AI-02c landed the same day):** each meeting is saved with one of the types `client`, `site-walk`, `internal`, `pre-install`, `closeout`, `phone-call`, or `other`, and the **Add meeting** form offers all seven — including **Phone call** (added by AI-02c). Phone calls are captured as meetings against a project, with call summaries and action items flowing into the same project record and assistant evidence.

### Assistant and automation boundary (reconciled July 26, 2026)

The Assistant can search the saved meeting fields as project evidence. Its
review panel can also propose tasks from one saved meeting: with
`OPENAI_API_KEY` configured and **Task extraction from meetings** enabled, the
provider returns bounded proposals; without the key, the panel offers the
meeting's literal saved action items. In either mode, proposals are not task
rows until an office user presses **Accept** on each one.

This is manual capture, not phone-system or Otter ingestion. Neither
simulation nor live mode pulls a transcript from Otter, a VoIP provider,
Calendar, or Google automatically. A signed provider intake remains AI-T2-6
and is gated on the accepted production platform, an owner-chosen provider
and plan, and a review-first intake queue.

## Recommended first-release workflow

1. Record the meeting with Otter and review speaker names before sharing it.
2. Keep the conversation restricted to approved people. Avoid public links for client or employee information.
3. In FCI Operations, open the exact independent project and select **Meetings**.
4. Select **Add meeting** and paste the Otter conversation link.
5. Copy Otter's Summary into **Summary**, its decisions into **Decisions**, and its action items into **Action items**.
6. Add any flooring-specific observations that Otter may not capture well, such as moisture readings, transition details, substrate issues, client selections, access restrictions, and measurements.
7. Paste or export the transcript only when full searchable context is useful.
8. Save and review the meeting inside the project before relying on it for follow-up or AI questions.

Otter documents conversation sharing controls and revocable restricted links in its [sharing guide](https://help.otter.ai/hc/en-us/articles/360048338793-Share-a-conversation). It supports transcript exports such as TXT, DOCX, PDF, and SRT depending on the plan, according to its [export guide](https://help.otter.ai/hc/en-us/articles/360047733634-Export-conversations).

## Automation options

### Option 1 — Manual and review-first (implemented)

Best for the current development environment. It works with any Otter plan that can share or export a conversation, requires no additional secret, and forces the user to choose the exact project.

### Option 2 — Zapier-assisted import

Otter's official Zapier integration can export transcripts, summaries, and action items for Pro, Business, and Enterprise accounts. A future signed FCI intake endpoint could accept the Zapier payload, match a project number in the meeting title, and place ambiguous matches into a review queue. The existing authenticated browser endpoint should not be exposed as a webhook. See Otter's [Zapier integration guide](https://help.otter.ai/hc/en-us/articles/27616131311127-Zapier-Otter-ai-Integration).

### Option 3 — Otter Enterprise API and webhooks

Otter's public API and Workspace webhooks are available to Enterprise workspaces. Webhooks can deliver the transcript, abstract summary, action items, insights, outline, and calendar guests when a conversation is ready. This is the cleanest future automatic path because calendar guests can help match client contacts while a project number remains the safest primary key. See Otter's [Public API guide](https://help.otter.ai/hc/en-us/articles/36130822688279-Otter-ai-Public-API) and [Workspace Webhooks guide](https://help.otter.ai/hc/en-us/articles/35634832371735-Workspace-Webhooks).

## Safe automatic matching design

Automatic imports should never guess silently. Use this order:

1. exact project number in the Otter title or calendar event;
2. exact calendar-event link already stored on a project appointment;
3. client-contact email plus exactly one eligible active project; or
4. **Needs review** when more than one project is possible.

After matching, show a preview and require approval before creating project tasks or indexing the full transcript. Store webhook receipts for idempotency and retain the original exported transcript in the project's Shared Drive folder when live Workspace storage is available.

## Next meeting-specific improvements

- Edit and archive meeting records with version history.
- Upload exported TXT, DOCX, or PDF transcripts directly into the project.
- Link accepted tasks back to their source meeting and add edit/archive
  history for those task records.
- Associate Calendar appointments with the resulting meeting record.
- Add a signed Otter/Zapier webhook intake and a review queue.
- Store the canonical transcript file in Shared Drive while keeping searchable metadata and approved excerpts in the app.
- Add transcript retention, consent, and AI-indexing controls to Settings.
