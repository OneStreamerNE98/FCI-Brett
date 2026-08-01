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
  submissionKey: string;
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
  lastProcessedSubmissionKey: string;
  lastProcessedAt: number;
  updatedBy: string;
}>;

export type GoogleFormLeadReviewInsert = GoogleFormLeadReviewDraft & Readonly<{
  id: string;
}>;

export type GoogleFormLeadObservedPosition = Readonly<{
  submissionKey: string;
  sourceRow: number;
}>;

export type GoogleFormLeadProcessedSubmission = GoogleFormLeadObservedPosition & Readonly<{
  status: GoogleFormLeadReviewStatus;
}>;

export type SaveGoogleFormLeadBatchInput = Readonly<{
  connectionKey: string;
  spreadsheetId: string;
  reviews: readonly GoogleFormLeadReviewInsert[];
  observedPositions: readonly GoogleFormLeadObservedPosition[];
  lastProcessedRow: number;
  lastProcessedSubmissionKey: string;
  processedAt: number;
  actor: string;
}>;

export type DismissGoogleFormLeadReviewInput = Readonly<{
  connectionKey: string;
  reviewId: string;
  actor: string;
  reviewedAt: number;
}>;

export interface GoogleFormLeadIntakeRepository {
  getWatermark(
    connectionKey: string,
    spreadsheetId: string,
  ): Promise<GoogleFormLeadIntakeWatermark | null>;
  findProcessedSubmissions(
    connectionKey: string,
    spreadsheetId: string,
    submissionKeys: readonly string[],
  ): Promise<readonly GoogleFormLeadProcessedSubmission[]>;
  listNeedsReview(
    connectionKey: string,
    limit: number,
  ): Promise<readonly GoogleFormLeadReviewRecord[]>;
  saveBatch(input: SaveGoogleFormLeadBatchInput): Promise<Readonly<{
    inserted: number;
    repositioned: number;
    watermark: GoogleFormLeadIntakeWatermark;
  }>>;
  dismissReview(input: DismissGoogleFormLeadReviewInput): Promise<boolean>;
}
