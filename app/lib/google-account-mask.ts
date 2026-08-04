/**
 * The one masked form of a Google account address, for every surface whose audience is
 * wider than administrators: the first two characters of the local part, then `•••@domain`.
 *
 * Readiness labels are the reason this is shared rather than inlined. `missing` and
 * `missingDetails` are returned by `GET /api/v1/google-workspace` to every office user, not
 * just administrators, while the same response masks the connected address one field away
 * (`connection.account`). Any label that names the connected account has to use this form,
 * or the masking beside it is decorative.
 *
 * Returns `null` when the value is not a usable address, so each caller decides what to
 * render in its place.
 */
export function maskGoogleAccountAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const separator = normalized.indexOf("@");
  if (separator < 1) return null;
  const domain = normalized.slice(separator + 1);
  if (!domain) return null;
  return `${normalized.slice(0, separator).slice(0, 2)}•••@${domain}`;
}
