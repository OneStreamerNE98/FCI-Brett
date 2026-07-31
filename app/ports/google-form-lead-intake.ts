export type GoogleFormLeadReviewState =
  | "ready"
  | "duplicate"
  | "invalid"
  | "blocked-real-data";

export type GoogleFormLeadReviewStatus =
  | "needs-review"
  | "accepted"
  | "dismissed";

export type GoogleFormLeadProposal = Readonly<{
  company: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  projectName: string;
  source: string;
  stage: string;
  site: string;
  estimatedValue: number | null;
  nextAction: string;
  nextActionAt: number | null;
  rooms: string | null;
  flooringType: string | null;
  preferredContact: string | null;
}>;

export type GoogleFormLeadReviewDraft = Readonly<{
  sourceRow: number;
  submittedAt: string | null;
  state: GoogleFormLeadReviewState;
  proposal: GoogleFormLeadProposal;
  reasons: readonly string[];
}>;

export type GoogleFormLeadReviewRecord = GoogleFormLeadReviewDraft & Readonly<{
  id: string;
  connectionKey: string;
  spreadsheetId: string;
  status: GoogleFormLeadReviewStatus;
  createdAt: number;
  updatedAt: number;
  reviewedBy: string | null;
  reviewedAt: number | null;
  acceptedLeadId: string | null;
}>;

export type GoogleFormLeadIntakeWatermark = Readonly<{
  connectionKey: string;
  spreadsheetId: string;
  lastProcessedRow: number;
  lastProcessedAt: number;
  updatedBy: string;
}>;

export type GoogleFormLeadReviewInsert = GoogleFormLeadReviewDraft & Readonly<{
  id: string;
}>;

export type SaveGoogleFormLeadBatchInput = Readonly<{
  connectionKey: string;
  spreadsheetId: string;
  reviews: readonly GoogleFormLeadReviewInsert[];
  lastProcessedRow: number;
  processedAt: number;
  actor: string;
}>;

export type RetireGoogleFormLeadReviewInput = Readonly<{
  connectionKey: string;
  reviewId: string;
  outcome: "accepted" | "dismissed";
  acceptedLeadId: string | null;
  actor: string;
  reviewedAt: number;
}>;

export interface GoogleFormLeadIntakeRepository {
  getWatermark(
    connectionKey: string,
    spreadsheetId: string,
  ): Promise<GoogleFormLeadIntakeWatermark | null>;
  listNeedsReview(
    connectionKey: string,
    limit: number,
  ): Promise<readonly GoogleFormLeadReviewRecord[]>;
  saveBatch(input: SaveGoogleFormLeadBatchInput): Promise<Readonly<{
    inserted: number;
    watermark: GoogleFormLeadIntakeWatermark;
  }>>;
  retireReview(input: RetireGoogleFormLeadReviewInput): Promise<boolean>;
}
