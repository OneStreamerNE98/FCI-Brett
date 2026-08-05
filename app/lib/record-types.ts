import type { AddressReviewReference } from "../domain/address-validation";
import type { FlooringCategory } from "../domain/project-creation";
import type { ProjectSegment } from "../domain/project-segment";
import type { JobSiteLocation } from "../features/maps/job-site-map";

export type Lead = {
  id: string;
  number: string;
  company: string;
  contact: string;
  contactEmail: string | null;
  contactPhone: string | null;
  project: string;
  value: string;
  estimatedValue: number;
  stage: string;
  source: string;
  next: string;
  nextActionAt: string | null;
  ownerEmail: string | null;
  site: string;
  status: string;
  initials: string;
  color: string;
  createdAt?: number | null;
  updatedAt?: number | null;
  version?: string;
  addressReview?: AddressReviewReference;
};

export type LeadEditPatch = Partial<{
  company: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  projectName: string;
  source: string;
  stage: string;
  site: string;
  estimatedValue: number;
  nextAction: string;
  nextActionAt: string | null;
  ownerEmail: string;
  status: string;
  addressReview?: AddressReviewReference;
}>;

export type LeadConflictValues = Partial<{
  company: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  projectName: string;
  source: string;
  stage: string;
  site: string;
  estimatedValue: number;
  nextAction: string;
  nextActionAt: number | null;
  ownerEmail: string | null;
  status: string;
}>;

export type LeadUpdatePayload = {
  lead?: Record<string, unknown>;
  error?: string;
  currentVersion?: string;
  currentValues?: LeadConflictValues;
};

export type Client = {
  id: string;
  code: string;
  name: string;
  contact: string;
  contactId?: string;
  contactPhone: string | null;
  contactRole: string;
  contactVersion?: string;
  email: string;
  industry: string;
  industryRaw?: string | null;
  status: string;
  initials: string;
  color: string;
  googleStatus: "Ready" | "Setup pending";
  jobSite: JobSiteLocation | null;
  addressReview?: AddressReviewReference;
  version?: string;
  driveFolderId?: string;
  driveUrl?: string;
};

export type ClientEditPatch = Partial<{
  name: string;
  status: string;
  industry: string | null;
  siteAddress: string | null;
  addressReview?: AddressReviewReference;
}>;

export type ClientConflictValues = Partial<{
  name: string;
  status: string;
  industry: string | null;
  siteAddress: string | null;
}>;

export type ClientUpdatePayload = {
  client?: {
    id: string;
    clientCode: string;
    name: string;
    status: string;
    industry: string | null;
    siteAddress: string | null;
    latitude: number | null;
    longitude: number | null;
    addressValidationVerdict: string | null;
    updatedAt: number;
    version: string;
  };
  error?: string;
  outcome?: "duplicate";
  currentVersion?: string;
  currentValues?: ClientConflictValues;
};

export type ContactEditPatch = Partial<{
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
}>;

export type ContactConflictValues = ContactEditPatch;

export type ContactUpdatePayload = {
  contact?: {
    id: string;
    clientId: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
    isPrimary: boolean;
    updatedAt: number;
    version: string;
  };
  error?: string;
  currentVersion?: string;
  currentValues?: ContactConflictValues;
};

export type Project = {
  id: string;
  clientId: string;
  number: string;
  client: string;
  name: string;
  status: string;
  progress: number;
  value: string;
  estimatedValue: number | null;
  flooringCategory: FlooringCategory | null;
  squareFeet: number | null;
  contractValue: number | null;
  segment: ProjectSegment | null;
  installationStartedAt: number | null;
  installationCompletedAt: number | null;
  hadCallback: boolean;
  callbackNote: string | null;
  site: string;
  jobSite: JobSiteLocation | null;
  managerId: string | null;
  lead: string;
  date: string;
  accent: string;
  createdAt?: number | null;
  updatedAt?: number | null;
  version?: string;
  driveFolderId?: string;
  driveUrl?: string;
  addressReview?: AddressReviewReference;
};

export type ProjectEditPatch = Partial<{
  name: string;
  status: string;
  site: string | null;
  clientId: string;
  estimatedValue: number | null;
  flooringCategory: FlooringCategory | null;
  squareFeet: number | null;
  contractValue: number | null;
  segment: ProjectSegment | null;
  addressReview?: AddressReviewReference;
}>;

export type ProjectConflictValues = Omit<ProjectEditPatch, "addressReview">;

export type ProjectUpdatePayload = {
  project?: {
    id: string;
    projectNumber: string;
    clientId: string;
    name: string;
    status: string;
    site: string | null;
    latitude: number | null;
    longitude: number | null;
    addressValidationVerdict: string | null;
    projectManagerId: string | null;
    estimatedValue: number | null;
    flooringCategory: FlooringCategory | null;
    squareFeet: number | null;
    contractValue: number | null;
    segment: ProjectSegment | null;
    updatedAt: number;
    version: string;
  };
  error?: string;
  currentVersion?: string;
  currentValues?: ProjectConflictValues;
};

export type DashboardSummary = {
  generatedAt: number;
  metrics: {
    activeLeads: number;
    estimatedPipelineValue: number;
    activeProjects: number;
    clientCount: number;
    meetingCount: number;
    filedEmailCount: number;
  };
  projectsByStatus: Array<{ status: string; count: number }>;
  recentActivity: Array<{ id: string; action: string; detail: string | null; actor: string; created_at: number }>;
  todayMeetings: {
    items: Array<{ id: string; projectId: string; title: string; meetingAt: number; projectNumber: string; projectName: string }>;
    total: number;
  };
  readiness: {
    scheduleDataAvailable: boolean;
    scheduleReason: string;
    reportsUseLiveProjectLeadTotals: boolean;
  };
};

export type LiveDataState = "loading" | "ready" | "error";
export type NotificationKind = "success" | "info" | "warning" | "error";
export type NotificationAction = { label: string; run: () => void };
export type AppNotification = { message: string; kind: NotificationKind; action?: NotificationAction };
export type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;

export type ProjectMeeting = {
  id: string;
  projectId: string;
  title: string;
  meetingAt: string;
  meetingType: string;
  sourceProvider: "otter" | "link" | "manual";
  sourceUrl: string | null;
  attendees: string[];
  notes: string | null;
  transcript: string | null;
  summary: string | null;
  decisions: string | null;
  actionItems: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};
