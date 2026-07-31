"use client";

import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity, BriefcaseBusiness, Building2, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CircleAlert, CircleCheckBig, Clipboard, Clock3, ContactRound, ExternalLink, FolderOpen, FolderTree, HardHat,
  Inbox, Info, LayoutDashboard, Mail, MapPin, Menu, MessageSquareText, MoreHorizontal, Navigation,
  LogOut, Plus, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Users, X, Zap,
} from "lucide-react";
import type { AppEnvironment } from "./lib/app-environment";
import { AssistantView } from "./assistant/components/AssistantView";
import { localDayRolloverDelay } from "./application/today-project-meetings";
import { InboxView } from "./inbox/components/InboxView";
import type { InboxLeadProposal } from "./inbox/components/InboxView";
import { DEFAULT_FILING_RULES, type FilingRuleDraft } from "./lib/google-workspace";
import { dashboardTimeContext, friendlyFirstName } from "./lib/time-context";
import { AccessibleOverlay } from "./components/AccessibleOverlay";
import { FeatureStateBadge, type FeatureState } from "./components/FeatureStateBadge";
import { WorkspaceInfoHint } from "./components/WorkspaceInfoHint";
import { Avatar, Metric, OperationsEmptyState, PageTitle, PanelHeader, Status } from "./components/operations/OperationsPrimitives";
import { OperationsActionableList, OperationsActionableListItem } from "./components/operations/OperationsActionableList";
import { PageLayoutEditor } from "./components/operations/PageLayoutEditor";
import { ActiveRouteFilter } from "./features/reports/ActiveRouteFilter";
import { BusinessKpisPanel } from "./features/reports/BusinessKpisPanel";
import { FINANCIAL_RESTRICTION_LABEL, FLOORING_KPI_TIME_ZONE, monthKeyForTimestamp } from "./features/reports/flooring-kpis";
import { ProjectSegmentSelector } from "./features/projects/ProjectSegmentSelector";
import { clearReportReturnFocusFromCurrentHistoryEntry, rememberReportReturnFocus, reportsReturnFocusHistoryKey } from "./features/reports/report-navigation";
import { JobSiteMapCard } from "./features/maps/JobSiteMapCard";
import { normalizeJobSiteLocation, type JobSiteLocation, type JobSiteMapsRuntimeConfig } from "./features/maps/job-site-map";
import { cachedGetJson, invalidateCachedGet } from "./lib/client-get-cache";
import { CLIENT_INDUSTRY_OPTIONS, clientIndustryReportState } from "./lib/client-industries";
import { formatUsd } from "./lib/format-usd";
import {
  defaultPageLayouts,
  isDefaultPageLayout,
  normalizePageLayoutsForRead,
  resolveArrangedSpans,
  type PageLayout,
  type PageLayoutPage,
  type PageLayouts,
} from "./lib/page-layouts";
import { sheetMirrorStatusLabel, type SheetMirrorStatus } from "./lib/sheet-mirror-status";
import {
  canonicalOperationsSearch,
  inboxBucketFromSearch,
  LEAD_STAGE_FILTERS,
  LEAD_STAGE_LABELS,
  leadStageFromSearch,
  operationsHref,
  operationsPath,
  operationsViewForPath,
  PROJECT_LIFECYCLE_FILTERS,
  PROJECT_STATUS_FILTERS,
  projectLifecycleFromSearch,
  projectStatusFromSearch,
  settingsSectionFromSearch,
  type InboxBucket,
  type LeadStageFilter,
  type OperationsView,
  type ProjectLifecycleFilter,
  type ProjectStatusFilter,
  type SettingsSection,
} from "./lib/operations-routes";
import { AiAssistantSettingsCard } from "./settings/components/AiAssistantSettingsCard";
import { DataSecurityPanel } from "./settings/components/DataSecurityPanel";
import { DirectorySyncPanel } from "./settings/components/DirectorySyncPanel";
import { GoogleWorkspacePanel } from "./settings/components/GoogleWorkspacePanel";
import { InboxRulesPanel, RuleModal } from "./settings/components/InboxRulesPanel";
import { MySettingsPanel } from "./settings/components/MySettingsPanel";
import { SettingsAudienceNavigation } from "./settings/components/SettingsAudienceNavigation";
import { TestingLaunchPanel } from "./settings/components/TestingLaunchPanel";
import { WorkspaceDefaultsPanel } from "./settings/components/WorkspaceDefaultsPanel";
import { ProjectFileCreationModal, ProjectFilesPanel, useProjectFilesController } from "./projects/components/ProjectFilesPanel";
import { CLIENT_STATUSES } from "./domain/client-creation";
import { FLOORING_CATEGORIES, PROJECT_STATUSES, type FlooringCategory } from "./domain/project-creation";
import { CALLBACK_NOTE_MAX_LENGTH } from "./domain/project-operations";
import { normalizeRecordVersion } from "./domain/record-version";
import { normalizeProjectSegment, resolveProjectSegment, type ProjectSegment } from "./domain/project-segment";

