const FORM_LEAD_REVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;

/**
 * The live PostgreSQL runtime uses the same durable Google connection identity
 * as the Sites workspace-mode adapter. Simulation continues to obtain its
 * distinct connection key from the runtime Google configuration.
 */
export const GOOGLE_FORM_LEAD_REVIEW_CONNECTION_KEY = "google-workspace";

export function parseLeadCreationRequest(body: Readonly<Record<string, unknown>>) {
  if (!Object.hasOwn(body, "formLeadReviewId")) {
    return { ok: true as const, body, formLeadReview: undefined };
  }
  if (
    typeof body.formLeadReviewId !== "string"
    || !FORM_LEAD_REVIEW_ID_PATTERN.test(body.formLeadReviewId)
  ) {
    return {
      ok: false as const,
      error: "Google Form review details are invalid.",
    };
  }
  const leadBody = { ...body };
  delete leadBody.formLeadReviewId;
  return {
    ok: true as const,
    body: leadBody,
    formLeadReview: { id: body.formLeadReviewId },
  };
}
