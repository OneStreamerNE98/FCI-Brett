/**
 * The intake mailbox is the one saved preference the Workspace defaults panels
 * ("Calendar & appointments" and "Workflow & notifications") must never write.
 * GoogleWorkspacePanel owns that selection (SET-41); neither defaults panel renders a
 * mailbox control at all, so any mailbox value they send is an echo of what the settings
 * GET happened to return when the tab loaded.
 *
 * Echoing it is not harmless, because the PATCH route treats PRESENCE of the key as intent
 * (`Object.hasOwn(body, "intakeMailbox")` selects the branch that writes the mailbox). A
 * full-form defaults save that carries the key therefore:
 *   - silently reverts a newer mailbox chosen in another tab, and flips readiness
 *     `oauthReady` false, because the restored address no longer matches the connected
 *     account; and
 *   - hard-400s EVERY defaults save once the stored address drops off
 *     `GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS`, in a panel with no mailbox control to correct
 *     it with.
 *
 * Omitting the key is what engages the route's absent-key branch, which preserves the
 * stored mailbox. Note that sending `intakeMailbox: ""` is NOT equivalent: it passes
 * validation and then clears the stored selection, so the fix has to happen on the request
 * body rather than by blanking the panel's state.
 */
export const WORKSPACE_DEFAULTS_UNOWNED_SETTING = "intakeMailbox";

/**
 * Builds the request body for a defaults-panel save: every preference the panel owns, and
 * never the intake mailbox.
 */
export function buildWorkspaceDefaultsPatchBody<Values extends Record<string, unknown>>(
  values: Values,
): Omit<Values, "intakeMailbox"> {
  // Mirrors the filter the route applies on the way in, so the two agree on the one key.
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => key !== WORKSPACE_DEFAULTS_UNOWNED_SETTING),
  ) as Omit<Values, "intakeMailbox">;
}