type Lead = {
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
};
type LeadEditPatch = Partial<{
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
}>;
type LeadConflictValues = Partial<{
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
type LeadUpdatePayload = {
  lead?: Record<string, unknown>;
  error?: string;
  currentVersion?: string;
  currentValues?: LeadConflictValues;
};
type LeadModalProps =
  | {
      mode: "create";
      // Optional prefill for create mode: AI-10 sub-PR (f) accepts an email-derived
      // lead proposal by opening THIS modal pre-filled and posting through the
      // ordinary create path — the implement-once contract this packet ships so the
      // modal is never reworked a second time (review finding, PR #231).
      initialValues?: Partial<Lead>;
      isAdmin: boolean;
      onClose: () => void;
      onSave: (lead: Lead) => Promise<void>;
    }
  | {
      mode: "edit";
      initialValues: Lead;
      isAdmin: boolean;
      onClose: () => void;
      onSave: (patch: LeadEditPatch, version: string) => Promise<void>;
    };
type LeadModalRequest = Readonly<{
  initialValues?: Partial<Lead>;
  afterCreate?: () => Promise<void>;
}>;
type Client = {
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
  version?: string;
  driveFolderId?: string;
  driveUrl?: string;
};
type ClientEditPatch = Partial<{
  name: string;
  status: string;
  industry: string | null;
}>;
type ClientConflictValues = ClientEditPatch;
type ClientUpdatePayload = {
  client?: {
    id: string;
    clientCode: string;
    name: string;
    status: string;
    industry: string | null;
    updatedAt: number;
    version: string;
  };
  error?: string;
  outcome?: "duplicate";
  currentVersion?: string;
  currentValues?: ClientConflictValues;
};
type ContactEditPatch = Partial<{
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
}>;
type ContactConflictValues = ContactEditPatch;
type ContactUpdatePayload = {
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
type Project = { id: string; clientId: string; number: string; client: string; name: string; status: string; progress: number; value: string; estimatedValue: number | null; flooringCategory: FlooringCategory | null; squareFeet: number | null; contractValue: number | null; segment: ProjectSegment | null; installationStartedAt: number | null; installationCompletedAt: number | null; hadCallback: boolean; callbackNote: string | null; site: string; jobSite: JobSiteLocation | null; managerId: string | null; lead: string; date: string; accent: string; createdAt?: number | null; updatedAt?: number | null; version?: string; driveFolderId?: string; driveUrl?: string };
type ProjectEditPatch = Partial<{
  name: string;
  status: string;
  site: string | null;
  clientId: string;
  estimatedValue: number | null;
  flooringCategory: FlooringCategory | null;
  squareFeet: number | null;
  contractValue: number | null;
  segment: ProjectSegment | null;
}>;
type ProjectConflictValues = ProjectEditPatch;
type ProjectUpdatePayload = {
  project?: {
    id: string;
    projectNumber: string;
    clientId: string;
    name: string;
    status: string;
    site: string | null;
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
type DashboardSummary = {
  generatedAt: number;
  metrics: { activeLeads: number; estimatedPipelineValue: number; activeProjects: number; clientCount: number; meetingCount: number; filedEmailCount: number };
  projectsByStatus: Array<{ status: string; count: number }>;
  recentActivity: Array<{ id: string; action: string; detail: string | null; actor: string; created_at: number }>;
  todayMeetings: {
    items: Array<{ id: string; projectId: string; title: string; meetingAt: number; projectNumber: string; projectName: string }>;
    total: number;
  };
  readiness: { scheduleDataAvailable: boolean; scheduleReason: string; reportsUseLiveProjectLeadTotals: boolean };
};
type LiveDataState = "loading" | "ready" | "error";
type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type AppNotification = { message: string; kind: NotificationKind; action?: NotificationAction };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;
type ProjectMeeting = {
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
type WorkspaceSearchResult = { kind: "client" | "project" | "contact"; id: string; title: string; subtitle: string; clientId?: string; projectId?: string };
type CurrentUserSettingsPayload = {
  preferences?: { displayTimezone?: unknown; pageLayouts?: unknown };
  isAdmin?: unknown;
};

const leadStages = LEAD_STAGE_FILTERS.filter((stage) => stage !== "other").map((stage) => LEAD_STAGE_LABELS[stage]);
const projectLifecycleOrder = [...PROJECT_LIFECYCLE_FILTERS];
const terminalProjectStatuses = new Set(["archived", "completed", "cancelled"]);
const projectOperationDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: FLOORING_KPI_TIME_ZONE });
const projectOperationDateInputFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: FLOORING_KPI_TIME_ZONE });
const PIPELINE_ACTIONABLE_COLUMNS = ["Client / opportunity", "Stage", "Est. value", "Next action"] as const;
const CLIENT_ACTIONABLE_COLUMNS = ["Client", "Primary contact", "Projects", ""] as const;
const PROJECT_ACTIONABLE_COLUMNS = ["Project", "Status", "Schedule & site", "Value", ""] as const;
const MOBILE_TOPBAR_SCROLL_THRESHOLD = 8;
const SUCCESS_INFO_SUPPRESSION_MS = 2_000;
const LEAD_ESTIMATED_VALUE_HINT = "Your rough estimate of the job's size before it's quoted. Feeds pipeline totals; it is not a committed contract amount.";
const CLIENT_STATUS_HINT = "Active is a current working account, Prospect is not yet won, Inactive is dormant or closed.";
const PROJECT_STATUS_HINT = "Planning is pre-work, Mobilizing is readying crews and materials, Installation is the active install, Closeout is punch list and wrap-up.";
const PROJECT_FLOORING_CATEGORY_HINT = "The main material for this job. Use Specialty for niche products and Mixed when no single category dominates.";
const PROJECT_ESTIMATED_VALUE_HINT = "Expected job value before booking. If a contract value is later recorded, reporting prefers that figure.";
// Constraint: success-window suppression may only ever swallow these two post-success reload
// notices (workspace-readiness refresh after a simulation reset, and the inbox message reload
// after a Gmail filing). Any info toast that does not match one of these must always render —
// unrelated info feedback (e.g. "already at the final pipeline stage") must never be dropped.
const SUPPRESSIBLE_FOLLOW_UP_INFO: RegExp[] = [
  /^Workspace readiness refreshed\. Current status is shown above\.$/u,
  /^Loaded \d+ messages? from .+\.$/u,
];

class ProjectEditConflictError extends Error {
  currentVersion: string;
  currentValues: ProjectConflictValues;

  constructor(
    message: string,
    currentVersion: string,
    currentValues: ProjectConflictValues,
  ) {
    super(message);
    this.name = "ProjectEditConflictError";
    this.currentVersion = currentVersion;
    this.currentValues = currentValues;
  }
}

class LeadEditConflictError extends Error {
  currentVersion: string;
  currentValues: LeadConflictValues;

  constructor(
    message: string,
    currentVersion: string,
    currentValues: LeadConflictValues,
  ) {
    super(message);
    this.name = "LeadEditConflictError";
    this.currentVersion = currentVersion;
    this.currentValues = currentValues;
  }
}

class ClientEditConflictError extends Error {
  currentVersion: string;
  currentValues: ClientConflictValues;

  constructor(
    message: string,
    currentVersion: string,
    currentValues: ClientConflictValues,
  ) {
    super(message);
    this.name = "ClientEditConflictError";
    this.currentVersion = currentVersion;
    this.currentValues = currentValues;
  }
}

class ContactEditConflictError extends Error {
  currentVersion: string;
  currentValues: ContactConflictValues;

  constructor(
    message: string,
    currentVersion: string,
    currentValues: ContactConflictValues,
  ) {
    super(message);
    this.name = "ContactEditConflictError";
    this.currentVersion = currentVersion;
    this.currentValues = currentValues;
  }
}
const focusableControlSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const navItems: { label: OperationsView; icon: typeof LayoutDashboard; state: FeatureState }[] = [
  { label: "Overview", icon: LayoutDashboard, state: "Working" }, { label: "Leads", icon: Zap, state: "In development" },
  { label: "Clients", icon: ContactRound, state: "In development" }, { label: "Projects", icon: BriefcaseBusiness, state: "In development" },
  { label: "Schedule", icon: CalendarDays, state: "Planned" },
  { label: "Inbox", icon: Inbox, state: "In development" }, { label: "AI Assistant", icon: Sparkles, state: "In development" },
  { label: "Reports", icon: Activity, state: "Working" }, { label: "Settings", icon: Settings, state: "In development" },
];

function recordInitials(value: string) {
  return value.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "FC";
}

function displayStatus(value: unknown, fallback: string) {
  const status = String(value ?? "").trim();
  return status ? status.split(/[-_\s]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ") : fallback;
}

function money(value: number) {
  return formatUsd(value);
}

function optionalRecordNumber(value: unknown) {
  const number = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalRecordText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapLeadRecord(record: Record<string, unknown>): Lead {
  const estimatedValue = Number(record.estimatedValue ?? 0);
  const company = String(record.company ?? "");
  return {
    id: String(record.id),
    number: String(record.leadNumber ?? "Lead"),
    company,
    contact: String(record.contactName ?? ""),
    contactEmail: optionalRecordText(record.contactEmail),
    contactPhone: optionalRecordText(record.contactPhone),
    project: String(record.projectName ?? ""),
    value: money(estimatedValue),
    estimatedValue,
    stage: String(record.stage ?? ""),
    source: String(record.source ?? ""),
    next: String(record.nextAction ?? ""),
    nextActionAt: optionalRecordText(record.nextActionAt),
    ownerEmail: optionalRecordText(record.ownerEmail),
    site: String(record.site ?? ""),
    status: String(record.status ?? "active"),
    initials: recordInitials(company),
    color: "sage",
    createdAt: optionalRecordNumber(record.createdAt),
    updatedAt: optionalRecordNumber(record.updatedAt),
    version: normalizeRecordVersion(record.version) ?? undefined,
  };
}

function mapClientRecord(record: Record<string, unknown>): Client {
  const name = String(record.name ?? "");
  const industryRaw = optionalRecordText(record.industry);
  const contactId = optionalRecordText(record.primary_contact_id);
  return {
    id: String(record.id),
    code: String(record.client_code),
    name,
    contact: String(record.primary_contact_name ?? "Primary contact pending"),
    contactId: contactId ?? undefined,
    contactPhone: optionalRecordText(record.primary_contact_phone),
    contactRole: String(record.primary_contact_role ?? "Primary contact"),
    contactVersion: normalizeRecordVersion(record.primary_contact_version) ?? undefined,
    email: String(record.primary_contact_email ?? ""),
    // "Commercial", not "Unspecified": the row chip's default is an owner-approved
    // DES-08a1 decision and is pinned by an e2e gate ("UNSPEC-001 · Commercial").
    // Only the Reports bucket says Unspecified, and it reads industryRaw, which
    // stays null — so the split survives this extraction.
    industry: industryRaw ?? "Commercial",
    industryRaw,
    status: displayStatus(record.status, "Active"),
    initials: recordInitials(name),
    color: "sage",
    googleStatus: record.drive_folder_id ? "Ready" : "Setup pending",
    jobSite: normalizeJobSiteLocation({
      address: record.site_address ?? record.address,
      latitude: record.latitude,
      longitude: record.longitude,
    }),
    version: normalizeRecordVersion(record.version) ?? undefined,
    driveFolderId: record.drive_folder_id ? String(record.drive_folder_id) : undefined,
    driveUrl: record.drive_url ? String(record.drive_url) : undefined,
  };
}

function dateTimeLocalInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

function dateTimeIsoValue(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function optionalFlooringCategory(value: unknown): FlooringCategory | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (FLOORING_CATEGORIES as readonly string[]).includes(normalized) ? normalized as FlooringCategory : null;
}

function optionalProjectTimestamp(value: unknown) {
  const timestamp = optionalRecordNumber(value);
  return timestamp !== null && Number.isSafeInteger(timestamp) && timestamp >= 0 && !Number.isNaN(new Date(timestamp).getTime()) ? timestamp : null;
}

function formatProjectOperationDate(timestamp: number | null) {
  return timestamp === null ? "Not yet recorded" : projectOperationDateFormatter.format(new Date(timestamp));
}

function projectOperationDateInputValue(timestamp: number | null) {
  if (timestamp === null) return "";
  const parts = projectOperationDateInputFormatter.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function projectOperationTimestampFromDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day, 12);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp : null;
}

function isActiveProject(project: Project) {
  return !terminalProjectStatuses.has(project.status.toLowerCase());
}

function leadMatchesStageFilter(lead: Lead, filter: LeadStageFilter) {
  const normalizedStage = lead.stage.toLowerCase();
  if (filter === "other") return !leadStages.some((stage) => stage.toLowerCase() === normalizedStage);
  return normalizedStage === LEAD_STAGE_LABELS[filter].toLowerCase();
}

function projectLifecycleFilter(value: string): ProjectLifecycleFilter | null {
  const normalizedStatus = value.toLowerCase();
  return PROJECT_LIFECYCLE_FILTERS.find((status) => status === normalizedStatus) ?? null;
}

function projectManagerLabel(managerId: string | null, currentUserEmail: string, currentUserName: string) {
  if (!managerId) return "Unassigned";
  if (managerId === currentUserEmail.trim().toLowerCase()) return currentUserName.trim() ? `${currentUserName} (you)` : `${managerId} (you)`;
  return managerId;
}

export function FloorOpsApp({ initialView, environment, jobSiteMaps, userName, userEmail, accessLabel, signOutHref }: { initialView: OperationsView; environment: AppEnvironment; jobSiteMaps: JobSiteMapsRuntimeConfig; userName: string; userEmail: string; accessLabel: "Admin" | "Office"; signOutHref: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParameters = useSearchParams();
  const search = searchParameters.toString();
  const view = operationsViewForPath(pathname) ?? initialView;
  const settingsArea = settingsSectionFromSearch(search);
  const leadStageFilter = leadStageFromSearch(search);
  const projectStatus = projectStatusFromSearch(search);
  const projectLifecycle = projectLifecycleFromSearch(search);
  const inboxBucket = inboxBucketFromSearch(search);
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileNavViewport, setMobileNavViewport] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [topbarHidden, setTopbarHidden] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [leadModal, setLeadModal] = useState<LeadModalRequest | null>(null);
  const [clientModal, setClientModal] = useState(false);
  const [projectModal, setProjectModal] = useState(false);
  const [projectModalClientId, setProjectModalClientId] = useState<string | null>(null);
  const [ruleModal, setRuleModal] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [leadOpen, setLeadOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projectItems, setProjectItems] = useState<Project[]>([]);
  const [filingRules, setFilingRules] = useState<FilingRuleDraft[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [liveDataState, setLiveDataState] = useState<LiveDataState>("loading");
  const [liveDataError, setLiveDataError] = useState("");
  const [toast, setToast] = useState<AppNotification | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [sheetMirror, setSheetMirror] = useState<SheetMirrorStatus | null>(null);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [displayTimezone, setDisplayTimezone] = useState("America/New_York");
  // The server-rendered access label and /settings/me both originate from the same
  // office identity policy but arrive over different transports. Seed from the
  // server prop for the first render, then let the authenticated settings response
  // drive every shell and content gate; an unavailable response fails closed in UI.
  // accessLabel remains server-owned display metadata, never an authorization gate.
  const [isAdmin, setIsAdmin] = useState(accessLabel === "Admin");
  const [pageLayouts, setPageLayouts] = useState<PageLayouts>(() => defaultPageLayouts(isAdmin));
  const [pageLayoutsReady, setPageLayoutsReady] = useState(false);
  const [pageLayoutsError, setPageLayoutsError] = useState("");
  const pageLayoutsLoadIdRef = useRef(0);
  const directoryLoadIdRef = useRef(0);
  const dashboardRefreshLoadIdRef = useRef(0);
  const dashboardAppliedLoadIdRef = useRef(0);
  const dashboardTimezoneRef = useRef(displayTimezone);
  const topbarRef = useRef<HTMLElement>(null);
  const topbarHiddenRef = useRef(false);
  const topbarLastScrollYRef = useRef(0);
  const topbarScrollDirectionRef = useRef<-1 | 0 | 1>(0);
  const topbarScrollDistanceRef = useRef(0);
  const topbarAnimationFrameRef = useRef<number | null>(null);
  const mobileNavigationRef = useRef<HTMLElement>(null);
  const mobileNavigationCloseRef = useRef<HTMLButtonElement>(null);
  const mobileNavigationTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceSearchRef = useRef<HTMLInputElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const notificationsMenuRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const activeToastRef = useRef<{ kind: NotificationKind; shownAt: number } | null>(null);
  const projectDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const clientDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const leadDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;
  const firstName = friendlyFirstName(userName, userEmail);
  const development = environment === "development";
  const userInitials = userName.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "FC";

  const revealMobileTopbar = useCallback(() => {
    topbarHiddenRef.current = false;
    setTopbarHidden(false);
  }, []);

  const reconcileCurrentUserSettings = useCallback((data: CurrentUserSettingsPayload) => {
    const nextIsAdmin = data?.isAdmin === true;
    const timezone = data?.preferences?.displayTimezone;
    if (typeof timezone === "string") setDisplayTimezone(timezone);
    setIsAdmin(nextIsAdmin);
    setPageLayouts(normalizePageLayoutsForRead(data?.preferences?.pageLayouts, nextIsAdmin));
    setPageLayoutsReady(true);
    setPageLayoutsError("");
  }, []);

  const failClosedCurrentUserSettings = useCallback(() => {
    setIsAdmin(false);
    setPageLayouts((current) => normalizePageLayoutsForRead(current, false));
    setPageLayoutsReady(false);
    setPageLayoutsError("Your saved layout could not be loaded. Retry before editing.");
  }, []);

  useEffect(() => {
    // The Workspace panel consumes its one-time OAuth result before normal
    // route canonicalization so these two URL updates cannot race on mount.
    if (new URLSearchParams(search).has("google")) return;
    const canonicalSearch = canonicalOperationsSearch(view, search);
    if (canonicalSearch === search) return;
    const canonicalUrl = `${operationsPath(view)}${canonicalSearch ? `?${canonicalSearch}` : ""}`;
    router.replace(canonicalUrl, { scroll: false });
  }, [router, search, view]);

  useEffect(() => {
    if (view !== "Settings" || isAdmin || settingsArea === "My settings") return;
    router.replace(operationsHref("Settings", { settingsSection: "My settings" }), { scroll: false });
  }, [isAdmin, router, settingsArea, view]);

  const refreshDirectoryData = useCallback(() => {
    const directoryLoadId = ++directoryLoadIdRef.current;
    const dashboardLoadId = ++dashboardRefreshLoadIdRef.current;
    async function getJson(path: string) {
      const response = await fetch(path, { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Live data request failed (${response.status}).`);
      return data;
    }
    const optionalRequests = Promise.allSettled([
      getJson("/api/v1/filing-rules"),
      getJson("/api/v1/integrations/google/sheets/status"),
    ]);
    const directoryRequests = Promise.all([
      getJson("/api/v1/leads"),
      getJson("/api/v1/clients"),
      getJson("/api/v1/projects"),
      getJson("/api/v1/dashboard"),
    ]);
    // Requests start synchronously; loading state moves to a microtask so the
    // mount effect does not cause a cascading render before I/O begins.
    void Promise.resolve().then(() => {
      if (directoryLoadId !== directoryLoadIdRef.current) return;
      setLiveDataState("loading");
      setLiveDataError("");
    });
    return directoryRequests.then(([leadData, clientData, projectData, dashboardData]) => {
      if (directoryLoadId !== directoryLoadIdRef.current) return;
      const leadRows = Array.isArray(leadData.leads) ? leadData.leads as Record<string, unknown>[] : [];
      const clientRows = Array.isArray(clientData.clients) ? clientData.clients as Record<string, unknown>[] : [];
      const projectRows = Array.isArray(projectData.projects) ? projectData.projects as Record<string, unknown>[] : [];
      setLeads(leadRows.map(mapLeadRecord));
      setClients(clientRows.map(mapClientRecord));
      setProjectItems(projectRows.map((project) => {
        const managerId = typeof project.project_manager_id === "string" && project.project_manager_id.trim()
          ? project.project_manager_id.trim().toLowerCase()
          : null;
        const estimatedValue = optionalRecordNumber(project.estimated_value);
        const squareFeet = optionalRecordNumber(project.square_feet);
        const contractValue = optionalRecordNumber(project.contract_value);
        const installationStartedAt = optionalProjectTimestamp(project.installation_started_at);
        const installationCompletedAt = optionalProjectTimestamp(project.installation_completed_at);
        const callbackNote = typeof project.callback_note === "string" && project.callback_note.trim() ? project.callback_note.trim() : null;
        const jobSite = normalizeJobSiteLocation({ address: project.site, latitude: project.latitude, longitude: project.longitude });
        return { id: String(project.id), clientId: String(project.client_id), number: String(project.project_number), client: String(project.client_name), name: String(project.name), status: displayStatus(project.status, "Planning"), progress: 0, value: estimatedValue === null ? "TBD" : money(estimatedValue), estimatedValue, flooringCategory: optionalFlooringCategory(project.flooring_category), squareFeet: squareFeet !== null && Number.isSafeInteger(squareFeet) && squareFeet > 0 ? squareFeet : null, contractValue: contractValue !== null && Number.isSafeInteger(contractValue) && contractValue >= 0 ? contractValue : null, segment: resolveProjectSegment(project.segment), installationStartedAt, installationCompletedAt, hadCallback: project.had_callback === true || project.had_callback === 1, callbackNote, site: jobSite?.address ?? "Site pending", jobSite, managerId, lead: projectManagerLabel(managerId, userEmail, userName), date: "Not scheduled", accent: "sage", createdAt: optionalRecordNumber(project.created_at), updatedAt: optionalRecordNumber(project.updated_at), version: normalizeRecordVersion(project.version) ?? undefined, driveFolderId: project.drive_folder_id ? String(project.drive_folder_id) : undefined, driveUrl: project.drive_url ? String(project.drive_url) : undefined };
      }));
      if (dashboardLoadId > dashboardAppliedLoadIdRef.current) {
        dashboardAppliedLoadIdRef.current = dashboardLoadId;
        setDashboard(dashboardData as unknown as DashboardSummary);
      }
      setLiveDataState("ready");

      void optionalRequests.then(([ruleResult, mirrorResult]) => {
        if (directoryLoadId !== directoryLoadIdRef.current) return;
        if (ruleResult.status === "fulfilled") {
          const ruleRows = Array.isArray(ruleResult.value.rules) ? ruleResult.value.rules as Record<string, unknown>[] : [];
          setFilingRules(ruleRows.filter((rule) => rule && typeof rule === "object").map((rule) => ({ id: rule.id ? String(rule.id) : undefined, name: String(rule.name), enabled: Boolean(rule.enabled), priority: Number(rule.priority), matchSummary: String(rule.matchSummary ?? rule.match_summary), action: String(rule.action) as FilingRuleDraft["action"], targetCategory: String(rule.targetCategory ?? rule.target_category), approvalRequired: Boolean(rule.approvalRequired ?? rule.approval_required) })));
        }
        if (mirrorResult.status === "fulfilled") {
          setSheetMirror(mirrorResult.value.mirror ? mirrorResult.value.mirror as SheetMirrorStatus : null);
        }
      }).catch(() => {
        // Rules and the Sheet mirror are optional integrations. Their failures
        // must never replace successfully loaded CRM records with a global error.
      });
    }).catch((error) => {
      if (directoryLoadId !== directoryLoadIdRef.current) return;
      setLiveDataState("error");
      setLiveDataError(error instanceof Error ? error.message : "Live application data could not be loaded.");
    });
  }, [userEmail, userName]);

  const refreshDashboardSnapshot = useCallback(async () => {
    const loadId = ++dashboardRefreshLoadIdRef.current;
    const response = await fetch("/api/v1/dashboard", {
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof data.error === "string"
        ? data.error
        : `Dashboard refresh failed (${response.status}).`);
    }
    if (loadId > dashboardAppliedLoadIdRef.current) {
      dashboardAppliedLoadIdRef.current = loadId;
      setDashboard(data as unknown as DashboardSummary);
    }
  }, []);

  useEffect(() => {
    void refreshDirectoryData();
  }, [refreshDirectoryData]);

  useEffect(() => {
    const previousTimeZone = dashboardTimezoneRef.current;
    dashboardTimezoneRef.current = displayTimezone;
    if (previousTimeZone === displayTimezone) return;
    void refreshDashboardSnapshot().catch(() => {
      // Keep the last honest snapshot when an isolated refresh fails. The next
      // app-open, manual retry, or local-midnight refresh tries again.
    });
  }, [displayTimezone, refreshDashboardSnapshot]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    const schedule = () => {
      if (cancelled) return;
      timeoutId = window.setTimeout(() => {
        void refreshDashboardSnapshot()
          .catch(() => {
            // Preserve the prior snapshot and re-arm the same single refresh model.
          })
          .finally(schedule);
      }, localDayRolloverDelay(Date.now(), displayTimezone));
    };
    schedule();
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [displayTimezone, refreshDashboardSnapshot]);

  useEffect(() => {
    const loadId = ++pageLayoutsLoadIdRef.current;
    void cachedGetJson<CurrentUserSettingsPayload>("/api/v1/settings/me")
      .then((data) => {
        if (loadId !== pageLayoutsLoadIdRef.current) return;
        reconcileCurrentUserSettings(data);
      })
      .catch(() => {
        if (loadId === pageLayoutsLoadIdRef.current) failClosedCurrentUserSettings();
      });
    return () => { pageLayoutsLoadIdRef.current += 1; };
  }, [failClosedCurrentUserSettings, reconcileCurrentUserSettings]);

  const retryPageLayouts = useCallback(async () => {
    const loadId = ++pageLayoutsLoadIdRef.current;
    setPageLayoutsReady(false);
    setPageLayoutsError("");
    try {
      const data = await cachedGetJson<CurrentUserSettingsPayload>("/api/v1/settings/me", { force: true });
      if (loadId !== pageLayoutsLoadIdRef.current) return;
      reconcileCurrentUserSettings(data);
    } catch {
      if (loadId === pageLayoutsLoadIdRef.current) failClosedCurrentUserSettings();
    }
  }, [failClosedCurrentUserSettings, reconcileCurrentUserSettings]);

  const savePageLayout = useCallback(async (page: PageLayoutPage, layout: PageLayout) => {
    const nextPageLayouts = { ...pageLayouts, [page]: layout };
    const response = await fetch("/api/v1/settings/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageLayouts: nextPageLayouts }),
    });
    const data = await response.json().catch(() => ({})) as { preferences?: { pageLayouts?: unknown }; error?: string };
    if (!response.ok) throw new Error(data.error ?? `The ${page === "overview" ? "Overview" : "Reports"} layout could not be saved.`);
    invalidateCachedGet("/api/v1/settings/me");
    setPageLayouts(normalizePageLayoutsForRead(data.preferences?.pageLayouts ?? nextPageLayouts, isAdmin));
  }, [isAdmin, pageLayouts]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 820px)");
    const updateMobileNavigationMode = () => {
      setMobileNavViewport(mediaQuery.matches);
      if (!mediaQuery.matches) {
        setMobileNav(false);
        revealMobileTopbar();
      }
    };
    updateMobileNavigationMode();
    mediaQuery.addEventListener("change", updateMobileNavigationMode);
    return () => mediaQuery.removeEventListener("change", updateMobileNavigationMode);
  }, [revealMobileTopbar]);

  useEffect(() => {
    if (!mobileNavViewport) {
      topbarHiddenRef.current = false;
      return;
    }

    const topbar = topbarRef.current;
    topbarLastScrollYRef.current = Math.max(0, window.scrollY);
    topbarScrollDirectionRef.current = 0;
    topbarScrollDistanceRef.current = 0;

    const applyScrollDirection = () => {
      topbarAnimationFrameRef.current = null;
      const nextScrollY = Math.max(0, window.scrollY);
      const delta = nextScrollY - topbarLastScrollYRef.current;
      topbarLastScrollYRef.current = nextScrollY;

      if (
        nextScrollY <= MOBILE_TOPBAR_SCROLL_THRESHOLD
        || (topbar && document.activeElement instanceof Node && topbar.contains(document.activeElement))
      ) {
        topbarScrollDirectionRef.current = 0;
        topbarScrollDistanceRef.current = 0;
        revealMobileTopbar();
        return;
      }
      if (delta === 0) return;

      const direction: -1 | 1 = delta > 0 ? 1 : -1;
      if (topbarScrollDirectionRef.current !== direction) {
        topbarScrollDirectionRef.current = direction;
        topbarScrollDistanceRef.current = Math.abs(delta);
      } else {
        topbarScrollDistanceRef.current += Math.abs(delta);
      }
      if (topbarScrollDistanceRef.current < MOBILE_TOPBAR_SCROLL_THRESHOLD) return;

      topbarScrollDistanceRef.current = 0;
      const hidden = direction > 0;
      if (topbarHiddenRef.current !== hidden) {
        topbarHiddenRef.current = hidden;
        setTopbarHidden(hidden);
      }
    };

    const handleScroll = () => {
      if (topbarAnimationFrameRef.current !== null) return;
      topbarAnimationFrameRef.current = window.requestAnimationFrame(applyScrollDirection);
    };
    const handleFocusIn = () => revealMobileTopbar();

    window.addEventListener("scroll", handleScroll, { passive: true });
    topbar?.addEventListener("focusin", handleFocusIn);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      topbar?.removeEventListener("focusin", handleFocusIn);
      if (topbarAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(topbarAnimationFrameRef.current);
        topbarAnimationFrameRef.current = null;
      }
    };
  }, [mobileNavViewport, revealMobileTopbar]);

  const mobileNavActive = mobileNavViewport && mobileNav;

  useEffect(() => {
    if (!mobileNavActive) return;
    const panel = mobileNavigationRef.current;
    if (!panel) return;

    const bodyOverflowBeforeOpen = document.body.style.overflow;
    const navigationTrigger = mobileNavigationTriggerRef.current;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => mobileNavigationCloseRef.current?.focus());
    const handleMobileNavigationKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMobileNav(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableControlSelector)).filter((element) => {
        const style = window.getComputedStyle(element);
        return !element.hidden
          && element.getAttribute("aria-hidden") !== "true"
          && !element.closest("[inert]")
          && style.display !== "none"
          && style.visibility !== "hidden";
      });
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!activeElement || !panel.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleMobileNavigationKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleMobileNavigationKeyDown, true);
      document.body.style.overflow = bodyOverflowBeforeOpen;
      if (navigationTrigger?.isConnected && window.matchMedia("(max-width: 820px)").matches) {
        navigationTrigger.focus();
      }
    };
  }, [mobileNavActive]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNav(false);
        setWorkspaceMenuOpen(false);
        setProfileMenuOpen(false);
        setNotificationsOpen(false);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        revealMobileTopbar();
        window.requestAnimationFrame(() => workspaceSearchRef.current?.focus());
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [revealMobileTopbar]);

  useEffect(() => {
    if (!workspaceMenuOpen && !profileMenuOpen && !notificationsOpen) return;
    const closeOpenPopovers = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (workspaceMenuOpen && !workspaceMenuRef.current?.contains(target)) setWorkspaceMenuOpen(false);
      if (profileMenuOpen && !profileMenuRef.current?.contains(target)) setProfileMenuOpen(false);
      if (notificationsOpen && !notificationsMenuRef.current?.contains(target)) setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", closeOpenPopovers);
    return () => document.removeEventListener("pointerdown", closeOpenPopovers);
  }, [notificationsOpen, profileMenuOpen, workspaceMenuOpen]);

  const dismissNotification = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    activeToastRef.current = null;
    setToast(null);
  }, []);

  const notify = useCallback<Notify>((message, kind = "info", action) => {
    const shownAt = Date.now();
    const activeToast = activeToastRef.current;
    if (kind === "info"
      && activeToast?.kind === "success"
      && shownAt - activeToast.shownAt < SUCCESS_INFO_SUPPRESSION_MS
      && SUPPRESSIBLE_FOLLOW_UP_INFO.some((pattern) => pattern.test(message))) {
      return;
    }
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    const nextActiveToast = { kind, shownAt };
    activeToastRef.current = nextActiveToast;
    setToast({ message, kind, action });
    if (kind !== "error") {
      const duration = kind === "warning" ? 8_000 : kind === "info" ? 5_000 : 3_200;
      toastTimerRef.current = window.setTimeout(() => {
        if (activeToastRef.current !== nextActiveToast) return;
        toastTimerRef.current = null;
        activeToastRef.current = null;
        setToast(null);
      }, duration);
    }
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    activeToastRef.current = null;
  }, []);

  function openInboxLead(
    proposal: InboxLeadProposal,
    afterCreate: () => Promise<void>,
  ) {
    setLeadModal({
      initialValues: {
        company: proposal.company ?? "",
        contact: proposal.contactName ?? "",
        contactEmail: proposal.contactEmail,
        contactPhone: proposal.contactPhone,
        project: proposal.projectName ?? "",
        source: "Email",
        stage: "New inquiry",
        site: proposal.site ?? "",
        ...(proposal.estimatedValue === null
          ? {}
          : { estimatedValue: proposal.estimatedValue }),
        next: "Review the email and contact this prospective client.",
        nextActionAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
        ownerEmail: userEmail.trim().toLowerCase(),
        status: "active",
      },
      afterCreate,
    });
  }

  async function addLead(lead: Lead) {
    const afterCreate = leadModal?.afterCreate;
    try {
      const response = await fetch("/api/v1/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: lead.company, contactName: lead.contact, projectName: lead.project, source: lead.source, stage: lead.stage, site: lead.site, estimatedValue: lead.estimatedValue, nextAction: lead.next, status: "active", ...(lead.contactEmail ? { contactEmail: lead.contactEmail } : {}), ...(lead.contactPhone ? { contactPhone: lead.contactPhone } : {}), ...(lead.nextActionAt ? { nextActionAt: lead.nextActionAt } : {}), ...(lead.ownerEmail ? { ownerEmail: lead.ownerEmail } : {}) }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Lead could not be saved.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Lead could not be saved.", "error");
      return;
    }
    setLeadModal(null);
    notify(`${lead.company} added to your live pipeline`, "success");
    if (afterCreate) await afterCreate();
    await refreshDirectoryData();
  }

  async function saveLeadEdits(
    lead: Lead,
    patch: LeadEditPatch,
    version: string,
  ) {
    const response = await fetch(`/api/v1/leads/${encodeURIComponent(lead.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...patch, version }),
    });
    const data = await response.json().catch(() => ({})) as LeadUpdatePayload;
    if (response.status === 409 && typeof data.currentVersion === "string") {
      throw new LeadEditConflictError(
        data.error ?? "Lead changed since it was loaded.",
        data.currentVersion,
        data.currentValues ?? {},
      );
    }
    if (!response.ok || !data.lead) {
      throw new Error(data.error ?? "Lead changes could not be saved.");
    }
    const saved = mapLeadRecord(data.lead);
    setLeads((current) => current.map((item) => item.id === saved.id ? saved : item));
    void refreshDashboardSnapshot().catch(() => {
      // The lead write already succeeded. Preserve the last honest snapshot
      // and let the app's shared refresh model try again on its next trigger.
    });
    notify(`${saved.number} lead details updated`, "success");
  }

  async function addClient(client: Client) {
    try {
      const response = await fetch("/api/v1/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: client.name,
          industry: client.industry,
          status: client.status.toLowerCase(),
          primaryContact: {
            name: client.contact,
            email: client.email,
            phone: client.contactPhone,
            role: client.contactRole,
          },
        }),
      });
      const errorData = await response.clone().json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(errorData.error ?? "Client could not be saved.");
      const data = await response.json() as { id: string; clientCode: string; sheetSync?: { status?: string; message?: string } };
      await refreshDirectoryData();
      setClientModal(false);
      notify(data.sheetSync?.message ?? `${client.name} saved in FCI Operations`, data.sheetSync?.status === "pending" ? "warning" : data.sheetSync?.status === "not-configured" ? "info" : "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Client could not be saved.", "error");
    }
  }

  async function saveClientEdits(
    client: Client,
    patch: ClientEditPatch,
    version: string,
  ) {
    const response = await fetch(`/api/v1/clients/${encodeURIComponent(client.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...patch, version }),
    });
    const data = await response.json().catch(() => ({})) as ClientUpdatePayload;
    if (response.status === 409 && typeof data.currentVersion === "string") {
      throw new ClientEditConflictError(
        data.error ?? "Client changed since it was loaded.",
        data.currentVersion,
        data.currentValues ?? {},
      );
    }
    if (!response.ok || !data.client) {
      throw new Error(data.error ?? "Client changes could not be saved.");
    }
    const saved = data.client;
    const update = (item: Client): Client => item.id === client.id
      ? {
          ...item,
          name: saved.name,
          industry: saved.industry ?? "Commercial",
          industryRaw: saved.industry,
          status: displayStatus(saved.status, saved.status),
          initials: recordInitials(saved.name),
          version: normalizeRecordVersion(saved.version) ?? item.version,
        }
      : item;
    setClients((current) => current.map(update));
    setSelectedClient((current) => current ? update(current) : current);
    setProjectItems((current) => current.map((item) => (
      item.clientId === saved.id ? { ...item, client: saved.name } : item
    )));
    setSelectedProject((current) => current?.clientId === saved.id
      ? { ...current, client: saved.name }
      : current);
    notify(`${saved.clientCode} client details updated`, "success");
  }

  async function saveContactEdits(
    client: Client,
    patch: ContactEditPatch,
    version: string,
  ) {
    if (!client.contactId) {
      throw new Error("This client does not have a primary contact to edit.");
    }
    const response = await fetch(`/api/v1/contacts/${encodeURIComponent(client.contactId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...patch, version }),
    });
    const data = await response.json().catch(() => ({})) as ContactUpdatePayload;
    if (response.status === 409 && typeof data.currentVersion === "string") {
      throw new ContactEditConflictError(
        data.error ?? "Contact changed since it was loaded.",
        data.currentVersion,
        data.currentValues ?? {},
      );
    }
    if (!response.ok || !data.contact) {
      throw new Error(data.error ?? "Contact changes could not be saved.");
    }
    if (data.contact.clientId !== client.id) {
      throw new Error("The saved contact no longer belongs to this client.");
    }
    const saved = data.contact;
    const update = (item: Client): Client => item.id === client.id
      ? {
          ...item,
          contact: saved.name,
          email: saved.email ?? "",
          contactPhone: saved.phone,
          contactRole: saved.role,
          contactId: saved.id,
          contactVersion: normalizeRecordVersion(saved.version) ?? item.contactVersion,
        }
      : item;
    setClients((current) => current.map(update));
    setSelectedClient((current) => current ? update(current) : current);
    notify(`${client.code} primary contact updated`, "success");
  }

  async function addProject(project: Project) {
    try {
      const estimatedValue = project.estimatedValue ?? undefined;
      const response = await fetch("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: project.clientId, name: project.name, status: project.status.toLowerCase(), site: project.site, projectManagerId: project.managerId, estimatedValue, flooringCategory: project.flooringCategory ?? undefined, squareFeet: project.squareFeet ?? undefined, contractValue: project.contractValue ?? undefined, segment: project.segment ?? undefined }) });
      const errorData = await response.clone().json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(errorData.error ?? "Project could not be saved.");
      const data = await response.json() as { id: string; projectNumber: string; sheetSync?: { status?: string; message?: string } };
      await refreshDirectoryData();
      setProjectModal(false);
      setProjectModalClientId(null);
      notify(data.sheetSync?.message ?? `${project.name} saved in FCI Operations`, data.sheetSync?.status === "pending" ? "warning" : data.sheetSync?.status === "not-configured" ? "info" : "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Project could not be saved.", "error");
    }
  }

  async function saveProjectEdits(
    project: Project,
    patch: ProjectEditPatch,
    version: string,
  ) {
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(project.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...patch, version }),
    });
    const data = await response.json().catch(() => ({})) as ProjectUpdatePayload;
    if (response.status === 409 && typeof data.currentVersion === "string") {
      throw new ProjectEditConflictError(
        data.error ?? "Project changed since it was loaded.",
        data.currentVersion,
        data.currentValues ?? {},
      );
    }
    if (!response.ok || !data.project) {
      throw new Error(data.error ?? "Project changes could not be saved.");
    }
    const saved = data.project;
    const client = clients.find((item) => item.id === saved.clientId);
    const estimatedValue = optionalRecordNumber(saved.estimatedValue);
    const squareFeet = optionalRecordNumber(saved.squareFeet);
    const contractValue = optionalRecordNumber(saved.contractValue);
    const jobSite = normalizeJobSiteLocation({ address: saved.site });
    const savedSegment = saved.segment === null
      ? resolveProjectSegment(null, client?.industryRaw ?? client?.industry)
      : resolveProjectSegment(saved.segment);
    const update = (item: Project): Project => item.id === project.id
      ? {
          ...item,
          clientId: saved.clientId,
          client: client?.name ?? item.client,
          name: saved.name,
          status: displayStatus(saved.status, saved.status),
          site: jobSite?.address ?? "Site pending",
          jobSite,
          estimatedValue,
          value: estimatedValue === null ? "TBD" : money(estimatedValue),
          flooringCategory: optionalFlooringCategory(saved.flooringCategory),
          squareFeet: squareFeet !== null && Number.isSafeInteger(squareFeet) && squareFeet > 0
            ? squareFeet
            : null,
          contractValue: contractValue !== null && Number.isSafeInteger(contractValue) && contractValue >= 0
            ? contractValue
            : null,
          segment: savedSegment,
          managerId: saved.projectManagerId,
          updatedAt: optionalRecordNumber(saved.updatedAt) ?? item.updatedAt,
          version: normalizeRecordVersion(saved.version) ?? item.version,
        }
      : item;
    setProjectItems((current) => current.map(update));
    setSelectedProject((current) => current ? update(current) : current);
    notify(`${saved.projectNumber} project details updated`, "success");
  }

  async function syncGoogleSheet() {
    setSheetSyncing(true);
    try {
      const response = await fetch("/api/v1/integrations/google/sheets/sync", { method: "POST" });
      const data = await response.json() as { result?: { clients?: { total?: number }; projects?: { total?: number } }; mirror?: SheetMirrorStatus; error?: string };
      if (data.mirror) setSheetMirror(data.mirror);
      if (!response.ok) throw new Error(data.error ?? "Google Sheet sync could not be completed.");
      await refreshDirectoryData();
      notify(`Google Sheet synced: ${data.result?.clients?.total ?? 0} clients and ${data.result?.projects?.total ?? 0} projects`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Google Sheet sync could not be completed.", "error");
    } finally {
      setSheetSyncing(false);
    }
  }

  async function provisionProjectDrive(project: Project) {
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(project.id)}/drive`, { method: "POST" });
      const data = await response.json() as { driveFolderId?: string; driveUrl?: string; created?: boolean; environment?: string; error?: string };
      if (!response.ok || !data.driveFolderId || !data.driveUrl) throw new Error(data.error ?? "The project Drive workspace could not be created.");
      const updated = { ...project, driveFolderId: data.driveFolderId, driveUrl: data.driveUrl };
      setProjectItems((current) => current.map((item) => item.id === project.id ? updated : item));
      setSelectedProject((current) => current?.id === project.id ? updated : current);
      notify(data.created ? `${project.name} now has a ${data.environment ?? "test"} Drive workspace` : `${project.name} already has a Drive workspace`, data.created ? "success" : "info");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The project Drive workspace could not be created.", "error");
    }
  }

  async function addRule(rule: FilingRuleDraft) {
    try {
      const response = await fetch("/api/v1/filing-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule) });
      const data = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? "Rule could not be saved.");
      setFilingRules((current) => [...current, { ...rule, id: data.id }].sort((a, b) => a.priority - b.priority));
      setRuleModal(false);
      notify(`Email rule “${rule.name}” added`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Rule could not be saved.", "error");
    }
  }

  async function updateRule(rule: FilingRuleDraft, patch: Partial<Pick<FilingRuleDraft, "enabled" | "priority">>) {
    if (!rule.id) {
      const override = { ...rule, ...patch };
      try {
        const response = await fetch("/api/v1/filing-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(override) });
        const data = await response.json().catch(() => ({})) as { id?: string; error?: string };
        if (!response.ok || !data.id) throw new Error(data.error ?? "Rule could not be saved.");
        setFilingRules((current) => current.map((item) => item.name === rule.name ? { ...override, id: data.id } : item).sort((left, right) => left.priority - right.priority));
        notify(`Email rule “${rule.name}” ${patch.enabled === false ? "paused" : "updated"}`, "success");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Rule could not be updated.", "error");
      }
      return;
    }
    try {
      const response = await fetch(`/api/v1/filing-rules/${encodeURIComponent(rule.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Rule could not be updated.");
      setFilingRules((current) => current.map((item) => item.id === rule.id ? { ...item, ...patch } : item).sort((left, right) => left.priority - right.priority));
      notify(`Email rule “${rule.name}” ${patch.enabled === false ? "paused" : "updated"}`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Rule could not be updated.", "error");
    }
  }

  async function deleteRule(rule: FilingRuleDraft) {
    if (!rule.id) {
      notify("Starter rules stay available for reference. Add custom rules to manage your own routing.", "info");
      return;
    }
    try {
      const response = await fetch(`/api/v1/filing-rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Rule could not be deleted.");
      const defaultRule = DEFAULT_FILING_RULES.find((item) => item.name === rule.name);
      setFilingRules((current) => defaultRule ? current.map((item) => item.id === rule.id ? defaultRule : item).sort((left, right) => left.priority - right.priority) : current.filter((item) => item.id !== rule.id));
      notify(defaultRule ? `Email rule “${rule.name}” reset to its built-in default` : `Email rule “${rule.name}” deleted`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Rule could not be deleted.", "error");
    }
  }

  const clientProjectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projectItems) {
      counts.set(project.clientId, (counts.get(project.clientId) ?? 0) + 1);
    }
    return counts;
  }, [projectItems]);

  function closeNavigationMenus() {
    setMobileNav(false);
    setWorkspaceMenuOpen(false);
    setProfileMenuOpen(false);
    setNotificationsOpen(false);
  }

  function navigateToView(nextView: OperationsView) {
    router.push(operationsHref(nextView));
    closeNavigationMenus();
  }

  function navigateToSettings(section: SettingsSection) {
    router.push(operationsHref("Settings", { settingsSection: section }));
    closeNavigationMenus();
  }

  function navigateToProjectStatus(status: ProjectStatusFilter) {
    router.push(operationsHref("Projects", { projectStatus: status }));
  }

  function navigateToInboxBucket(bucket: InboxBucket) {
    router.push(operationsHref("Inbox", { inboxBucket: bucket }));
  }

  function openRules() {
    navigateToSettings("Inbox & file rules");
  }

  function openGoogleWorkspace() {
    setProjectOpen(false);
    setClientOpen(false);
    navigateToSettings("Google Workspace");
    notify("Google Workspace setup opened", "info");
  }

  function openDirectorySettings() {
    navigateToSettings("Client Directory");
  }

  function openTestingChecklist() {
    navigateToSettings("Testing & launch");
  }

  async function copySignedInEmail() {
    try {
      await navigator.clipboard.writeText(userEmail);
      notify("Signed-in email copied", "success");
    } catch {
      notify(`Signed in as ${userEmail}`, "info");
    }
    setProfileMenuOpen(false);
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => !current);
    setWorkspaceMenuOpen(false);
    setProfileMenuOpen(false);
  }

  function openProject(project: Project, returnFocusTarget: HTMLElement | null = null) {
    projectDrawerReturnFocusRef.current = returnFocusTarget;
    setSelectedProject(project);
    setLeadOpen(false);
    setClientOpen(false);
    setProjectOpen(true);
  }

  function openClient(client: Client, returnFocusTarget: HTMLElement | null = null) {
    clientDrawerReturnFocusRef.current = returnFocusTarget;
    setSelectedClient(client);
    setLeadOpen(false);
    setProjectOpen(false);
    setClientOpen(true);
  }

  function openLead(lead: Lead, returnFocusTarget: HTMLElement | null = null) {
    leadDrawerReturnFocusRef.current = returnFocusTarget;
    setSelectedLeadId(lead.id);
    setProjectOpen(false);
    setClientOpen(false);
    setLeadOpen(true);
  }

  function openNewProject(clientId: string | null = null) {
    setProjectModalClientId(clientId);
    setProjectModal(true);
  }

  function closeNewProject() {
    setProjectModal(false);
    setProjectModalClientId(null);
  }

  async function advanceLead(id: string) {
    const currentLead = leads.find((lead) => lead.id === id);
    if (!currentLead) return;
    if (currentLead.status.toLowerCase() !== "active") {
      notify(`${currentLead.company} is ${displayStatus(currentLead.status, "not active")} and cannot be advanced`, "warning");
      return;
    }
    const currentIndex = leadStages.findIndex((stage) => stage.toLowerCase() === currentLead.stage.toLowerCase());
    if (currentIndex < 0) {
      notify(`${currentLead.company} uses the custom stage “${currentLead.stage}” and was not changed`, "warning");
      return;
    }
    const nextStage = leadStages[Math.min(currentIndex + 1, leadStages.length - 1)];
    if (nextStage.toLowerCase() === currentLead.stage.toLowerCase()) {
      notify(`${currentLead.company} is already at the final pipeline stage`, "info");
      return;
    }
    try {
      const response = await fetch(`/api/v1/leads/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: nextStage }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Lead stage could not be updated.");
      await refreshDirectoryData();
      notify(`${currentLead.company} moved to ${nextStage}`, "success", { label: "Undo", run: () => {
        void (async () => {
          try {
            const undoResponse = await fetch(`/api/v1/leads/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: currentLead.stage }) });
            const undoData = await undoResponse.json().catch(() => ({})) as { error?: string };
            if (!undoResponse.ok) throw new Error(undoData.error ?? "Lead stage could not be restored.");
            await refreshDirectoryData();
            notify(`${currentLead.company} returned to ${currentLead.stage}`, "success");
          } catch (undoError) {
            notify(undoError instanceof Error ? undoError.message : "Lead stage could not be restored.", "error");
          }
        })();
      } });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Lead stage could not be updated.", "error");
    }
  }

  async function searchWorkspace() {
    const query = searchTerm.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setActiveSearchIndex(-1);
      notify("Enter at least two characters to search clients, projects, and contacts", "warning");
      return;
    }
    setSearching(true);
    setActiveSearchIndex(-1);
    try {
      const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`);
      const data = await response.json().catch(() => ({})) as { results?: WorkspaceSearchResult[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Workspace search could not be completed.");
      const results = data.results ?? [];
      setSearchResults(results);
      setActiveSearchIndex(results.length > 0 ? 0 : -1);
      if (!results.length) notify(`No workspace records matched “${query}”`, "info");
    } catch (error) {
      setSearchResults([]);
      setActiveSearchIndex(-1);
      notify(error instanceof Error ? error.message : "Workspace search could not be completed.", "error", {
        label: "Retry",
        run: () => void searchWorkspace(),
      });
    } finally {
      setSearching(false);
    }
  }

  function openSearchResult(result: WorkspaceSearchResult) {
    setSearchResults([]);
    setActiveSearchIndex(-1);
    setSearchTerm("");
    if (result.kind === "project") {
      const project = projectItems.find((item) => item.id === result.projectId);
      if (project) {
        openProject(project, workspaceSearchRef.current);
        notify(`Opened ${project.number}`, "info");
      } else {
        navigateToView("Projects");
        notify("Project found. Refresh the directory if it is not listed yet.", "warning");
      }
      return;
    }
    const client = clients.find((item) => item.id === result.clientId);
    if (client) {
      openClient(client, workspaceSearchRef.current);
      notify(`Opened ${client.name}`, "info");
    } else {
      navigateToView("Clients");
      notify("Client found. Refresh the directory if it is not listed yet.", "warning");
    }
  }

  async function assignProjectToCurrentUser(project: Project) {
    try {
      const projectManagerId = userEmail.trim().toLowerCase();
      const response = await fetch("/api/v1/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, projectManagerId }) });
      const data = await response.json().catch(() => ({})) as { projectManagerId?: string; error?: string };
      if (!response.ok || !data.projectManagerId) throw new Error(data.error ?? "The project manager could not be assigned.");
      const managerId = data.projectManagerId.toLowerCase();
      const updateManager = (item: Project) => item.id === project.id
        ? { ...item, managerId, lead: projectManagerLabel(managerId, userEmail, userName) }
        : item;
      setProjectItems((current) => current.map(updateManager));
      setSelectedProject((current) => current ? updateManager(current) : current);
      notify(`${project.number} is now assigned to your signed-in account`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The project manager could not be assigned.", "error");
    }
  }

  async function recordProjectInstallationDates(project: Project, installationStartedAt: number, installationCompletedAt: number) {
    const response = await fetch("/api/v1/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "record-installation-dates", projectId: project.id, installationStartedAt, installationCompletedAt }),
    });
    const data = await response.json().catch(() => ({})) as { installationStartedAt?: number; installationCompletedAt?: number; updatedAt?: number; error?: string };
    if (!response.ok || !Number.isSafeInteger(data.installationStartedAt) || !Number.isSafeInteger(data.installationCompletedAt)) {
      throw new Error(data.error ?? "Installation dates could not be recorded.");
    }
    const updateProject = (item: Project): Project => item.id === project.id
      ? { ...item, installationStartedAt: data.installationStartedAt as number, installationCompletedAt: data.installationCompletedAt as number, updatedAt: optionalProjectTimestamp(data.updatedAt) ?? item.updatedAt }
      : item;
    setProjectItems((current) => current.map(updateProject));
    setSelectedProject((current) => current ? updateProject(current) : current);
    notify(`Installation dates recorded for ${project.number}`, "success");
  }

  async function recordProjectFollowUpResult(project: Project, hadCallback: boolean, callbackNote: string | null) {
    const response = await fetch("/api/v1/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "record-follow-up-result", projectId: project.id, hadCallback, callbackNote }),
    });
    const data = await response.json().catch(() => ({})) as { hadCallback?: boolean; callbackNote?: string | null; updatedAt?: number; error?: string };
    if (!response.ok || typeof data.hadCallback !== "boolean") {
      throw new Error(data.error ?? "The follow-up result could not be recorded.");
    }
    const updateProject = (item: Project): Project => item.id === project.id
      ? { ...item, hadCallback: data.hadCallback as boolean, callbackNote: typeof data.callbackNote === "string" && data.callbackNote.trim() ? data.callbackNote.trim() : null, updatedAt: optionalProjectTimestamp(data.updatedAt) ?? item.updatedAt }
      : item;
    setProjectItems((current) => current.map(updateProject));
    setSelectedProject((current) => current ? updateProject(current) : current);
    notify(`Follow-up result recorded for ${project.number}`, "success");
  }

  function handleWorkspaceSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && searchResults.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setSearchResults([]);
      setActiveSearchIndex(-1);
      return;
    }
    if (searchResults.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchIndex((current) => current < searchResults.length - 1 ? current + 1 : 0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchIndex((current) => current > 0 ? current - 1 : searchResults.length - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveSearchIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveSearchIndex(searchResults.length - 1);
      return;
    }
    if (event.key === "Enter" && activeSearchIndex >= 0) {
      event.preventDefault();
      openSearchResult(searchResults[activeSearchIndex]);
    }
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
      <aside
        id="application-navigation"
        ref={mobileNavigationRef}
        className={`sidebar ${mobileNav ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}
        aria-label="Application navigation"
        aria-hidden={mobileNavViewport && !mobileNav ? true : undefined}
        aria-modal={mobileNavActive ? true : undefined}
        inert={mobileNavViewport && !mobileNav ? true : undefined}
        role={mobileNavActive ? "dialog" : undefined}
        tabIndex={mobileNavActive ? -1 : undefined}
      >
        <div className="sidebar-brand-row">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- The supplied local brand mark does not need optimizer handling. */}
            <img className="brand-full" src="/fci-logo-enhanced-master.svg" alt="Floor Coverings International" width={1254} height={1254} />
            <span className="brand-compact" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element -- The supplied local app mark does not need optimizer handling. */}
              <img src="/fci-app-icon-master.svg" alt="" width={1254} height={1254} />
            </span>
          </div>
          <button className="sidebar-collapse" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>{sidebarCollapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}</button>
        </div>
        <button ref={mobileNavigationCloseRef} className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={20} /></button>
        <nav className="main-nav" aria-label="Main navigation">
          <p>Workspace</p>
          {navItems.slice(0, 6).map(({ label, icon: Icon, state }) => <Link key={label} href={operationsPath(label)} className={view === label ? "active" : ""} onClick={closeNavigationMenus} aria-current={view === label ? "page" : undefined} aria-label={`${label} · ${state}`} title={`${label} · ${state}`}><Icon size={18} /><span className="nav-label">{label}</span><FeatureStateBadge state={state} variant="compact" /></Link>)}
          <p>Management</p>
          {navItems.slice(6).map(({ label, icon: Icon, state }) => <Link key={label} href={operationsPath(label)} className={view === label ? "active" : ""} onClick={closeNavigationMenus} aria-current={view === label ? "page" : undefined} aria-label={`${label} · ${state}`} title={`${label} · ${state}`}><Icon size={18} /><span className="nav-label">{label}</span><FeatureStateBadge state={state} variant="compact" /></Link>)}
          {isAdmin && <a href="/management/access" aria-label="People & Access · In development" title="People & Access · In development"><ShieldCheck size={18} /><span className="nav-label">People &amp; Access</span><FeatureStateBadge state="In development" variant="compact" /></a>}
        </nav>
        <div ref={workspaceMenuRef} className="sidebar-menu-wrap workspace-menu-wrap">
          <button className="workspace-card" onClick={() => { setWorkspaceMenuOpen((current) => !current); setProfileMenuOpen(false); setNotificationsOpen(false); }} aria-controls="workspace-actions-popover" aria-expanded={workspaceMenuOpen} title="Workspace actions"><div className="workspace-icon"><Building2 size={17} /></div><div><span>{development ? "Development workspace" : "Production workspace"}</span><strong>Floor Coverings International</strong></div><ChevronDown size={16} /></button>
          {workspaceMenuOpen && <div id="workspace-actions-popover" className="sidebar-popover workspace-popover"><div className="menu-heading"><strong>FCI Operations</strong><span>{development ? "Working development environment" : "Company production environment"}</span></div><button onClick={() => navigateToView("Clients")}><ContactRound size={15} /> Client Directory</button>{isAdmin && <><button onClick={openDirectorySettings}><FolderTree size={15} /> Directory sync</button><button onClick={openGoogleWorkspace}><Building2 size={15} /> Google Workspace</button><button onClick={openTestingChecklist}><ShieldCheck size={15} /> Testing & launch</button></>}</div>}
        </div>
        <div ref={profileMenuRef} className="sidebar-menu-wrap profile-menu-wrap">
          <button className="profile" onClick={() => { setProfileMenuOpen((current) => !current); setWorkspaceMenuOpen(false); setNotificationsOpen(false); }} aria-controls="account-actions-popover" aria-expanded={profileMenuOpen} aria-label={`${userName} account actions`} title="Account actions"><div className="avatar">{userInitials}</div><div><strong>{userName}</strong><span>{accessLabel}</span></div><MoreHorizontal size={18} /></button>
          {profileMenuOpen && <div id="account-actions-popover" className="sidebar-popover profile-popover"><div className="menu-heading"><strong>{userName}</strong><span>{userEmail} · {accessLabel}</span></div><button onClick={() => void copySignedInEmail()}><Clipboard size={15} /> Copy signed-in email</button>{isAdmin && <button onClick={openGoogleWorkspace}><Building2 size={15} /> Google connection</button>}<button onClick={() => navigateToSettings("My settings")}><Settings size={15} /> My settings</button><button onClick={toggleSidebar}><ChevronsLeft size={15} /> {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}</button><a href={signOutHref}><LogOut size={15} /> Sign out</a></div>}
        </div>
      </aside>

      {mobileNavActive && <div className="sidebar-scrim" role="presentation" aria-hidden="true" onMouseDown={() => setMobileNav(false)} />}
      <main className="main-area" inert={mobileNavActive ? true : undefined}>
        <header ref={topbarRef} className={`topbar${topbarHidden ? " topbar-hidden" : ""}`}>
          <button
            ref={mobileNavigationTriggerRef}
            className="mobile-menu"
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation"
            aria-controls="application-navigation"
            aria-expanded={mobileNavActive}
          ><Menu size={21} /></button>
          <form className="search" onSubmit={(event) => { event.preventDefault(); void searchWorkspace(); }}>
            <Search size={18} aria-hidden="true" />
            <input
              ref={workspaceSearchRef}
              id="workspace-search"
              role="combobox"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setSearchResults([]);
                setActiveSearchIndex(-1);
              }}
              onKeyDown={handleWorkspaceSearchKeyDown}
              aria-label="Search workspace"
              aria-autocomplete="list"
              aria-controls="workspace-search-results"
              aria-expanded={searchResults.length > 0}
              aria-activedescendant={activeSearchIndex >= 0 ? `workspace-search-option-${activeSearchIndex}` : undefined}
              aria-busy={searching || undefined}
              placeholder="Search"
            />
            <button className="search-shortcut" type="submit" disabled={searching} aria-label="Search workspace">{searching ? "…" : "Ctrl K"}</button>
            {searchResults.length > 0 && <div id="workspace-search-results" className="global-search-results" role="listbox" aria-label="Workspace search results">
              {searchResults.map((result, index) => <button
                id={`workspace-search-option-${index}`}
                type="button"
                key={`${result.kind}-${result.id}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === activeSearchIndex}
                onMouseEnter={() => setActiveSearchIndex(index)}
                onClick={() => openSearchResult(result)}
              ><span>{result.kind === "project" ? <BriefcaseBusiness size={14} /> : result.kind === "contact" ? <ContactRound size={14} /> : <Users size={14} />}</span><div><strong>{result.title}</strong><small>{result.kind} · {result.subtitle}</small></div><ChevronRight size={14} /></button>)}
            </div>}
          </form>
          <div className="top-actions"><div ref={notificationsMenuRef} className="notification-wrap"><button className="icon-button" onClick={() => { setNotificationsOpen((current) => !current); setWorkspaceMenuOpen(false); setProfileMenuOpen(false); }} aria-label="Workspace navigation" title="Workspace navigation" aria-controls="notifications-popover" aria-expanded={notificationsOpen}><Navigation size={19} aria-hidden="true" /></button>{notificationsOpen && <div id="notifications-popover" className="notification-menu"><strong>Workspace navigation</strong><button onClick={() => navigateToView("Inbox")}>Open the Gmail project inbox</button><button onClick={() => navigateToView("Schedule")}>View scheduling status</button></div>}</div></div>
        </header>

        <div className="page-wrap">
          {development && <section className="development-banner" role="status" aria-label="Development environment; test data only"><ShieldCheck size={17} /><div><strong>Development environment · Test data only</strong><span>Use approved test records while this working copy moves toward production readiness.</span></div></section>}
          <LiveDataBanner state={liveDataState} error={liveDataError} onRetry={() => void refreshDirectoryData()} />
          {view === "Overview" && <Overview firstName={firstName} timezone={displayTimezone} leads={leads} projects={projectItems} dashboard={dashboard} state={liveDataState} isAdmin={isAdmin} layout={pageLayouts.overview} layoutReady={pageLayoutsReady} layoutError={pageLayoutsError} onRetryLayout={() => void retryPageLayouts()} onSaveLayout={(layout) => savePageLayout("overview", layout)} onView={navigateToView} onProject={openProject} onLead={openLead} />}
          {view === "Leads" && <LeadsView leads={leads} state={liveDataState} filter={leadStageFilter} onAdd={() => setLeadModal({})} onAdvance={advanceLead} onLead={openLead} />}
          {view === "Clients" && <ClientsView clients={clients} state={liveDataState} projectCounts={clientProjectCounts} onAdd={() => setClientModal(true)} onClient={openClient} onNewProject={() => openNewProject()} sheetMirror={sheetMirror} onSyncGoogleSheet={syncGoogleSheet} syncingSheet={sheetSyncing} />}
          {view === "Projects" && <ProjectsView projects={projectItems} state={liveDataState} filter={projectStatus} lifecycle={projectLifecycle} onFilter={navigateToProjectStatus} onNewProject={() => openNewProject()} onProject={openProject} />}
          {view === "Schedule" && <ScheduleView dashboard={dashboard} onSettings={() => navigateToSettings("Workflow & notifications")} />}
          {view === "Inbox" && <InboxView notify={notify} bucket={inboxBucket} onBucket={navigateToInboxBucket} onRules={openRules} projects={projectItems} clients={clients} rules={filingRules} onGoogleSetup={openGoogleWorkspace} onCreateLead={openInboxLead} />}
          {view === "AI Assistant" && <AssistantView projects={projectItems} />}
          {view === "Reports" && <ReportsView leads={leads} projects={projectItems} clients={clients} dashboard={dashboard} state={liveDataState} isAdmin={isAdmin} layout={pageLayouts.reports} layoutReady={pageLayoutsReady} layoutError={pageLayoutsError} onRetryLayout={() => void retryPageLayouts()} onSaveLayout={(layout) => savePageLayout("reports", layout)} />}
          {view === "Settings" && <SettingsView notify={notify} section={settingsArea} onSection={navigateToSettings} onTimezoneChange={setDisplayTimezone} onCurrentUserSettingsLoaded={reconcileCurrentUserSettings} rules={filingRules} projects={projectItems} userName={userName} userEmail={userEmail} isAdmin={isAdmin} onGoogleSetup={openGoogleWorkspace} onAddRule={() => setRuleModal(true)} onUpdateRule={updateRule} onDeleteRule={deleteRule} sheetMirror={sheetMirror} onSyncGoogleSheet={syncGoogleSheet} onImportConfirmed={refreshDirectoryData} syncingSheet={sheetSyncing} />}
        </div>
      </main>
      {leadModal && <LeadModal mode="create" initialValues={leadModal.initialValues} isAdmin={isAdmin} onClose={() => setLeadModal(null)} onSave={addLead} />}
      {clientModal && <ClientModal onClose={() => setClientModal(false)} onSave={addClient} />}
      {projectModal && <NewProjectModal clients={clients} initialClientId={projectModalClientId} managerId={userEmail.trim().toLowerCase()} managerLabel={userName.trim() || userEmail} isAdmin={isAdmin} onClose={closeNewProject} onSave={addProject} />}
      {ruleModal && <RuleModal onClose={() => setRuleModal(false)} onSave={addRule} />}
      {leadOpen && selectedLead && <LeadDrawer lead={selectedLead} isAdmin={isAdmin} onClose={() => setLeadOpen(false)} onAdvance={advanceLead} onSaveLead={saveLeadEdits} returnFocusRef={leadDrawerReturnFocusRef} fallbackFocusRef={workspaceSearchRef} />}
      {projectOpen && selectedProject && <ProjectDrawer project={selectedProject} clients={clients} jobSiteMaps={jobSiteMaps} onClose={() => setProjectOpen(false)} notify={notify} onSaveProject={saveProjectEdits} onProvisionDrive={provisionProjectDrive} onAssignToMe={assignProjectToCurrentUser} onRecordInstallationDates={recordProjectInstallationDates} onRecordFollowUpResult={recordProjectFollowUpResult} onMeetingRecorded={() => void refreshDashboardSnapshot().catch(() => {})} isAdmin={isAdmin} currentUserEmail={userEmail.trim().toLowerCase()} returnFocusRef={projectDrawerReturnFocusRef} />}
      {clientOpen && selectedClient && <ClientDrawer client={selectedClient} projects={projectItems.filter((project) => project.clientId === selectedClient.id)} jobSiteMaps={jobSiteMaps} onClose={() => setClientOpen(false)} onSaveClient={saveClientEdits} onSaveContact={saveContactEdits} onNewProject={() => { setClientOpen(false); openNewProject(selectedClient.id); }} onProject={(project) => { setClientOpen(false); openProject(project); }} returnFocusRef={clientDrawerReturnFocusRef} />}
      {toast && <div className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} aria-live={toast.kind === "error" ? "assertive" : "polite"} aria-atomic="true">
        {toast.kind === "success" ? <CheckCircle2 size={18} aria-hidden="true" /> : toast.kind === "info" ? <Info size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
        <span>{toast.message}</span>
        {toast.action && <button type="button" className="toast-action" onClick={() => { const action = toast.action; dismissNotification(); action?.run(); }}>{toast.action.label}</button>}
        <button type="button" className="toast-dismiss" onClick={dismissNotification} aria-label="Dismiss notification"><X size={16} aria-hidden="true" /></button>
      </div>}
    </div>
  );
}

function LiveDataBanner({ state, error, onRetry }: { state: LiveDataState; error: string; onRetry: () => void }) {
  if (state === "ready") return null;
  if (state === "loading") return <section className="client-directory-banner" role="status" aria-live="polite"><div className="directory-badge"><RefreshCw size={19} /></div><div><strong>Loading live records</strong><span>Reading leads, clients, projects, activity, and Google directory status.</span></div></section>;
  return <section className="schedule-alert" role="alert"><CircleAlert size={19} /><div><strong>Live records could not be loaded</strong><span>{error}</span></div><button onClick={onRetry}>Try again</button></section>;
}

function unavailableMetricNote(state: LiveDataState) {
  return state === "error" ? "Unavailable until live records load" : "Loading current totals";
}

function overviewMeetingDate(value: number, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
}

function Overview({ firstName, timezone, leads, projects, dashboard, state, isAdmin, layout, layoutReady, layoutError, onRetryLayout, onSaveLayout, onView, onProject, onLead }: { firstName: string | null; timezone: string; leads: Lead[]; projects: Project[]; dashboard: DashboardSummary | null; state: LiveDataState; isAdmin: boolean; layout: PageLayout; layoutReady: boolean; layoutError: string; onRetryLayout: () => void; onSaveLayout: (layout: PageLayout) => Promise<void>; onView: (v: OperationsView) => void; onProject: (p: Project, returnFocusTarget?: HTMLElement | null) => void; onLead: (lead: Lead, returnFocusTarget?: HTMLElement | null) => void }) {
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  useEffect(() => {
    const initialClock = window.requestAnimationFrame(() => setCurrentTime(Date.now()));
    const clock = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => {
      window.cancelAnimationFrame(initialClock);
      window.clearInterval(clock);
    };
  }, []);
  const { greeting, dateLabel } = currentTime ? dashboardTimeContext(currentTime, timezone) : { greeting: "Welcome", dateLabel: "Operations overview" };
  const metrics = dashboard?.metrics;
  const activeLeads = leads.filter((lead) => lead.status.toLowerCase() === "active");
  const activeProjects = projects.filter(isActiveProject);
  const recordsReady = state === "ready";
  const pendingMetricNote = unavailableMetricNote(state);
  const todayMeetingItems = dashboard?.todayMeetings?.items ?? [];
  const todayMeetings = todayMeetingItems.flatMap((meeting) => {
    const project = projects.find((candidate) => candidate.id === meeting.projectId);
    return project ? [{ meeting, project }] : [];
  });
  const todayMeetingsHaveDroppedRows = todayMeetings.length !== todayMeetingItems.length;
  const todayMeetingsTotal = Math.max(todayMeetingItems.length, dashboard?.todayMeetings?.total ?? 0);
  const todayMeetingsOverflow = todayMeetingsHaveDroppedRows
    ? 0
    : Math.max(0, todayMeetingsTotal - todayMeetingItems.length);
  const sectionNodes = {
    metrics: <section className="metrics-grid">
      <Metric label="Active pipeline" value={recordsReady ? money(metrics?.estimatedPipelineValue ?? 0) : "—"} note={recordsReady ? `${metrics?.activeLeads ?? activeLeads.length} open opportunities` : pendingMetricNote} icon={Zap} color="orange" href={recordsReady ? operationsHref("Leads") : undefined} />
      <Metric label="Active projects" value={recordsReady ? String(metrics?.activeProjects ?? activeProjects.length) : "—"} note={recordsReady ? "Projects currently in progress" : pendingMetricNote} icon={HardHat} color="green" href={recordsReady ? operationsHref("Projects", { projectStatus: "Active" }) : undefined} />
      <Metric label="Project meetings" value={recordsReady ? String(metrics?.meetingCount ?? 0) : "—"} note={recordsReady ? "Meeting notes saved" : pendingMetricNote} icon={MessageSquareText} color="blue" />
      <Metric label="Filed emails" value={recordsReady ? String(metrics?.filedEmailCount ?? 0) : "—"} note={recordsReady ? "Emails filed to projects" : pendingMetricNote} icon={Mail} color="violet" href={recordsReady ? operationsHref("Inbox") : undefined} />
    </section>,
    "todays-meetings": <section className="panel report-chart">
      <PanelHeader title="Today's meetings" subtitle="Today + upcoming" />
      {todayMeetings.length > 0 ? <ul className="bar-chart" aria-label="Today's and upcoming project meetings">
        {todayMeetings.map(({ meeting, project }) => <li key={meeting.id}>
          <Link
            className="bar-chart-row actionable"
            href={operationsHref("Projects")}
            aria-label={`Open project ${meeting.projectNumber} for ${meeting.title}`}
            onClick={(event) => {
              event.preventDefault();
              onProject(project, event.currentTarget);
            }}
          >
            <span className="client-cell-copy"><strong title={meeting.title}>{meeting.title}</strong></span>
            <span className="client-cell-copy"><span title={`${meeting.projectNumber} — ${meeting.projectName}`}>{meeting.projectNumber} — {meeting.projectName}</span></span>
            <span className="client-cell-copy"><strong title={overviewMeetingDate(meeting.meetingAt, timezone)}>{overviewMeetingDate(meeting.meetingAt, timezone)}</strong></span>
            <ChevronRight className="bar-chart-chevron" size={16} aria-hidden="true" />
          </Link>
        </li>)}
        {todayMeetingsOverflow > 0 && <li><div className="bar-chart-row"><span className="bar-chart-label">and {todayMeetingsOverflow} more…</span><span>Additional saved meetings</span><strong>Upcoming</strong><span className="bar-chart-spacer" aria-hidden="true" /></div></li>}
        {todayMeetingsHaveDroppedRows && <li><div className="bar-chart-row"><span className="bar-chart-label">Additional meeting count unavailable</span><span>One or more project records did not load.</span><strong>Unavailable</strong><span className="bar-chart-spacer" aria-hidden="true" /></div></li>}
      </ul> : <OperationsEmptyState variant="table">{state === "ready" && todayMeetingsHaveDroppedRows ? "Saved meetings cannot be displayed until their project records load." : state === "ready" ? "No today or upcoming project meetings are saved." : state === "error" ? "Today's meetings are unavailable until live records load." : "Loading today's meetings…"}</OperationsEmptyState>}
    </section>,
    "lead-pipeline": <div className="panel pipeline-panel">
        <PanelHeader title="Lead pipeline" subtitle={`${activeLeads.length} active records`} action="View all" onAction={() => onView("Leads")} />
        {activeLeads.length > 0 ? <OperationsActionableList ariaLabel="Lead pipeline records" columns={PIPELINE_ACTIONABLE_COLUMNS} headerClassName="pipeline-head">
          {activeLeads.slice(0, 4).map((lead) => <OperationsActionableListItem
            key={lead.id}
            className="pipeline-row pipeline-row-button"
            accessibleName={`Open lead details for ${lead.company}: ${lead.project}`}
            accessibleDescription={`Stage ${lead.stage}. Estimated value ${lead.value}. Next action ${lead.next}.`}
            onActivate={(trigger) => onLead(lead, trigger)}
          >
            <span className="client-cell"><Avatar initials={lead.initials} color={lead.color} /><span className="client-cell-copy"><strong>{lead.company}</strong><span>{lead.project}</span></span></span>
            <span><Status text={lead.stage} /></span>
            <strong className="value-cell">{lead.value}</strong>
            <span className="next-cell"><Clock3 size={14} aria-hidden="true" />{lead.next}</span>
          </OperationsActionableListItem>)}
        </OperationsActionableList> : state === "ready" ? <OperationsEmptyState variant="table">No active leads yet. Add the first opportunity to begin the live pipeline.</OperationsEmptyState> : null}
      </div>,
    scheduling: <div className="panel schedule-panel">
        <PanelHeader title="Scheduling" badge="Planned" action="View status" onAction={() => onView("Schedule")} />
        <OperationsEmptyState variant="dashboard"><CalendarDays size={20} /><div><strong>Scheduling is planned for a later milestone</strong><p>{dashboard?.readiness.scheduleReason ?? "Workers, crews, shifts, conflicts, and acknowledgements will appear here after the scheduling foundation is approved."}</p></div></OperationsEmptyState>
      </div>,
    "active-projects": <div className="panel projects-panel"><PanelHeader title="Active projects" subtitle={`${activeProjects.length} active`} action="View projects" onAction={() => onView("Projects")} /><div className="project-cards">{activeProjects.slice(0, 6).map((project) => <button className="project-card" key={project.number} onClick={() => onProject(project)}><div className="project-card-top"><Status text={project.status} /><ChevronRight size={17} aria-hidden="true" /></div><span className="project-number">{project.number}</span><h3>{project.name}</h3><p>{project.client}</p><div className="project-meta"><span><MapPin size={13} />{project.site}</span><span>{project.value}</span></div></button>)}{activeProjects.length === 0 && state === "ready" ? <OperationsEmptyState variant="table">No active projects. Completed, cancelled, and archived work remains available on the Projects page.</OperationsEmptyState> : null}</div></div>,
    "gmail-project-inbox": <div className="panel inbox-panel"><PanelHeader title="Gmail project inbox" subtitle="Google Workspace Gmail" subtitleKind="source" action="Open inbox" onAction={() => onView("Inbox")} /><OperationsEmptyState variant="dashboard"><Mail size={20} /><div><strong>Review every message before filing</strong><p>Select the exact project and approve the copy before anything is saved to Drive.</p></div></OperationsEmptyState><button className="inbox-cta" onClick={() => onView("Inbox")}><Mail size={15} /> Open Gmail project inbox</button></div>,
  } as const;

  return <PageLayoutEditor page="overview" layout={layout} isAdmin={isAdmin} enabled={layoutReady} loadError={layoutError} onRetry={onRetryLayout} onSave={onSaveLayout}>{({ layout: activeLayout, editing, editButton, editor, endDropZone, section }) => {
    const visibleKeys = activeLayout.order.filter((key) => !activeLayout.hidden.includes(key) && key in sectionNodes) as Array<keyof typeof sectionNodes>;
    const arrangedSpans = resolveArrangedSpans("overview", visibleKeys, activeLayout.fullWidth);
    const defaultSections = <>
      {sectionNodes.metrics}
      {sectionNodes["todays-meetings"]}
      <section className="dashboard-grid">{sectionNodes["lead-pipeline"]}{sectionNodes.scheduling}</section>
      <section className="dashboard-grid lower-grid">{sectionNodes["active-projects"]}{sectionNodes["gmail-project-inbox"]}</section>
    </>;
    const arrangedSections = <><div className="page-layout-grid page-layout-grid-overview">{arrangedSpans.map(({ key, size }) => <div className={size === "full" ? "page-layout-span-all" : "page-layout-item"} data-page-layout-section={key} data-page-layout-size={size} key={key}>{section(key, sectionNodes[key])}</div>)}</div>{endDropZone}</>;
    return <>
      <PageTitle eyebrow={dateLabel} title={`${greeting}${firstName ? `, ${firstName}` : ""}.`} text={recordsReady ? "Here’s the latest from your operations workspace." : "Connecting to your operations workspace."} state="Working" action={<><button className="soft-button" onClick={() => onView("Schedule")}><CalendarDays size={16} /> View scheduling status</button>{editButton}</>} />
      {editor}
      {!editing && isDefaultPageLayout(activeLayout, "overview", isAdmin) ? defaultSections : arrangedSections}
    </>;
  }}</PageLayoutEditor>;
}

function LeadsView({ leads, state, filter, onAdd, onAdvance, onLead }: { leads: Lead[]; state: LiveDataState; filter: LeadStageFilter | null; onAdd: () => void; onAdvance: (id: string) => void; onLead: (lead: Lead, returnFocusTarget?: HTMLElement | null) => void }) {
  const activeLeads = leads.filter((lead) => lead.status.toLowerCase() === "active");
  const visibleActiveLeads = filter ? activeLeads.filter((lead) => leadMatchesStageFilter(lead, filter)) : activeLeads;
  const knownStages = new Set(leadStages.map((stage) => stage.toLowerCase()));
  const standardLeads = visibleActiveLeads.filter((lead) => knownStages.has(lead.stage.toLowerCase()));
  const customStageLeads = visibleActiveLeads.filter((lead) => !knownStages.has(lead.stage.toLowerCase()));
  const inactiveLeads = leads.filter((lead) => lead.status.toLowerCase() !== "active");
  const pipelineValue = visibleActiveLeads.reduce((total, lead) => total + lead.estimatedValue, 0);
  const filterLabel = filter ? LEAD_STAGE_LABELS[filter] : null;
  const summary = state === "ready"
    ? filterLabel
      ? `${visibleActiveLeads.length} active ${visibleActiveLeads.length === 1 ? "lead" : "leads"} in ${filterLabel} · ${money(pipelineValue)} estimated value`
      : `${activeLeads.length} open opportunities · ${money(pipelineValue)} estimated value`
    : "Loading current pipeline totals…";
  const stagesToRender = filter && filter !== "other" ? [LEAD_STAGE_LABELS[filter]] : leadStages;

  return <><PageTitle eyebrow="Sales pipeline" title="Leads & opportunities" text={summary} state="In development" action={<button className="primary-button" onClick={onAdd}><Plus size={17} /> Add lead</button>} />
    {filterLabel && <ActiveRouteFilter focusKey={`lead:${filter}`} headingId="lead-stage-filter-title" title={`Filtered to ${filterLabel}`} description="Showing active leads that match the selected pipeline row." clearHref={operationsHref("Leads")} />}
    {visibleActiveLeads.length === 0 && state === "ready" ? <OperationsEmptyState variant="page"><div><Zap size={25} /></div><h2>{filterLabel ? `No active leads in ${filterLabel}` : "No active leads"}</h2><p>{filterLabel ? "The report filter is valid, but no current records match it." : "Add your first lead. Inactive records remain listed below."}</p>{filterLabel ? <Link className="soft-button" href={operationsHref("Leads")}>Show all active leads</Link> : <button className="primary-button" onClick={onAdd}><Plus size={16} /> Add first lead</button>}</OperationsEmptyState> : standardLeads.length > 0 ? <div className={`board${filter ? " filtered-board" : ""}`}>{stagesToRender.map((stage) => { const stageLeads = standardLeads.filter((lead) => lead.stage.toLowerCase() === stage.toLowerCase()); return <section className="board-column" key={stage}><header><h2>{stage}</h2><b>{stageLeads.length}</b></header>{stageLeads.map((lead) => <article className="lead-card" key={lead.id}><div className="lead-card-head"><Avatar initials={lead.initials} color={lead.color} /><span>{lead.number}</span></div><h3>{lead.company}</h3><p>{lead.project}</p><div className="lead-value">{lead.value}</div><div className="lead-contact"><Users size={14} />{lead.contact}</div><button type="button" className="lead-detail-button" aria-label={`View details for ${lead.company}`} onClick={(event) => onLead(lead, event.currentTarget)}>View details <ChevronRight size={14} /></button><footer><span>{lead.source}</span><button onClick={() => onAdvance(lead.id)} aria-label={`Advance ${lead.company} from ${lead.stage}`}>Advance <ChevronRight size={15} /></button></footer></article>)}{stageLeads.length === 0 && <OperationsEmptyState variant="board">No leads in this stage.</OperationsEmptyState>}</section>; })}</div> : null}
    {customStageLeads.length > 0 && <LeadStatusPanel title="Custom pipeline stages" subtitle="These leads use stages outside the current pipeline. Review their stage before advancing them." leads={customStageLeads} onLead={onLead} />}
    {!filter && inactiveLeads.length > 0 && <LeadStatusPanel title="Inactive leads" subtitle="Converted, lost, closed, and archived leads are excluded from active totals." leads={inactiveLeads} showRecordStatus onLead={onLead} />}
  </>;
}

function LeadStatusPanel({ title, subtitle, leads, showRecordStatus = false, onLead }: { title: string; subtitle: string; leads: Lead[]; showRecordStatus?: boolean; onLead?: (lead: Lead, returnFocusTarget?: HTMLElement | null) => void }) {
  return <section className="panel pipeline-panel"><PanelHeader title={title} subtitle={subtitle} /><div className="pipeline-head"><span>Client / opportunity</span><span>{showRecordStatus ? "Status" : "Stage"}</span><span>Est. value</span><span>Next action</span></div>{leads.map((lead) => <div className="pipeline-row" key={lead.id}><div className="client-cell"><Avatar initials={lead.initials} color={lead.color} /><div className="client-cell-copy"><strong>{lead.company}</strong><span>{lead.project}</span></div></div><div><Status text={showRecordStatus ? displayStatus(lead.status, "Inactive") : lead.stage} /></div><strong className="value-cell">{lead.value}</strong><div className="next-cell lead-status-next"><span><Clock3 size={14} />{lead.next}</span>{onLead && <button type="button" className="lead-status-detail" aria-label={`View details for ${lead.company}`} onClick={(event) => onLead(lead, event.currentTarget)}>View details <ChevronRight size={14} /></button>}</div></div>)}</section>;
}

function ClientsView({ clients, state, projectCounts, onAdd, onClient, onNewProject, sheetMirror, onSyncGoogleSheet, syncingSheet }: { clients: Client[]; state: LiveDataState; projectCounts: Map<string, number>; onAdd: () => void; onClient: (client: Client, returnFocusTarget?: HTMLElement | null) => void; onNewProject: () => void; sheetMirror: SheetMirrorStatus | null; onSyncGoogleSheet: () => Promise<void>; syncingSheet: boolean }) {
  const [clientFilter, setClientFilter] = useState("");
  const syncLabel = sheetMirrorStatusLabel(sheetMirror);
  const synced = syncLabel === "Synced";
  const needsAttention = syncLabel === "Needs attention";
  const syncStateClass = synced ? "synced" : needsAttention ? "needs-attention" : syncLabel === "Checking sync" || syncLabel === "Syncing" ? "checking" : "not-synced";
  const normalizedFilter = clientFilter.trim().toLowerCase();
  const visibleClients = normalizedFilter ? clients.filter((client) => [client.name, client.code, client.contact, client.email].some((value) => value.toLowerCase().includes(normalizedFilter))) : clients;
  return <><PageTitle eyebrow="Client directory" title="Clients" text="Keep each client’s contacts, account documents, and projects together." state="In development" action={<><button className="soft-button" onClick={onNewProject} disabled={clients.length === 0}><BriefcaseBusiness size={16} /> New project</button><button className="primary-button" onClick={onAdd}><Plus size={17} /> Add client</button></>} />
    <section className="client-directory-banner"><div className="directory-badge"><FolderTree size={20} /></div><div><strong>Client records are managed here and mirrored to Google Sheets</strong><span>{sheetMirror?.reason ?? "The Client Directory preserves account notes, while the Project Register is generated from the app."}</span></div><div className="directory-sync-actions"><span className={`directory-status ${syncStateClass}`}>{synced ? <CircleCheckBig size={14} /> : <Clock3 size={14} />}{syncLabel}</span><button className="soft-button" onClick={() => void onSyncGoogleSheet()} disabled={syncingSheet}>{syncingSheet ? "Syncing…" : "Sync directory"}</button></div></section>
    <div className="client-directory panel"><div className="client-directory-toolbar"><label><span>Find a client</span><div><Search size={15} /><input value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} placeholder="Name, code, or email" /></div></label><small>{visibleClients.length} of {clients.length} clients</small></div><OperationsActionableList ariaLabel="Client directory" columns={CLIENT_ACTIONABLE_COLUMNS} headerClassName="client-table-head">
      {visibleClients.map((client) => { const projectCount = projectCounts.get(client.id) ?? 0; return <OperationsActionableListItem
        key={client.id}
        className="client-table-row"
        accessibleName={`Open client ${client.name}, ${client.code}`}
        accessibleDescription={`Industry ${client.industry}. Primary contact ${client.contact}, ${client.email || "email to add"}. ${projectCount} ${projectCount === 1 ? "project" : "projects"}.`}
        onActivate={(trigger) => onClient(client, trigger)}
      >
        <span className="client-identity"><Avatar initials={client.initials} color={client.color} /><span className="client-identity-copy"><strong>{client.name}</strong><small>{client.code} · {client.industry}</small></span></span>
        <span className="client-primary-contact"><strong>{client.contact}</strong><small>{client.email || "Email to add"}</small></span>
        <span className="client-project-count"><b>{projectCount}</b><small>{projectCount === 1 ? "project" : "projects"}</small></span>
        <ChevronRight size={17} aria-hidden="true" />
      </OperationsActionableListItem>})}
    </OperationsActionableList>{clients.length === 0 && state === "ready" ? <OperationsEmptyState variant="table">No clients yet. Add the first client to create the live directory.</OperationsEmptyState> : visibleClients.length === 0 && state === "ready" ? <OperationsEmptyState variant="table">No clients match “{clientFilter.trim()}”.</OperationsEmptyState> : null}</div>
  </>;
}

function ProjectsView({ projects, state, filter, lifecycle, onFilter, onProject, onNewProject }: { projects: Project[]; state: LiveDataState; filter: ProjectStatusFilter; lifecycle: ProjectLifecycleFilter | null; onFilter: (filter: ProjectStatusFilter) => void; onProject: (project: Project, returnFocusTarget?: HTMLElement | null) => void; onNewProject: () => void }) {
  const filteredProjects = projects.filter((project) => {
    const status = project.status.toLowerCase();
    if (lifecycle) return status === lifecycle;
    return filter === "Active" ? !terminalProjectStatuses.has(status) : status === filter.toLowerCase();
  });
  const filterCount = (stage: string) => stage === "Active" ? projects.filter(isActiveProject).length : projects.filter((project) => project.status.toLowerCase() === stage.toLowerCase()).length;
  const lifecycleLabel = lifecycle ? displayStatus(lifecycle, "Unknown") : null;

  return <><PageTitle eyebrow="Project delivery" title="Projects" text="Track every project separately, including repeat work for the same client." state="In development" action={<button className="primary-button" onClick={onNewProject}><Plus size={17} /> New project</button>} />
    <div className="filterbar"><div className="tabs" aria-label="Project status filter">{PROJECT_STATUS_FILTERS.map((stage) => <button className={filter === stage ? "active" : ""} aria-pressed={filter === stage} key={stage} onClick={() => onFilter(stage)}>{stage}<b>{filterCount(stage)}</b></button>)}</div></div>
    {lifecycleLabel && <ActiveRouteFilter focusKey={`project:${lifecycle}`} headingId="project-lifecycle-filter-title" title={`Filtered to ${lifecycleLabel}`} description="Showing projects with this exact lifecycle status." clearHref={operationsHref("Projects")} />}
    <div className="projects-table panel"><OperationsActionableList ariaLabel="Projects" columns={PROJECT_ACTIONABLE_COLUMNS} headerClassName="projects-table-head">
      {filteredProjects.map((project) => <OperationsActionableListItem
        key={project.id}
        className="projects-table-row"
        accessibleName={`Open project ${project.number}: ${project.name}`}
        accessibleDescription={`Client ${project.client}. Status ${project.status}. Schedule ${project.date}. Site ${project.site}. Estimated value ${project.value}.`}
        onActivate={(trigger) => onProject(project, trigger)}
      >
        <span className="project-row-identity"><Avatar initials={recordInitials(project.client)} color={project.accent} /><span><strong>{project.name}</strong><small>{project.number} · {project.client}</small></span></span>
        <span className="project-row-status"><Status text={project.status} /></span>
        <span className="project-row-details"><span className={project.date.toLowerCase() === "not scheduled" ? "is-unscheduled" : ""}>{project.date}</span><small><MapPin size={12} aria-hidden="true" />{project.site}</small></span>
        <strong className="project-row-value"><span>Estimated value</span>{project.value}</strong>
        <ChevronRight size={17} aria-hidden="true" />
      </OperationsActionableListItem>)}
    </OperationsActionableList>{!filteredProjects.length && <OperationsEmptyState variant="table">{state === "ready" ? lifecycleLabel ? `There are no projects in ${lifecycleLabel}.` : filter === "Active" ? "No active projects yet." : `There are no ${filter.toLowerCase()} projects.` : "Loading projects…"}</OperationsEmptyState>}</div>
  </>;
}

function ScheduleView({ dashboard, onSettings }: { dashboard: DashboardSummary | null; onSettings: () => void }) {
  return <><PageTitle eyebrow="Field operations" title="Schedule & crews" text="Scheduling is planned for a later milestone." state="Planned" action={<button className="soft-button" onClick={onSettings}><Settings size={16} /> Workflow & notification settings</button>} />
    <OperationsEmptyState variant="page"><div><CalendarDays size={27} /></div><h2>What the scheduling workspace will include</h2><p>{dashboard?.readiness.scheduleReason ?? "Workers, crews, shifts, conflicts, and assignment acknowledgements will appear here after the scheduling foundation is approved."}</p></OperationsEmptyState>
  </>;
}

function ReportBarRow({ label, measure, width, href, accessibleName, focusId, destinationFocusKey }: { label: string; measure: string; width: number; href?: string; accessibleName?: string; focusId?: string; destinationFocusKey?: string }) {
  const content = <><span className="bar-chart-label">{label}</span><span className="bar-chart-track" aria-hidden="true"><i style={{ width: `${width}%` }} /></span><strong>{measure}</strong>{href ? <ChevronRight className="bar-chart-chevron" size={16} aria-hidden="true" /> : <span className="bar-chart-spacer" aria-hidden="true" />}</>;
  return <li>{href && accessibleName && focusId && destinationFocusKey ? <Link id={focusId} className="bar-chart-row actionable" href={href} aria-label={accessibleName} onClick={() => rememberReportReturnFocus(focusId, destinationFocusKey)}>{content}</Link> : <div className="bar-chart-row">{content}</div>}</li>;
}

function ReportsView({ leads, projects, clients, dashboard, state, isAdmin, layout, layoutReady, layoutError, onRetryLayout, onSaveLayout }: { leads: Lead[]; projects: Project[]; clients: Client[]; dashboard: DashboardSummary | null; state: LiveDataState; isAdmin: boolean; layout: PageLayout; layoutReady: boolean; layoutError: string; onRetryLayout: () => void; onSaveLayout: (layout: PageLayout) => Promise<void> }) {
  const [selectedMonth, setSelectedMonth] = useState(() => monthKeyForTimestamp(Date.now()) ?? new Date().toISOString().slice(0, 7));
  const activeLeads = leads.filter((lead) => lead.status.toLowerCase() === "active");
  const standardStageValues = LEAD_STAGE_FILTERS.filter((filter) => filter !== "other").map((filter) => {
    const stage = LEAD_STAGE_LABELS[filter];
    const matchingLeads = activeLeads.filter((lead) => lead.stage.toLowerCase() === stage.toLowerCase());
    return { stage, filter, count: matchingLeads.length, value: matchingLeads.reduce((total, lead) => total + lead.estimatedValue, 0) };
  });
  const otherStageLeads = activeLeads.filter((lead) => !leadStages.some((stage) => stage.toLowerCase() === lead.stage.toLowerCase()));
  const otherStageValue = otherStageLeads.reduce((total, lead) => total + lead.estimatedValue, 0);
  const stageValues = otherStageLeads.length > 0 ? [...standardStageValues, { stage: LEAD_STAGE_LABELS.other, filter: "other" as const, count: otherStageLeads.length, value: otherStageValue }] : standardStageValues;
  const maximumStageMeasure = Math.max(1, ...stageValues.map((item) => isAdmin ? item.value : item.count));
  const projectStatuses = [...(dashboard?.projectsByStatus ?? [])].sort((left, right) => {
    const leftIndex = projectLifecycleOrder.indexOf(left.status.toLowerCase());
    const rightIndex = projectLifecycleOrder.indexOf(right.status.toLowerCase());
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex) || left.status.localeCompare(right.status);
  });
  const maximumProjectCount = Math.max(1, ...projectStatuses.map((item) => item.count));
  const clientIndustryReport = clientIndustryReportState(clients, state);
  const maximumClientIndustryCount = Math.max(1, ...clientIndustryReport.rows.map((item) => item.count));
  const metrics = dashboard?.metrics;
  const activeProjectCount = metrics?.activeProjects ?? projects.filter(isActiveProject).length;

  useEffect(() => {
    if (!layoutReady) return;
    const currentHistoryState = window.history.state as Record<string, unknown> | null;
    const returnFocusId = typeof currentHistoryState?.[reportsReturnFocusHistoryKey] === "string"
      ? currentHistoryState[reportsReturnFocusHistoryKey]
      : null;
    if (!returnFocusId) return;
    const returnFocusTarget = document.getElementById(returnFocusId);
    if (!returnFocusTarget) {
      if (state === "ready") clearReportReturnFocusFromCurrentHistoryEntry();
      return;
    }
    const focusFrame = window.requestAnimationFrame(() => {
      returnFocusTarget.focus();
      clearReportReturnFocusFromCurrentHistoryEntry();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [activeLeads.length, layoutReady, projectStatuses.length, state]);

  const recordsReady = state === "ready";
  const pendingMetricNote = unavailableMetricNote(state);
  const sectionNodes = {
    "summary-metrics": <section className="metrics-grid"><Metric label="Pipeline value" value={!recordsReady ? "—" : isAdmin ? money(metrics?.estimatedPipelineValue ?? 0) : FINANCIAL_RESTRICTION_LABEL} note={!recordsReady ? pendingMetricNote : isAdmin ? `${metrics?.activeLeads ?? activeLeads.length} active leads` : "Financial totals are restricted"} icon={Zap} color="orange" href={recordsReady ? operationsHref("Leads") : undefined} /><Metric label="Active projects" value={recordsReady ? String(activeProjectCount) : "—"} note={recordsReady ? `${activeProjectCount} of ${projects.length} project records active` : pendingMetricNote} icon={BriefcaseBusiness} color="green" href={recordsReady ? operationsHref("Projects", { projectStatus: "Active" }) : undefined} /><Metric label="Clients" value={recordsReady ? String(metrics?.clientCount ?? clients.length) : "—"} note={recordsReady ? "Client accounts" : pendingMetricNote} icon={Users} color="blue" href={recordsReady ? operationsHref("Clients") : undefined} /><Metric label="Project meetings" value={recordsReady ? String(metrics?.meetingCount ?? 0) : "—"} note={recordsReady ? "Meeting notes saved" : pendingMetricNote} icon={MessageSquareText} color="violet" /></section>,
    "business-kpis": <BusinessKpisPanel leads={leads} projects={projects} isAdmin={isAdmin} state={state} selectedMonth={selectedMonth} onSelectedMonthChange={setSelectedMonth} />,
    "pipeline-by-stage": <section className="panel report-chart"><PanelHeader title="Pipeline by stage" subtitle={isAdmin ? "Estimated value" : "Lead count · financial values restricted"} />{activeLeads.length > 0 ? <ul className="bar-chart" aria-label="Pipeline stages">{stageValues.map((item) => { const href = item.count > 0 ? operationsHref("Leads", { leadStage: item.filter }) : undefined; const focusId = href ? `report-lead-${item.filter}` : undefined; const measure = isAdmin ? money(item.value) : String(item.count); return <ReportBarRow key={item.stage} label={item.stage} measure={measure} width={Math.round(((isAdmin ? item.value : item.count) / maximumStageMeasure) * 100)} href={href} focusId={focusId} destinationFocusKey={href ? `lead:${item.filter}` : undefined} accessibleName={href ? `View ${item.stage} leads — ${item.count} active ${item.count === 1 ? "lead" : "leads"}${isAdmin ? `, ${money(item.value)} estimated value` : ""}` : undefined} />; })}</ul> : state === "ready" ? <OperationsEmptyState variant="table">No active leads are available for this report.</OperationsEmptyState> : null}</section>,
    "projects-by-status": <section className="panel report-chart"><PanelHeader title="Projects by status" subtitle={`${projects.length} records`} />{projectStatuses.length > 0 ? <ul className="bar-chart" aria-label="Project lifecycle statuses">{projectStatuses.map((item) => { const lifecycle = projectLifecycleFilter(item.status); const href = lifecycle && item.count > 0 ? operationsHref("Projects", { projectLifecycle: lifecycle }) : undefined; const label = displayStatus(item.status, "Unknown"); const focusId = href ? `report-project-${lifecycle}` : undefined; return <ReportBarRow key={item.status} label={label} measure={String(item.count)} width={Math.round((item.count / maximumProjectCount) * 100)} href={href} focusId={focusId} destinationFocusKey={href ? `project:${lifecycle}` : undefined} accessibleName={href ? `View ${label} projects — ${item.count} ${item.count === 1 ? "project" : "projects"}` : undefined} />; })}</ul> : state === "ready" ? <OperationsEmptyState variant="table">No project status data is available yet.</OperationsEmptyState> : null}</section>,
    "clients-by-industry": <section className="panel report-chart"><PanelHeader title="Clients by industry" subtitle={clientIndustryReport.subtitle} />{clientIndustryReport.rows.length > 0 ? <ul className="bar-chart" aria-label="Clients by industry">{clientIndustryReport.rows.map((item) => <ReportBarRow key={item.industry} label={item.industry} measure={String(item.count)} width={Math.round((item.count / maximumClientIndustryCount) * 100)} />)}</ul> : clientIndustryReport.emptyMessage ? <OperationsEmptyState variant="table">{clientIndustryReport.emptyMessage}</OperationsEmptyState> : null}</section>,
    "future-reports": <section className="client-directory-banner"><div className="directory-badge"><Activity size={20} /></div><div><strong>More reports will appear as additional workflows go live</strong><span>Margin, product mix, installation-cycle timing, customer reviews, and crew utilization require source records that are not available yet.</span></div></section>,
  } as const;

  return <PageLayoutEditor page="reports" layout={layout} isAdmin={isAdmin} enabled={layoutReady} loadError={layoutError} onRetry={onRetryLayout} onSave={onSaveLayout}>{({ layout: activeLayout, editing, editButton, editor, endDropZone, section }) => {
    const visibleKeys = activeLayout.order.filter((key) => !activeLayout.hidden.includes(key) && key in sectionNodes) as Array<keyof typeof sectionNodes>;
    const arrangedSpans = resolveArrangedSpans("reports", visibleKeys, activeLayout.fullWidth);
    const defaultSections = <>
      {sectionNodes["summary-metrics"]}
      {sectionNodes["business-kpis"]}
      <div className="reports-grid">{sectionNodes["pipeline-by-stage"]}{sectionNodes["projects-by-status"]}</div>
      {sectionNodes["clients-by-industry"]}
      {sectionNodes["future-reports"]}
    </>;
    const arrangedSections = <><div className="page-layout-grid page-layout-grid-reports">{arrangedSpans.map(({ key, size }) => <div className={size === "full" ? "page-layout-span-all" : "page-layout-item"} data-page-layout-section={key} data-page-layout-size={size} key={key}>{section(key, sectionNodes[key])}</div>)}</div>{endDropZone}</>;
    return <>
      <PageTitle eyebrow="Business performance" title="Reports" text="Current totals from saved leads, clients, projects, and meeting notes." state="Working" action={editButton} />
      {editor}
      {!editing && isDefaultPageLayout(activeLayout, "reports", isAdmin) ? defaultSections : arrangedSections}
    </>;
  }}</PageLayoutEditor>;
}

function SettingsView({ notify, section, onSection, onTimezoneChange, onCurrentUserSettingsLoaded, rules, projects, userName, userEmail, isAdmin, onGoogleSetup, onAddRule, onUpdateRule, onDeleteRule, sheetMirror, onSyncGoogleSheet, onImportConfirmed, syncingSheet }: { notify: Notify; section: SettingsSection; onSection: (section: SettingsSection) => void; onTimezoneChange: (timezone: string) => void; onCurrentUserSettingsLoaded: (data: CurrentUserSettingsPayload) => void; rules: FilingRuleDraft[]; projects: Project[]; userName: string; userEmail: string; isAdmin: boolean; onGoogleSetup: () => void; onAddRule: () => void; onUpdateRule: (rule: FilingRuleDraft, patch: Partial<Pick<FilingRuleDraft, "enabled" | "priority">>) => Promise<void>; onDeleteRule: (rule: FilingRuleDraft) => Promise<void>; sheetMirror: SheetMirrorStatus | null; onSyncGoogleSheet: () => Promise<void>; onImportConfirmed: () => Promise<void>; syncingSheet: boolean }) {
  const visibleSection: SettingsSection = isAdmin ? section : "My settings";
  const headingText = isAdmin && visibleSection !== "My settings"
    ? "Manage shared Workspace, company defaults, security, and launch-readiness settings."
    : "Manage the preferences tied to your signed-in FCI account.";
  return <><PageTitle eyebrow="Control center" title="Settings" text={headingText} state="In development" />
    <div className="settings-layout"><SettingsAudienceNavigation section={visibleSection} isAdmin={isAdmin} onSection={onSection} />
      {visibleSection === "My settings" && <MySettingsPanel notify={notify} userName={userName} userEmail={userEmail} isAdmin={isAdmin} onTimezoneChange={onTimezoneChange} onSettingsLoaded={onCurrentUserSettingsLoaded} />}
      {isAdmin && visibleSection === "Google Workspace" && <GoogleWorkspacePanel notify={notify} projects={projects} isAdmin={isAdmin} />}
      {isAdmin && visibleSection === "Calendar & appointments" && <WorkspaceDefaultsPanel mode="calendar" notify={notify} onGoogleSetup={onGoogleSetup} isAdmin={isAdmin} />}
      {isAdmin && visibleSection === "Inbox & file rules" && <InboxRulesPanel rules={rules} onAddRule={onAddRule} onUpdateRule={onUpdateRule} onDeleteRule={onDeleteRule} />}
      {isAdmin && visibleSection === "Client Directory" && <DirectorySyncPanel mirror={sheetMirror} syncing={syncingSheet} onSync={onSyncGoogleSheet} onImportConfirmed={onImportConfirmed} onConfigure={() => { onSection("Google Workspace"); notify("Open the Workspace checklist to connect Google Sheets", "info"); }} isAdmin={isAdmin} />}
      {isAdmin && visibleSection === "Workflow & notifications" && <WorkspaceDefaultsPanel mode="workflow" notify={notify} onGoogleSetup={onGoogleSetup} isAdmin={isAdmin} />}
      {isAdmin && visibleSection === "AI assistant" && <AiAssistantSettingsCard notify={notify} isAdmin={isAdmin} />}
      {isAdmin && visibleSection === "Data & security" && <DataSecurityPanel />}
      {isAdmin && visibleSection === "Testing & launch" && <TestingLaunchPanel onGoogleSetup={() => onSection("Google Workspace")} />}
    </div></>;
}

function LeadModal(props: LeadModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictVersion, setConflictVersion] = useState<string | null>(null);
  const [conflictValues, setConflictValues] = useState<LeadConflictValues>({});
  const editLead = props.mode === "edit" ? props.initialValues : null;
  // seed feeds defaultValues in BOTH modes: full row in edit, optional prefill in
  // create (the AI-10 (f) consumption path). Mode logic stays keyed on editLead.
  const seed: Partial<Lead> | null = props.mode === "edit" ? props.initialValues : props.initialValues ?? null;
  const inboxPrefill = props.mode === "create" && props.initialValues !== undefined;
  const sourceOptions = ["Website", "Referral", "Bid invite", "Repeat client"];
  if (seed?.source && !sourceOptions.includes(seed.source)) sourceOptions.push(seed.source);
  const stageOptions = [...leadStages];
  if (seed?.stage && !stageOptions.includes(seed.stage)) stageOptions.push(seed.stage);

  function savedValue(key: keyof LeadConflictValues) {
    if (!Object.hasOwn(conflictValues, key)) return null;
    const value = conflictValues[key];
    let displayValue: string;
    if (key === "estimatedValue") {
      displayValue = typeof value === "number" ? money(value) : "Not set";
    } else if (key === "nextActionAt") {
      displayValue = typeof value === "number"
        ? new Date(value).toLocaleString()
        : "Not set";
    } else if (key === "status") {
      displayValue = displayStatus(value, "Not set");
    } else if (key === "ownerEmail" && value === null) {
      displayValue = "Unavailable";
    } else {
      displayValue = value === null || value === "" ? "Not set" : String(value);
    }
    return <small className="project-edit-saved-value">Saved value: {displayValue}</small>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const company = String(form.get("company") ?? "").trim();
    const contactName = String(form.get("contact") ?? "").trim();
    const projectName = String(form.get("project") ?? "").trim();
    const source = String(form.get("source") ?? "").trim();
    const site = String(form.get("site") ?? "").trim();
    const estimatedValue = Number(form.get("value") ?? editLead?.estimatedValue ?? 0);
    const nextAction = String(form.get("notes") ?? "").trim();
    const contactEmailText = String(form.get("contactEmail") ?? "").trim().toLowerCase();
    const contactEmail = contactEmailText || null;
    const contactPhone = String(form.get("contactPhone") ?? "").trim() || null;
    const stage = String(form.get("stage") ?? "New inquiry").trim() || "New inquiry";
    const nextActionAtText = String(form.get("nextActionAt") ?? "");
    const nextActionAt = dateTimeIsoValue(nextActionAtText);
    const ownerEmail = String(form.get("ownerEmail") ?? "").trim().toLowerCase();
    const status = String(form.get("status") ?? "active").trim().toLowerCase();

    if (props.mode === "create") {
      setSaving(true);
      try {
        await props.onSave({
          id: "",
          number: "",
          company,
          contact: contactName,
          contactEmail,
          contactPhone,
          project: projectName,
          value: money(estimatedValue),
          estimatedValue,
          stage,
          source,
          next: nextAction,
          nextActionAt,
          ownerEmail: ownerEmail || null,
          site,
          status: "active",
          initials: recordInitials(company),
          color: "sage",
        });
      } finally {
        setSaving(false);
      }
      return;
    }

    const version = conflictVersion ?? props.initialValues.version;
    if (!version) {
      setError("Refresh live lead records before editing this lead.");
      return;
    }
    if (!ownerEmail && props.initialValues.ownerEmail) {
      setError("Lead owner email cannot be empty.");
      return;
    }
    const patch: LeadEditPatch = {};
    if (company !== props.initialValues.company) patch.company = company;
    if (contactName !== props.initialValues.contact) patch.contactName = contactName;
    if (contactEmail !== props.initialValues.contactEmail) patch.contactEmail = contactEmail;
    if (contactPhone !== props.initialValues.contactPhone) patch.contactPhone = contactPhone;
    if (projectName !== props.initialValues.project) patch.projectName = projectName;
    if (source !== props.initialValues.source) patch.source = source;
    if (stage !== props.initialValues.stage) patch.stage = stage;
    if (site !== props.initialValues.site) patch.site = site;
    if (props.isAdmin && estimatedValue !== props.initialValues.estimatedValue) {
      patch.estimatedValue = estimatedValue;
    }
    if (nextAction !== props.initialValues.next) patch.nextAction = nextAction;
    if (nextActionAtText !== dateTimeLocalInputValue(props.initialValues.nextActionAt)) {
      patch.nextActionAt = nextActionAt;
    }
    if (ownerEmail && ownerEmail !== props.initialValues.ownerEmail) patch.ownerEmail = ownerEmail;
    if (status !== props.initialValues.status.toLowerCase()) patch.status = status;
    if (Object.keys(patch).length === 0) {
      setError("Change at least one lead field before saving.");
      return;
    }

    setSaving(true);
    try {
      await props.onSave(patch, version);
      props.onClose();
    } catch (saveError) {
      if (saveError instanceof LeadEditConflictError) {
        setConflictVersion(saveError.currentVersion);
        setConflictValues(saveError.currentValues);
        setError("This lead changed while you were editing. Review your entries, then choose Re-apply changes.");
      } else {
        setError(saveError instanceof Error ? saveError.message : "Lead changes could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  const editMode = props.mode === "edit";
  const ariaLabel = editLead ? `Edit ${editLead.number}` : "Add a lead";
  return <AccessibleOverlay ariaLabel={ariaLabel} contentClassName="modal lead-edit-modal" onClose={props.onClose} busy={saving}>
    <header><div><p className="eyebrow">{editLead ? editLead.number : "New opportunity"}</p><h2>{editLead ? "Edit lead" : "Add a lead"}</h2></div><button type="button" onClick={props.onClose} aria-label={editLead ? "Close lead editor" : "Close"} disabled={saving}><X size={20} /></button></header>
    <form onSubmit={submit}>
      {error && <p className="project-operation-error" role="alert">{error}</p>}
      <label>Client company<input data-overlay-initial-focus name="company" required maxLength={180} placeholder="Business name" defaultValue={seed?.company ?? ""} disabled={saving} />{savedValue("company")}</label>
      <div className="form-row"><label>Primary contact<input name="contact" required maxLength={160} placeholder="Full name" defaultValue={seed?.contact ?? ""} disabled={saving} />{savedValue("contactName")}</label><label>Lead source<select name="source" defaultValue={seed?.source ?? "Website"} disabled={saving}>{sourceOptions.map((option) => <option key={option}>{option}</option>)}</select>{savedValue("source")}</label></div>
      {(editMode || inboxPrefill) && <div className="form-row"><label>Contact email <span className="optional-label">Optional</span><input name="contactEmail" type="email" maxLength={254} defaultValue={seed?.contactEmail ?? ""} disabled={saving} />{savedValue("contactEmail")}</label><label>Contact phone <span className="optional-label">Optional</span><input name="contactPhone" type="tel" maxLength={40} defaultValue={seed?.contactPhone ?? ""} disabled={saving} />{savedValue("contactPhone")}</label></div>}
      <label>Project / opportunity<input name="project" required maxLength={180} placeholder="Project name" defaultValue={seed?.project ?? ""} disabled={saving} />{savedValue("projectName")}</label>
      <div className="form-row modal-hint-form-row"><div className="modal-hinted-field"><div className="modal-hint-label-row"><label htmlFor="lead-estimated-value">Estimated value</label><WorkspaceInfoHint label="Lead value help" text={LEAD_ESTIMATED_VALUE_HINT} anchor="auto" /></div><input id="lead-estimated-value" name="value" type="number" min="0" max="2147483647" step="1" required placeholder="Estimated amount" defaultValue={seed?.estimatedValue ?? ""} disabled={saving || editMode && !props.isAdmin} aria-describedby={editMode && !props.isAdmin ? "lead-estimated-value-help" : undefined} />{inboxPrefill && seed?.estimatedValue === undefined && <small>Still needs typing before this lead can be added.</small>}{savedValue("estimatedValue")}</div><label>Project site<input name="site" required maxLength={300} placeholder="Address or city and state" defaultValue={seed?.site ?? ""} disabled={saving} />{inboxPrefill && !seed?.site && <small>Still needs typing before this lead can be added.</small>}{savedValue("site")}</label></div>
      {editMode && !props.isAdmin && <p id="lead-estimated-value-help" className="form-help"><ShieldCheck size={14} /> Estimated value is read-only here. An administrator can edit it.</p>}
      {(editMode || inboxPrefill) && <div className="form-row"><label>Stage<select name="stage" defaultValue={seed?.stage ?? "New inquiry"} disabled={saving}>{stageOptions.map((option) => <option key={option}>{option}</option>)}</select>{savedValue("stage")}</label>{editMode && <label>Lead status<select name="status" defaultValue={editLead?.status.toLowerCase()} disabled={saving}><option value="active">Active</option><option value="converted">Converted</option><option value="lost">Lost</option><option value="archived">Archived</option></select>{savedValue("status")}</label>}</div>}
      <label>Next action<textarea name="notes" required maxLength={500} placeholder="What needs to happen next?" defaultValue={seed?.next ?? ""} disabled={saving} />{savedValue("nextAction")}</label>
      {(editMode || inboxPrefill) && <div className="form-row"><label>Next action date <span className="optional-label">Optional</span><input name="nextActionAt" type="datetime-local" defaultValue={dateTimeLocalInputValue(seed?.nextActionAt ?? null)} disabled={saving} />{savedValue("nextActionAt")}</label><label>Lead owner email {editMode ? null : <span className="optional-label">Optional</span>}<input name="ownerEmail" type="email" maxLength={254} placeholder={editMode ? "Authorized office email" : "Signed-in user when left blank"} defaultValue={seed?.ownerEmail ?? ""} disabled={saving} />{savedValue("ownerEmail")}{editMode && editLead?.ownerEmail === null && <small>The saved owner is unavailable because it is not a current authorized office identity.</small>}</label></div>}
      {editMode && <p className="form-help"><ShieldCheck size={14} /> Saving appends before-and-after activity records. A newer saved version is never overwritten automatically.</p>}
      <footer><button type="button" className="soft-button" onClick={props.onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : editMode ? conflictVersion ? "Re-apply changes" : "Save changes" : "Add to pipeline"}</button></footer>
    </form>
  </AccessibleOverlay>;
}

function ClientModal({ onClose, onSave }: { onClose: () => void; onSave: (client: Client) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name"));
    const phone = String(form.get("phone") ?? "").trim() || null;
    try {
      await onSave({
        id: "",
        code: "",
        name,
        contact: String(form.get("contact")),
        contactPhone: phone,
        contactRole: String(form.get("role")),
        email: String(form.get("email")),
        industry: String(form.get("industry")),
        status: String(form.get("status")),
        initials: recordInitials(name),
        color: "sage",
        googleStatus: "Setup pending",
        jobSite: null,
      });
    } finally {
      setSaving(false);
    }
  }
  return <AccessibleOverlay ariaLabel="Add a client" contentClassName="modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">Client Directory</p><h2>Add a client</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}>
    <label>Client business name<input data-overlay-initial-focus name="name" required maxLength={180} placeholder="Business name" /></label>
    <div className="form-row"><label>Primary contact<input name="contact" required maxLength={180} placeholder="Full name" /></label><label>Work email<input name="email" type="email" maxLength={254} required placeholder="name@company.com" /></label></div>
    <div className="form-row"><label>Contact phone <span className="optional-label">Optional</span><input name="phone" type="tel" maxLength={80} placeholder="Phone number" /></label><label>Contact role<input name="role" required maxLength={120} defaultValue="Primary contact" /></label></div>
    <div className="form-row modal-hint-form-row"><label>Industry<select name="industry">{CLIENT_INDUSTRY_OPTIONS.map((industry) => <option value={industry} key={industry}>{industry}</option>)}</select></label><div className="modal-hinted-field"><div className="modal-hint-label-row"><label htmlFor="new-client-status">Client status</label><WorkspaceInfoHint label="Client lifecycle help" text={CLIENT_STATUS_HINT} anchor="right" /></div><select id="new-client-status" name="status" defaultValue="active">{CLIENT_STATUSES.map((status) => <option value={status} key={status}>{displayStatus(status, status)}</option>)}</select></div></div>
    <p className="form-help"><FolderTree size={14} /> The app saves the client and primary contact first, then syncs the Client Directory when Google Sheets is connected. The account folder is created with the first project workspace.</p>
    <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add client"}</button></footer>
  </form></AccessibleOverlay>;
}

function ClientEditModal({ client, onClose, onSave }: { client: Client; onClose: () => void; onSave: (patch: ClientEditPatch, version: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictVersion, setConflictVersion] = useState<string | null>(null);
  const [conflictValues, setConflictValues] = useState<ClientConflictValues>({});
  const industry = client.industryRaw ?? null;
  const industryOptions = industry && !(CLIENT_INDUSTRY_OPTIONS as readonly string[]).includes(industry)
    ? [industry, ...CLIENT_INDUSTRY_OPTIONS]
    : CLIENT_INDUSTRY_OPTIONS;

  function savedValue(key: keyof ClientConflictValues) {
    if (!Object.hasOwn(conflictValues, key)) return null;
    const value = conflictValues[key];
    const displayValue = key === "status"
      ? displayStatus(value, "Not set")
      : value === null || value === ""
        ? "Not set"
        : String(value);
    return <small className="project-edit-saved-value">Saved value: {displayValue}</small>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const version = conflictVersion ?? client.version;
    if (!version) {
      setError("Refresh live client records before editing this client.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const nextIndustry = String(form.get("industry") ?? "").trim() || null;
    const status = String(form.get("status") ?? "").trim().toLowerCase();
    const patch: ClientEditPatch = {};
    if (name !== client.name) patch.name = name;
    if (nextIndustry !== industry) patch.industry = nextIndustry;
    if (status !== client.status.toLowerCase()) patch.status = status;
    if (Object.keys(patch).length === 0) {
      setError("Change at least one client field before saving.");
      return;
    }
    setSaving(true);
    try {
      await onSave(patch, version);
      onClose();
    } catch (saveError) {
      if (saveError instanceof ClientEditConflictError) {
        setConflictVersion(saveError.currentVersion);
        setConflictValues(saveError.currentValues);
        setError("This client changed while you were editing. Review your entries, then choose Re-apply changes.");
      } else {
        setError(saveError instanceof Error ? saveError.message : "Client changes could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Edit ${client.code} client`} contentClassName="modal project-edit-modal client-edit-modal" onClose={onClose} busy={saving}>
    <header><div><p className="eyebrow">{client.code}</p><h2>Edit client</h2></div><button type="button" onClick={onClose} aria-label="Close client editor" disabled={saving}><X size={20} /></button></header>
    <form onSubmit={submit}>
      {error && <p className="project-operation-error" role="alert">{error}</p>}
      <label>Client business name<input data-overlay-initial-focus name="name" required maxLength={180} defaultValue={client.name} disabled={saving} />{savedValue("name")}</label>
      <div className="form-row"><label>Industry <span className="optional-label">Optional</span><select name="industry" defaultValue={industry ?? ""} disabled={saving}><option value="">Not set</option>{industryOptions.map((option) => <option value={option} key={option}>{option}</option>)}</select>{savedValue("industry")}</label><label>Client status<select name="status" defaultValue={client.status.toLowerCase()} disabled={saving}>{CLIENT_STATUSES.map((status) => <option value={status} key={status}>{displayStatus(status, status)}</option>)}</select>{savedValue("status")}</label></div>
      <p className="form-help"><ShieldCheck size={14} /> Saving appends one before-and-after activity record. A newer saved version is never overwritten automatically.</p>
      <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : conflictVersion ? "Re-apply changes" : "Save changes"}</button></footer>
    </form>
  </AccessibleOverlay>;
}

function ContactEditModal({ client, onClose, onSave }: { client: Client; onClose: () => void; onSave: (patch: ContactEditPatch, version: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictVersion, setConflictVersion] = useState<string | null>(null);
  const [conflictValues, setConflictValues] = useState<ContactConflictValues>({});

  function savedValue(key: keyof ContactConflictValues) {
    if (!Object.hasOwn(conflictValues, key)) return null;
    const value = conflictValues[key];
    return <small className="project-edit-saved-value">Saved value: {value === null || value === "" ? "Not set" : String(value)}</small>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const version = conflictVersion ?? client.contactVersion;
    if (!client.contactId || !version) {
      setError("Refresh live client records before editing this contact.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim() || null;
    const phone = String(form.get("phone") ?? "").trim() || null;
    const role = String(form.get("role") ?? "").trim();
    const patch: ContactEditPatch = {};
    if (name !== client.contact) patch.name = name;
    if (email !== (client.email || null)) patch.email = email;
    if (phone !== client.contactPhone) patch.phone = phone;
    if (role !== client.contactRole) patch.role = role;
    if (Object.keys(patch).length === 0) {
      setError("Change at least one contact field before saving.");
      return;
    }
    setSaving(true);
    try {
      await onSave(patch, version);
      onClose();
    } catch (saveError) {
      if (saveError instanceof ContactEditConflictError) {
        setConflictVersion(saveError.currentVersion);
        setConflictValues(saveError.currentValues);
        setError("This contact changed while you were editing. Review your entries, then choose Re-apply changes.");
      } else {
        setError(saveError instanceof Error ? saveError.message : "Contact changes could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Edit primary contact for ${client.code}`} contentClassName="modal project-edit-modal contact-edit-modal" onClose={onClose} busy={saving}>
    <header><div><p className="eyebrow">{client.code}</p><h2>Edit primary contact</h2></div><button type="button" onClick={onClose} aria-label="Close contact editor" disabled={saving}><X size={20} /></button></header>
    <form onSubmit={submit}>
      {error && <p className="project-operation-error" role="alert">{error}</p>}
      <label>Primary contact<input data-overlay-initial-focus name="name" required maxLength={180} defaultValue={client.contact} disabled={saving} />{savedValue("name")}</label>
      <div className="form-row"><label>Work email <span className="optional-label">Optional</span><input name="email" type="email" maxLength={254} defaultValue={client.email} disabled={saving} />{savedValue("email")}</label><label>Contact phone <span className="optional-label">Optional</span><input name="phone" type="tel" maxLength={80} defaultValue={client.contactPhone ?? ""} disabled={saving} />{savedValue("phone")}</label></div>
      <label>Contact role<input name="role" required maxLength={120} defaultValue={client.contactRole} disabled={saving} />{savedValue("role")}</label>
      <p className="form-help"><ShieldCheck size={14} /> Saving appends one before-and-after activity record. A newer saved version is never overwritten automatically.</p>
      <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : conflictVersion ? "Re-apply changes" : "Save changes"}</button></footer>
    </form>
  </AccessibleOverlay>;
}

function NewProjectModal({ clients, initialClientId, managerId, managerLabel, isAdmin, onClose, onSave }: { clients: Client[]; initialClientId: string | null; managerId: string; managerLabel: string; isAdmin: boolean; onClose: () => void; onSave: (project: Project) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); const clientId = String(form.get("clientId")); const client = clients.find((item) => item.id === clientId); if (!client) { setSaving(false); return; } const name = String(form.get("name")); const estimatedValue = form.get("value") ? Number(form.get("value")) : null; const flooringCategory = optionalFlooringCategory(form.get("flooringCategory")); const squareFeet = form.get("squareFeet") ? Number(form.get("squareFeet")) : null; const contractValue = isAdmin && form.get("contractValue") ? Number(form.get("contractValue")) : null; const segment = normalizeProjectSegment(form.get("segment")); const jobSite = normalizeJobSiteLocation({ address: form.get("site") }); try { await onSave({ id: "", clientId, number: "", client: client.name, name, status: String(form.get("status")), progress: 0, value: estimatedValue === null ? "TBD" : money(estimatedValue), estimatedValue, flooringCategory, squareFeet, contractValue, segment, installationStartedAt: null, installationCompletedAt: null, hadCallback: false, callbackNote: null, site: jobSite?.address ?? "Site pending", jobSite, managerId, lead: projectManagerLabel(managerId, managerId, managerLabel), date: "Not scheduled", accent: client.color }); } finally { setSaving(false); } }
  const selectedClientId = initialClientId && clients.some((client) => client.id === initialClientId) ? initialClientId : clients[0]?.id ?? "";
  return <AccessibleOverlay ariaLabel="Create a project" contentClassName="modal" onClose={onClose} busy={saving}>
    <header><div><p className="eyebrow">Independent project</p><h2>Create a project</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header>
    <form onSubmit={submit}>
      <label>Client<select data-overlay-initial-focus name="clientId" required defaultValue={selectedClientId} disabled={clients.length === 0}>{clients.length === 0 && <option value="">Create a client first</option>}{clients.map((client) => <option value={client.id} key={client.id}>{client.name} · {client.code}</option>)}</select></label>
      <label>Project name<input name="name" required placeholder="Project name" /></label>
      <div className="form-row"><label>Site<input name="site" required placeholder="Address or city and state" /></label><div className="assigned-manager-field" aria-label={`Project manager: ${managerLabel}, signed-in account`}><span>Project manager</span><strong>{managerLabel}</strong><small>{managerId} · signed-in account</small></div></div>
      <div className="form-row">
        <div className="modal-hinted-field"><div className="modal-hint-label-row"><label htmlFor="new-project-status">Status</label><WorkspaceInfoHint label="Project phase help" text={PROJECT_STATUS_HINT} anchor="auto" /></div><select id="new-project-status" name="status"><option>Planning</option><option>Mobilizing</option><option>Installation</option><option>Closeout</option></select></div>
        <div className="modal-hinted-field"><div className="modal-hint-label-row"><label htmlFor="new-project-estimated-value">Estimated value <span className="optional-label">Optional</span></label><WorkspaceInfoHint label="Project value help" text={PROJECT_ESTIMATED_VALUE_HINT} anchor="right" /></div><input id="new-project-estimated-value" name="value" type="number" min="0" step="1" inputMode="numeric" placeholder="Estimated amount" /></div>
      </div>
      <ProjectSegmentSelector />
      <div className="form-row modal-hint-form-row">
        <div className="modal-hinted-field"><div className="modal-hint-label-row"><label htmlFor="new-project-flooring-category">Flooring category <span className="optional-label">Optional</span></label><WorkspaceInfoHint label="Flooring selection help" text={PROJECT_FLOORING_CATEGORY_HINT} anchor="auto" /></div><select id="new-project-flooring-category" name="flooringCategory" defaultValue=""><option value="">Not yet captured</option>{FLOORING_CATEGORIES.map((category) => <option key={category} value={category}>{displayStatus(category, category)}</option>)}</select></div>
        <label>Square feet <span className="optional-label">Optional</span><input name="squareFeet" type="number" min="1" step="1" inputMode="numeric" placeholder="Project square footage" /></label>
      </div>
      <label>Contract value <span className="optional-label">Optional</span><input name="contractValue" type="number" min="0" step="1" inputMode="numeric" placeholder={isAdmin ? "Sold price at booking" : FINANCIAL_RESTRICTION_LABEL} disabled={!isAdmin} aria-describedby="contract-value-help" /></label>
      <p id="contract-value-help" className="form-help"><ShieldCheck size={14} /> {isAdmin ? "Contract value is a financial field visible to administrators." : "An administrator can record the sold price at booking."}</p>
      <p className="form-help"><ShieldCheck size={14} /> The project is assigned to your authorized signed-in account. An administrator can correct an unassigned legacy project from its project drawer.</p>
      <p className="form-help"><FolderTree size={14} /> This creates an independent project number and Project Register row. Create its Drive folder from the project after saving.</p>
      <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving || clients.length === 0}>{saving ? "Creating…" : clients.length === 0 ? "Add a client first" : "Create project"}</button></footer>
    </form>
  </AccessibleOverlay>;
}

function LeadDrawer({ lead, isAdmin, onClose, onAdvance, onSaveLead, returnFocusRef, fallbackFocusRef }: { lead: Lead; isAdmin: boolean; onClose: () => void; onAdvance: (id: string) => Promise<void>; onSaveLead: (lead: Lead, patch: LeadEditPatch, version: string) => Promise<void>; returnFocusRef?: RefObject<HTMLElement | null>; fallbackFocusRef?: RefObject<HTMLElement | null> }) {
  const [advancing, setAdvancing] = useState(false);
  const [editing, setEditing] = useState(false);
  const currentIndex = leadStages.findIndex((stage) => stage.toLowerCase() === lead.stage.toLowerCase());
  const canAdvance = lead.status.toLowerCase() === "active" && currentIndex >= 0 && currentIndex < leadStages.length - 1;

  async function handleAdvance() {
    setAdvancing(true);
    try {
      await onAdvance(lead.id);
    } finally {
      setAdvancing(false);
    }
  }

  return <><AccessibleOverlay variant="drawer" ariaLabel={`${lead.number} ${lead.company}`} contentClassName="project-drawer lead-drawer" onClose={onClose} busy={advancing} returnFocusRef={returnFocusRef} fallbackFocusRef={fallbackFocusRef}>
    <header><button data-overlay-initial-focus onClick={onClose} aria-label="Close lead details" disabled={advancing}><X size={20} /></button><Status text={lead.stage} /><span>{lead.number}</span></header>
    <div className="drawer-title"><p>Lead opportunity</p><h2>{lead.company}</h2><div><span><BriefcaseBusiness size={14} />{lead.project}</span><span><MapPin size={14} />{lead.site}</span></div></div>
    <div className="drawer-body">
      <div className="drawer-stats"><div><span>Estimated value</span><strong>{lead.value}</strong></div><div><span>Stage</span><strong>{lead.stage}</strong></div><div><span>Primary contact</span><strong>{lead.contact}</strong></div><div><span>Lead source</span><strong>{lead.source}</strong></div></div>
      <section className="lead-next-action"><h3>Next action</h3><p><Clock3 size={15} />{lead.next}</p></section>
      <section className="lead-record-note"><ShieldCheck size={16} /><p>Edit saved lead details here. Advance stage remains a separate deliberate action and can be undone from the confirmation message.</p></section>
    </div>
    <footer><button type="button" className="soft-button" onClick={() => setEditing(true)} disabled={advancing}><Settings size={16} /> Edit lead</button><button type="button" className="soft-button" onClick={onClose} disabled={advancing}>Close</button>{canAdvance && <button type="button" className="primary-button" onClick={() => void handleAdvance()} disabled={advancing}>{advancing ? "Advancing…" : <><span>Advance stage</span><ChevronRight size={16} /></>}</button>}</footer>
  </AccessibleOverlay>
    {editing && <LeadModal mode="edit" initialValues={lead} isAdmin={isAdmin} onClose={() => setEditing(false)} onSave={(patch, version) => onSaveLead(lead, patch, version)} />}
  </>;
}

function ProjectDrawer({ project, clients, jobSiteMaps, onClose, notify, onSaveProject, onProvisionDrive, onAssignToMe, onRecordInstallationDates, onRecordFollowUpResult, onMeetingRecorded, isAdmin, currentUserEmail, returnFocusRef }: { project: Project; clients: Client[]; jobSiteMaps: JobSiteMapsRuntimeConfig; onClose: () => void; notify: Notify; onSaveProject: (project: Project, patch: ProjectEditPatch, version: string) => Promise<void>; onProvisionDrive: (project: Project) => Promise<void>; onAssignToMe: (project: Project) => Promise<void>; onRecordInstallationDates: (project: Project, installationStartedAt: number, installationCompletedAt: number) => Promise<void>; onRecordFollowUpResult: (project: Project, hadCallback: boolean, callbackNote: string | null) => Promise<void>; onMeetingRecorded: () => void; isAdmin: boolean; currentUserEmail: string; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const [tab, setTab] = useState<"Overview" | "Files" | "Meetings">("Overview");
  const [editing, setEditing] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [assigningManager, setAssigningManager] = useState(false);
  const [installationDatesOpen, setInstallationDatesOpen] = useState(false);
  const [followUpResultOpen, setFollowUpResultOpen] = useState(false);
  const projectFilesTriggerRef = useRef<HTMLButtonElement>(null);
  const projectFiles = useProjectFilesController(project.id, project.driveFolderId);
  const busy = provisioning || assigningManager;

  async function handleDrive() {
    if (project.driveUrl) {
      window.open(project.driveUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setProvisioning(true);
    await onProvisionDrive(project);
    setProvisioning(false);
  }

  async function handleAssignToMe() {
    setAssigningManager(true);
    try {
      await onAssignToMe(project);
    } finally {
      setAssigningManager(false);
    }
  }

  return <><AccessibleOverlay variant="drawer" ariaLabel={`${project.number} ${project.name}`} contentClassName="project-drawer" onClose={onClose} busy={busy} returnFocusRef={returnFocusRef}>
      <header><button data-overlay-initial-focus onClick={onClose} aria-label="Close project" disabled={busy}><X size={20} /></button><Status text={project.status} /><span>{project.number}</span></header>
      <div className="drawer-title"><p>{project.client}</p><h2>{project.name}</h2><div><span><MapPin size={14} />{project.site}</span><span><CalendarDays size={14} />{project.date}</span></div></div>
      <nav aria-label="Available project views">{(["Overview", "Files", "Meetings"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
      <div className="drawer-body" tabIndex={0} aria-label="Project details">
        {tab === "Overview" ? <>
          <section className="project-health"><div><span>Delivery progress</span><strong>Not tracked yet</strong></div><p><CheckCircle2 size={15} /> This live project is managed independently from other client work</p></section>
          <JobSiteMapCard location={project.jobSite} runtime={jobSiteMaps} contextLabel={`${project.number} ${project.name}`} />
          <div className="drawer-stats"><div><span>Estimated value</span><strong>{project.value}</strong></div><div><span>Contract value</span><strong>{!isAdmin ? FINANCIAL_RESTRICTION_LABEL : project.contractValue === null ? "Not yet captured" : money(project.contractValue)}</strong></div><div><span>Segment</span><strong>{displayStatus(project.segment ?? "commercial", "Commercial")}</strong></div><div><span>Flooring category</span><strong>{project.flooringCategory === null ? "Not yet captured" : displayStatus(project.flooringCategory, project.flooringCategory)}</strong></div><div><span>Square feet</span><strong>{project.squareFeet === null ? "Not yet captured" : new Intl.NumberFormat("en-US").format(project.squareFeet)}</strong></div><div><span>Installation started</span><strong>{formatProjectOperationDate(project.installationStartedAt)}</strong></div><div><span>Installation completed</span><strong>{formatProjectOperationDate(project.installationCompletedAt)}</strong></div><div><span>Post-installation callback</span><strong>{project.hadCallback ? "Yes recorded" : "No recorded callback"}</strong>{project.callbackNote ? <small>{project.callbackNote}</small> : !project.hadCallback && <small>Default No can include an uncaptured legacy result.</small>}</div><div className="project-manager-stat"><span>Project manager</span><strong>{project.lead}</strong>{project.managerId === currentUserEmail ? <small>Assigned to your signed-in account</small> : isAdmin ? <button className="manager-assignment-button" onClick={() => void handleAssignToMe()} disabled={assigningManager}>{assigningManager ? "Assigning…" : "Assign to me"}</button> : project.managerId ? <small>Authorized office account</small> : <small>No authorized manager is assigned</small>}</div><div><span>Drive folder</span><strong>{project.driveFolderId ? "Ready" : "Setup required"}</strong></div></div>
          <section className="project-operation-actions"><header><h3>Installation &amp; follow-up</h3><p>{isAdmin ? "Record the dates and callback outcome used by flooring KPI reporting." : "Only an administrator can record installation dates and callback results."}</p></header>{isAdmin && <div><button type="button" className="soft-button" onClick={() => setInstallationDatesOpen(true)}><CalendarDays size={16} /> Record installation dates</button><button type="button" className="soft-button" onClick={() => setFollowUpResultOpen(true)}><MessageSquareText size={16} /> Record follow-up result</button></div>}</section>
          <section className="project-capability-plan"><header><div><h3>Planned project capabilities</h3><p>These items are informational and are not available as controls yet.</p></div><FeatureStateBadge state="Planned" /></header><ul><li>Durable tasks and scheduled reminders</li><li>Indexed project files beyond the working Drive folder link</li><li>Crews, shifts, and field schedule</li><li>Project activity feed and outbound updates</li></ul></section>
        </> : tab === "Files"
          ? <ProjectFilesPanel controller={projectFiles} newDocumentTriggerRef={projectFilesTriggerRef} />
          : <ProjectMeetings project={project} notify={notify} onMeetingRecorded={onMeetingRecorded} />}
      </div>
      <footer>
        <button className="soft-button" type="button" onClick={() => setEditing(true)} disabled={busy}><Settings size={16} /> Edit project</button>
        <button className="soft-button" onClick={handleDrive} disabled={busy}><FolderOpen size={16} /> {provisioning ? "Creating folder…" : project.driveUrl ? "Open Drive folder" : "Create Drive folder"}</button>
      </footer>
  </AccessibleOverlay>
    {editing && <ProjectEditModal project={project} clients={clients} isAdmin={isAdmin} onClose={() => setEditing(false)} onSave={(patch, version) => onSaveProject(project, patch, version)} />}
    {installationDatesOpen && <InstallationDatesModal project={project} onClose={() => setInstallationDatesOpen(false)} onSave={(installationStartedAt, installationCompletedAt) => onRecordInstallationDates(project, installationStartedAt, installationCompletedAt)} />}
    {followUpResultOpen && <FollowUpResultModal project={project} onClose={() => setFollowUpResultOpen(false)} onSave={(hadCallback, callbackNote) => onRecordFollowUpResult(project, hadCallback, callbackNote)} />}
    {projectFiles.modalOpen && projectFiles.catalogState.status === "ready" && projectFiles.catalogState.catalog.provisioned && <ProjectFileCreationModal catalog={projectFiles.catalogState.catalog} controller={projectFiles} projectId={project.id} projectNumber={project.number} returnFocusRef={projectFilesTriggerRef} />}
  </>;
}

function ProjectEditModal({ project, clients, isAdmin, onClose, onSave }: { project: Project; clients: Client[]; isAdmin: boolean; onClose: () => void; onSave: (patch: ProjectEditPatch, version: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictVersion, setConflictVersion] = useState<string | null>(null);
  const [conflictValues, setConflictValues] = useState<ProjectConflictValues>({});
  const site = project.site === "Site pending" ? null : project.site;

  function savedValue(key: keyof ProjectConflictValues) {
    if (!Object.hasOwn(conflictValues, key)) return null;
    const value = conflictValues[key];
    let displayValue: string;
    if (key === "clientId") {
      const client = clients.find((item) => item.id === value);
      displayValue = client ? `${client.name} · ${client.code}` : String(value);
    } else if (key === "estimatedValue" || key === "contractValue") {
      displayValue = typeof value === "number" ? money(value) : "Not set";
    } else if (key === "squareFeet") {
      displayValue = typeof value === "number"
        ? new Intl.NumberFormat("en-US").format(value)
        : "Not set";
    } else if (key === "segment") {
      displayValue = value === null
        ? "Derived from client industry"
        : displayStatus(String(value), String(value));
    } else if (key === "flooringCategory") {
      displayValue = value === null
        ? "Not yet captured"
        : displayStatus(String(value), String(value));
    } else if (key === "status") {
      displayValue = displayStatus(String(value), String(value));
    } else {
      displayValue = value === null || value === "" ? "Not set" : String(value);
    }
    return <small className="project-edit-saved-value">Saved value: {displayValue}</small>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const version = conflictVersion ?? project.version;
    if (!version) {
      setError("Refresh live project records before editing this project.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const clientId = String(form.get("clientId") ?? "").trim();
    const nextSite = String(form.get("site") ?? "").trim() || null;
    const flooringCategory = optionalFlooringCategory(form.get("flooringCategory"));
    const squareFeetText = String(form.get("squareFeet") ?? "").trim();
    const squareFeet = squareFeetText ? Number(squareFeetText) : null;
    const segment = normalizeProjectSegment(form.get("segment"));
    const patch: ProjectEditPatch = {};

    if (name !== project.name) patch.name = name;
    if (clientId !== project.clientId) patch.clientId = clientId;
    if (nextSite !== site) patch.site = nextSite;
    if (flooringCategory !== project.flooringCategory) patch.flooringCategory = flooringCategory;
    if (squareFeet !== project.squareFeet) patch.squareFeet = squareFeet;
    if (segment !== project.segment) patch.segment = segment;

    if (isAdmin) {
      const status = String(form.get("status") ?? "").trim().toLowerCase();
      const estimatedValueText = String(form.get("estimatedValue") ?? "").trim();
      const estimatedValue = estimatedValueText ? Number(estimatedValueText) : null;
      const contractValueText = String(form.get("contractValue") ?? "").trim();
      const contractValue = contractValueText ? Number(contractValueText) : null;
      if (status !== project.status.toLowerCase()) patch.status = status;
      if (estimatedValue !== project.estimatedValue) patch.estimatedValue = estimatedValue;
      if (contractValue !== project.contractValue) patch.contractValue = contractValue;
    }

    if (Object.keys(patch).length === 0) {
      setError("Change at least one project field before saving.");
      return;
    }
    setSaving(true);
    try {
      await onSave(patch, version);
      onClose();
    } catch (saveError) {
      if (saveError instanceof ProjectEditConflictError) {
        setConflictVersion(saveError.currentVersion);
        setConflictValues(saveError.currentValues);
        setError("This project changed while you were editing. Review your entries, then choose Re-apply changes.");
      } else {
        setError(saveError instanceof Error ? saveError.message : "Project changes could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Edit ${project.number}`} contentClassName="modal project-edit-modal" onClose={onClose} busy={saving}>
    <header><div><p className="eyebrow">{project.number}</p><h2>Edit project</h2></div><button type="button" onClick={onClose} aria-label="Close project editor" disabled={saving}><X size={20} /></button></header>
    <form onSubmit={submit}>
      {error && <p className="project-operation-error" role="alert">{error}</p>}
      <label>Client<select data-overlay-initial-focus name="clientId" defaultValue={project.clientId} required disabled={saving}>{clients.map((client) => <option value={client.id} key={client.id}>{client.name} · {client.code}</option>)}</select>{savedValue("clientId")}</label>
      <label>Project name<input name="name" required maxLength={180} defaultValue={project.name} disabled={saving} />{savedValue("name")}</label>
      <label>Site <span className="optional-label">Optional</span><input name="site" defaultValue={site ?? ""} placeholder="Address or city and state" disabled={saving} />{savedValue("site")}</label>
      {isAdmin ? <div className="form-row"><label>Status<select name="status" defaultValue={project.status.toLowerCase()} disabled={saving}>{PROJECT_STATUSES.map((status) => <option value={status} key={status}>{displayStatus(status, status)}</option>)}</select>{savedValue("status")}</label><label>Estimated value <span className="optional-label">Optional</span><input name="estimatedValue" type="number" min="0" step="1" inputMode="numeric" defaultValue={project.estimatedValue ?? ""} disabled={saving} />{savedValue("estimatedValue")}</label></div> : <><div className="drawer-stats" aria-label="Admin-only project fields"><div><span>Status</span><strong>{project.status}</strong></div><div><span>Estimated value</span><strong>{project.value}</strong></div><div><span>Contract value</span><strong>{FINANCIAL_RESTRICTION_LABEL}</strong></div></div><p className="form-help"><ShieldCheck size={14} /> Status and financial fields are read-only here. An admin can edit them.</p></>}
      <div className="form-row"><label>Flooring category <span className="optional-label">Optional</span><select name="flooringCategory" defaultValue={project.flooringCategory ?? ""} disabled={saving}><option value="">Not yet captured</option>{FLOORING_CATEGORIES.map((category) => <option key={category} value={category}>{displayStatus(category, category)}</option>)}</select>{savedValue("flooringCategory")}</label><label>Square feet <span className="optional-label">Optional</span><input name="squareFeet" type="number" min="1" step="1" inputMode="numeric" defaultValue={project.squareFeet ?? ""} disabled={saving} />{savedValue("squareFeet")}</label></div>
      <label>Project segment <span className="optional-label">Optional</span><select name="segment" defaultValue={project.segment ?? ""} disabled={saving}><option value="">Derived from client industry</option><option value="commercial">Commercial</option><option value="residential">Residential</option></select>{savedValue("segment")}</label>
      {isAdmin && <label>Contract value <span className="optional-label">Optional</span><input name="contractValue" type="number" min="0" step="1" inputMode="numeric" defaultValue={project.contractValue ?? ""} disabled={saving} />{savedValue("contractValue")}</label>}
      <p className="form-help"><ShieldCheck size={14} /> Saving appends one before-and-after activity record. A newer saved version is never overwritten automatically.</p>
      <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : conflictVersion ? "Re-apply changes" : "Save changes"}</button></footer>
    </form>
  </AccessibleOverlay>;
}

function InstallationDatesModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (installationStartedAt: number, installationCompletedAt: number) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const installationStartedAt = projectOperationTimestampFromDateInput(String(form.get("installationStartedAt") ?? ""));
    const installationCompletedAt = projectOperationTimestampFromDateInput(String(form.get("installationCompletedAt") ?? ""));
    if (installationStartedAt === null || installationCompletedAt === null) {
      setError("Enter valid installation start and completion dates.");
      return;
    }
    if (installationCompletedAt < installationStartedAt) {
      setError("Installation completion must be on or after installation start.");
      return;
    }
    setSaving(true);
    try {
      await onSave(installationStartedAt, installationCompletedAt);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Installation dates could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Record installation dates for ${project.number}`} contentClassName="modal project-operation-modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">{project.number}</p><h2>Record installation dates</h2></div><button type="button" onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}>{error && <p className="project-operation-error" role="alert">{error}</p>}<div className="form-row"><label>Installation started<input data-overlay-initial-focus name="installationStartedAt" type="date" defaultValue={projectOperationDateInputValue(project.installationStartedAt)} required disabled={saving} /></label><label>Installation completed<input name="installationCompletedAt" type="date" defaultValue={projectOperationDateInputValue(project.installationCompletedAt)} required disabled={saving} /></label></div><p className="form-help"><ShieldCheck size={14} /> These dates feed install-cycle and completed-job reporting. Saving appends an activity event.</p><footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Record installation dates"}</button></footer></form></AccessibleOverlay>;
}

function FollowUpResultModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (hadCallback: boolean, callbackNote: string | null) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const callbackNote = String(form.get("callbackNote") ?? "").trim();
    setSaving(true);
    try {
      await onSave(form.get("hadCallback") === "yes", callbackNote || null);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The follow-up result could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Record follow-up result for ${project.number}`} contentClassName="modal project-operation-modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">{project.number}</p><h2>Record follow-up result</h2></div><button type="button" onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}>{error && <p className="project-operation-error" role="alert">{error}</p>}<label>Post-installation callback<select data-overlay-initial-focus name="hadCallback" defaultValue={project.hadCallback ? "yes" : "no"} disabled={saving}><option value="yes">Yes</option><option value="no">No</option></select></label><label>Callback note <span className="optional-label">Optional</span><textarea name="callbackNote" defaultValue={project.callbackNote ?? ""} maxLength={CALLBACK_NOTE_MAX_LENGTH} placeholder="Record a concise result or issue" disabled={saving} /></label><p className="form-help"><ShieldCheck size={14} /> Callback notes are limited to {CALLBACK_NOTE_MAX_LENGTH.toLocaleString()} characters. Saving appends an activity event.</p><footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Record follow-up result"}</button></footer></form></AccessibleOverlay>;
}

function meetingDateInputValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatMeetingDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function compareProjectMeetingsDescending(left: ProjectMeeting, right: ProjectMeeting) {
  const leftMeetingAt = Date.parse(left.meetingAt);
  const rightMeetingAt = Date.parse(right.meetingAt);
  const leftSortValue = Number.isNaN(leftMeetingAt) ? Number.NEGATIVE_INFINITY : leftMeetingAt;
  const rightSortValue = Number.isNaN(rightMeetingAt) ? Number.NEGATIVE_INFINITY : rightMeetingAt;
  if (leftSortValue !== rightSortValue) return rightSortValue - leftSortValue;
  return right.createdAt - left.createdAt;
}

async function fetchProjectMeetings(projectId: string) {
  const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/meetings`);
  const data = await response.json().catch(() => ({})) as { meetings?: ProjectMeeting[]; error?: string };
  if (!response.ok) throw new Error(data.error ?? "Meeting notes could not be loaded.");
  return data.meetings ?? [];
}

function ProjectMeetings({ project, notify, onMeetingRecorded }: { project: Project; notify: Notify; onMeetingRecorded: () => void }) {
  const [meetings, setMeetings] = useState<ProjectMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setMeetings(await fetchProjectMeetings(project.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Meeting notes could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    let active = true;
    fetchProjectMeetings(project.id).then((items) => {
      if (!active) return;
      setMeetings(items);
      setLoading(false);
    }).catch((loadError) => {
      if (!active) return;
      setError(loadError instanceof Error ? loadError.message : "Meeting notes could not be loaded.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [project.id]);

  function savedMeeting(meeting: ProjectMeeting) {
    setMeetings((current) => [
      meeting,
      ...current.filter((currentMeeting) => currentMeeting.id !== meeting.id),
    ].sort(compareProjectMeetingsDescending));
    setAdding(false);
    onMeetingRecorded();
    notify(`${meeting.title} saved to ${project.number}`, "success");
  }

  return <section className="project-meetings">
    <header className="meeting-section-header"><div><p className="eyebrow">Project knowledge</p><h3>Meeting notes</h3><span>Link Otter, paste its summary or transcript, and keep decisions with this independent project.</span></div><button className="primary-button" onClick={() => setAdding(true)}><Plus size={15} /> Add meeting</button></header>
    <div className="meeting-capture-guide"><MessageSquareText size={18} /><div><strong>Recommended Otter workflow</strong><span>Copy the private Otter conversation link, paste the Summary and Action Items, then add the exported transcript when the record needs full searchable detail.</span></div></div>
    {loading ? <OperationsEmptyState variant="meeting"><RefreshCw size={21} /><strong>Loading project meetings…</strong></OperationsEmptyState> : error ? <OperationsEmptyState variant="meeting" tone="error"><CircleAlert size={21} /><strong>{error}</strong><button className="soft-button" onClick={() => void loadMeetings()}>Try again</button></OperationsEmptyState> : meetings.length === 0 ? <OperationsEmptyState variant="meeting"><MessageSquareText size={24} /><strong>No meeting notes yet</strong><span>Add a client meeting, site walk, internal huddle, pre-install meeting, or closeout review.</span><button className="soft-button" onClick={() => setAdding(true)}><Plus size={14} /> Capture the first meeting</button></OperationsEmptyState> : <div className="meeting-list">{meetings.map((meeting) => <article className="meeting-card" key={meeting.id}>
      <header><div className="meeting-icon"><MessageSquareText size={17} /></div><div><div className="meeting-badges"><span>{meeting.meetingType.replaceAll("-", " ")}</span><b className={meeting.sourceProvider}>{meeting.sourceProvider === "otter" ? "Otter" : meeting.sourceProvider === "link" ? "Linked" : "Manual"}</b></div><h4>{meeting.title}</h4><small>{formatMeetingDate(meeting.meetingAt)} · Saved by {meeting.createdBy}</small></div>{meeting.sourceUrl && <a className="meeting-source-link" href={meeting.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open source</a>}</header>
      {meeting.attendees.length > 0 && <p className="meeting-attendees"><Users size={14} /><span>{meeting.attendees.join(" · ")}</span></p>}
      {meeting.summary && <div className="meeting-summary"><strong>Summary</strong><p>{meeting.summary}</p></div>}
      {meeting.decisions && <div className="meeting-decisions"><strong>Decisions</strong><p>{meeting.decisions}</p></div>}
      {meeting.actionItems.length > 0 && <div className="meeting-actions"><strong>Action items</strong><ul>{meeting.actionItems.map((item, index) => <li key={`${meeting.id}-${index}`}><Check size={13} />{item}</li>)}</ul></div>}
      {(meeting.notes || meeting.transcript) && <details><summary>View {meeting.transcript ? "notes and transcript" : "full notes"}</summary>{meeting.notes && <div><strong>Notes</strong><p>{meeting.notes}</p></div>}{meeting.transcript && <div><strong>Transcript</strong><pre>{meeting.transcript}</pre></div>}</details>}
    </article>)}</div>}
    {adding && <MeetingModal project={project} onClose={() => setAdding(false)} onSaved={savedMeeting} />}
  </section>;
}

function MeetingModal({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: (meeting: ProjectMeeting) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const meetingAtInput = String(form.get("meetingAt") ?? "");
    const meetingAtDate = new Date(meetingAtInput);
    if (Number.isNaN(meetingAtDate.getTime())) {
      setError("Choose a valid meeting date and time.");
      setSaving(false);
      return;
    }
    const payload = {
      title: String(form.get("title") ?? ""),
      meetingAt: meetingAtDate.toISOString(),
      meetingType: String(form.get("meetingType") ?? "other"),
      sourceUrl: String(form.get("sourceUrl") ?? ""),
      attendees: String(form.get("attendees") ?? ""),
      summary: String(form.get("summary") ?? ""),
      decisions: String(form.get("decisions") ?? ""),
      actionItems: String(form.get("actionItems") ?? ""),
      notes: String(form.get("notes") ?? ""),
      transcript: String(form.get("transcript") ?? ""),
    };
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(project.id)}/meetings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({})) as { meeting?: ProjectMeeting; error?: string };
      if (!response.ok || !data.meeting) throw new Error(data.error ?? "Meeting notes could not be saved.");
      onSaved(data.meeting);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Meeting notes could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Capture meeting notes for ${project.number}`} contentClassName="modal meeting-modal" backdropClassName="meeting-modal-backdrop" onClose={onClose} busy={saving}><header><div><p className="eyebrow">{project.number} · Project meeting</p><h2>Capture meeting notes</h2></div><button onClick={onClose} aria-label="Close meeting form" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}>
    <label>Meeting title<input data-overlay-initial-focus name="title" required maxLength={160} placeholder="e.g. Client scope review" /></label>
    <div className="form-row"><label>Date and time<input name="meetingAt" type="datetime-local" required defaultValue={meetingDateInputValue()} /></label><label>Meeting type<select name="meetingType" defaultValue="client"><option value="client">Client meeting</option><option value="site-walk">Site walk</option><option value="internal">Internal huddle</option><option value="pre-install">Pre-install meeting</option><option value="closeout">Closeout review</option><option value="phone-call">Phone call</option><option value="other">Other</option></select></label></div>
    <label>Otter conversation link or other source<input name="sourceUrl" type="url" inputMode="url" placeholder="https://otter.ai/u/..." /></label>
    <p className="form-help"><ShieldCheck size={14} /> Keep the Otter link restricted to approved people. The app stores the reference; it does not change Otter sharing permissions.</p>
    <label>Attendees<textarea name="attendees" className="meeting-short-textarea" placeholder="One name or email per line" /></label>
    <label>Summary<textarea name="summary" className="meeting-medium-textarea" placeholder="Paste Otter’s Overview or write a concise summary" /></label>
    <div className="form-row"><label>Decisions<textarea name="decisions" className="meeting-medium-textarea" placeholder="What was approved or decided?" /></label><label>Action items<textarea name="actionItems" className="meeting-medium-textarea" placeholder="One follow-up per line" /></label></div>
    <label>Meeting notes<textarea name="notes" className="meeting-medium-textarea" placeholder="Observations, measurements, client preferences, risks, and context" /></label>
    <label>Transcript or exported Otter text<textarea name="transcript" className="meeting-transcript-textarea" placeholder="Optional: paste the full transcript for later project search and AI questions" /></label>
    {error && <p className="workspace-missing" role="alert">{error}</p>}
    <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving meeting…" : "Save meeting"}</button></footer>
  </form></AccessibleOverlay>;
}

function ClientDrawer({ client, projects, jobSiteMaps, onClose, onSaveClient, onSaveContact, onNewProject, onProject, returnFocusRef }: { client: Client; projects: Project[]; jobSiteMaps: JobSiteMapsRuntimeConfig; onClose: () => void; onSaveClient: (client: Client, patch: ClientEditPatch, version: string) => Promise<void>; onSaveContact: (client: Client, patch: ContactEditPatch, version: string) => Promise<void>; onNewProject: () => void; onProject: (project: Project) => void; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const [editingClient, setEditingClient] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const contactEditable = Boolean(client.contactId && client.contactVersion);
  return <><AccessibleOverlay variant="drawer" ariaLabel={`${client.name} client account`} contentClassName="project-drawer client-drawer" onClose={onClose} returnFocusRef={returnFocusRef}>
    <header><button data-overlay-initial-focus onClick={onClose} aria-label="Close client"><X size={20} /></button><Status text={client.status} /><span>{client.code}</span></header>
    <div className="drawer-title"><p>Client account</p><h2>{client.name}</h2><div><span><ContactRound size={14} />{client.contact}</span><span><Mail size={14} />{client.email || "Contact email pending"}</span></div></div>
    <div className="client-drawer-body">
      <section className="client-account-card"><div className="directory-badge"><FolderTree size={19} /></div><div><strong>Client account folder</strong><span>{client.driveUrl ? "Google Drive folder ready" : "Google Drive folder not created yet"}</span></div></section>
      {/* The drawer reads industryRaw, not the display default. This is an editing
          surface, so showing a fabricated "Commercial" for a client whose industry is
          genuinely unset would misrepresent what is stored — and it is what the user is
          about to edit. The list row chip keeps the shipped "Commercial" default
          (DES-08a1), which is why these two surfaces cannot share one field. Both are
          pinned: tests/e2e/des08a1-industry-surfacing.spec.ts:263 for the chip,
          tests/e2e/edit06-client-contact-editing.spec.ts:145 for this value. */}
      <div className="client-summary-grid"><div><span>Industry</span><strong>{client.industryRaw ?? "Unspecified"}</strong></div><div><span>Contact role</span><strong>{client.contactRole}</strong></div><div><span>Contact phone</span><strong>{client.contactPhone ?? "Not yet captured"}</strong></div><div><span>Independent projects</span><strong>{projects.length}</strong></div></div>
      <JobSiteMapCard location={client.jobSite} runtime={jobSiteMaps} contextLabel={`${client.code} ${client.name}`} />
      <section className="client-project-section"><header><h3>Projects for this client</h3><button onClick={onNewProject}><Plus size={14} /> New project</button></header>{projects.map((project) => <button type="button" className="client-project-link" key={project.id} onClick={() => onProject(project)}><div><Status text={project.status} /><strong>{project.name}</strong><span>{project.number} · {project.site}</span></div><ChevronRight size={16} /></button>)}{!projects.length ? <OperationsEmptyState variant="client-projects">No projects yet. Create the first independent project for this client.</OperationsEmptyState> : null}</section>
      <section className="client-account-notes"><h3>Account-level documents</h3><p>Store reusable client documents here. Project-specific documents stay inside their own project folders.</p></section>
    </div>
    <footer><button type="button" className="soft-button" onClick={() => setEditingClient(true)}><Settings size={16} /> Edit client</button><button type="button" className="soft-button" onClick={() => setEditingContact(true)} disabled={!contactEditable} title={contactEditable ? "Edit the saved primary contact" : "Refresh after adding a primary contact"}><ContactRound size={16} /> Edit primary contact</button></footer>
  </AccessibleOverlay>
    {editingClient && <ClientEditModal client={client} onClose={() => setEditingClient(false)} onSave={(patch, version) => onSaveClient(client, patch, version)} />}
    {editingContact && contactEditable && <ContactEditModal client={client} onClose={() => setEditingContact(false)} onSave={(patch, version) => onSaveContact(client, patch, version)} />}
  </>;
}
