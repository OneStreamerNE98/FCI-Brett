"use client";

import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity, BriefcaseBusiness, Building2,
  ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Clipboard, Clock3, ContactRound, FolderTree, HardHat,
  Inbox, LayoutDashboard, Mail, MapPin, Menu, MessageSquareText, MoreHorizontal, Navigation,
  LogOut, Search, Settings, ShieldCheck, Sparkles, Users, X, Zap,
} from "lucide-react";
import type { AppEnvironment } from "./lib/app-environment";
import { AssistantView } from "./assistant/components/AssistantView";
import { ClientDrawer } from "./clients/components/ClientDrawer";
import { ClientModal, ClientEditConflictError, ContactEditConflictError } from "./clients/components/ClientModals";
import { ClientsView } from "./clients/components/ClientsView";
import { LeadDrawer } from "./leads/components/LeadDrawer";
import { LeadEditConflictError, LeadModal } from "./leads/components/LeadModal";
import { LeadsView } from "./leads/components/LeadsView";
import { ProjectDrawer } from "./projects/components/ProjectDrawer";
import { NewProjectModal, ProjectEditConflictError, optionalFlooringCategory, projectManagerLabel } from "./projects/components/ProjectModals";
import { ProjectsView } from "./projects/components/ProjectsView";
import { ScheduleView } from "./schedule/components/ScheduleView";
import { localDayRolloverDelay } from "./application/today-project-meetings";
import { InboxView } from "./inbox/components/InboxView";
import type { InboxLeadProposal } from "./inbox/components/InboxView";
import { DEFAULT_FILING_RULES, type FilingRuleDraft } from "./lib/google-workspace";
import { dashboardTimeContext, friendlyFirstName } from "./lib/time-context";
import { ClientDataNotice } from "./components/ClientDataNotice";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AppNotifications, useNotificationQueue } from "./components/AppNotifications";
import { Avatar, Metric, OperationsEmptyState, PageTitle, PanelHeader, Status } from "./components/operations/OperationsPrimitives";
import { OperationsActionableList, OperationsActionableListItem } from "./components/operations/OperationsActionableList";
import { PageLayoutEditor } from "./components/operations/PageLayoutEditor";
import { BusinessKpisPanel } from "./features/reports/BusinessKpisPanel";
import { FINANCIAL_RESTRICTION_LABEL, monthKeyForTimestamp } from "./features/reports/flooring-kpis";
import { clearReportReturnFocusFromCurrentHistoryEntry, rememberReportReturnFocus, reportsReturnFocusHistoryKey } from "./features/reports/report-navigation";
import { normalizeJobSiteLocation, type JobSiteMapsRuntimeConfig } from "./features/maps/job-site-map";
import {
  cachedGetJson,
  invalidateCachedGet,
  isTerminalCachedGetError,
} from "./lib/client-get-cache";
import {
  useCachedGetSubscription,
} from "./lib/client-get-hooks";
import { clientIndustryReportState } from "./lib/client-industries";
import {
  defaultPageLayouts,
  isDefaultPageLayout,
  normalizePageLayoutsForRead,
  resolveArrangedSpans,
  type PageLayout,
  type PageLayoutPage,
  type PageLayouts,
} from "./lib/page-layouts";
import type { SheetMirrorStatus } from "./lib/sheet-mirror-status";
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
  projectLifecycleFromSearch,
  projectStatusFromSearch,
  settingsSectionFromSearch,
  type InboxBucket,
  type OperationsView,
  type ProjectLifecycleFilter,
  type ProjectStatusFilter,
  type SettingsSection,
} from "./lib/operations-routes";
import {
  displayStatus,
  isActiveProject,
  leadStages,
  money,
  recordInitials,
} from "./lib/record-display";
import { notifyError } from "./lib/notification-policy";
import type {
  Client,
  ClientEditPatch,
  ClientUpdatePayload,
  ContactEditPatch,
  ContactUpdatePayload,
  DashboardSummary,
  Lead,
  LeadEditPatch,
  LeadUpdatePayload,
  LiveDataState,
  Notify,
  Project,
  ProjectEditPatch,
  ProjectUpdatePayload,
} from "./lib/record-types";
import { AiAssistantSettingsCard } from "./settings/components/AiAssistantSettingsCard";
import { DataSecurityPanel } from "./settings/components/DataSecurityPanel";
import { DirectorySyncPanel } from "./settings/components/DirectorySyncPanel";
import { GoogleWorkspacePanel } from "./settings/components/GoogleWorkspacePanel";
import { InboxRulesPanel, RuleModal } from "./settings/components/InboxRulesPanel";
import { MySettingsPanel } from "./settings/components/MySettingsPanel";
import { SettingsAudienceNavigation } from "./settings/components/SettingsAudienceNavigation";
import { TestingLaunchPanel } from "./settings/components/TestingLaunchPanel";
import { WorkspaceDefaultsPanel } from "./settings/components/WorkspaceDefaultsPanel";
import { normalizeRecordVersion } from "./domain/record-version";
import { resolveProjectSegment } from "./domain/project-segment";

type LeadModalRequest = Readonly<{
  initialValues?: Partial<Lead>;
  afterCreate?: () => Promise<void>;
}>;
type WorkspaceSearchResult = { kind: "client" | "project" | "contact"; id: string; title: string; subtitle: string; clientId?: string; projectId?: string };
type CurrentUserSettingsPayload = {
  preferences?: { displayTimezone?: unknown; pageLayouts?: unknown };
  isAdmin?: unknown;
};

const projectLifecycleOrder = [...PROJECT_LIFECYCLE_FILTERS];
const PIPELINE_ACTIONABLE_COLUMNS = ["Client / opportunity", "Stage", "Est. value", "Next action"] as const;
const MOBILE_TOPBAR_SCROLL_THRESHOLD = 8;

const focusableControlSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const workspaceNavItems: { label: OperationsView; icon: typeof LayoutDashboard }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Leads", icon: Zap },
  { label: "Clients", icon: ContactRound },
  { label: "Projects", icon: BriefcaseBusiness },
  { label: "Inbox", icon: Inbox },
  { label: "AI Assistant", icon: Sparkles },
];

const managementNavItems: { label: OperationsView; icon: typeof LayoutDashboard }[] = [
  { label: "Reports", icon: Activity },
  { label: "Settings", icon: Settings },
];

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

function optionalProjectTimestamp(value: unknown) {
  const timestamp = optionalRecordNumber(value);
  return timestamp !== null && Number.isSafeInteger(timestamp) && timestamp >= 0 && !Number.isNaN(new Date(timestamp).getTime()) ? timestamp : null;
}

function projectLifecycleFilter(value: string): ProjectLifecycleFilter | null {
  const normalizedStatus = value.toLowerCase();
  return PROJECT_LIFECYCLE_FILTERS.find((status) => status === normalizedStatus) ?? null;
}

const DIRECTORY_GET_URLS = [
  "/api/v1/filing-rules",
  "/api/v1/integrations/google/sheets/status",
  "/api/v1/leads",
  "/api/v1/clients",
  "/api/v1/projects",
  "/api/v1/dashboard",
] as const;

function invalidateDirectoryGets() {
  for (const url of DIRECTORY_GET_URLS) invalidateCachedGet(url);
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
  const { notifications, notify, dismissNotification } = useNotificationQueue();
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
  const directoryVisibleLoadsInFlightRef = useRef(0);
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

  const refreshDirectoryData = useCallback((silent = false, force = false) => {
    if (silent && directoryVisibleLoadsInFlightRef.current > 0) return Promise.resolve();
    if (!silent) directoryVisibleLoadsInFlightRef.current += 1;
    const directoryLoadId = ++directoryLoadIdRef.current;
    const dashboardLoadId = ++dashboardRefreshLoadIdRef.current;
    const getJson = (path: string) => cachedGetJson<Record<string, unknown>>(path, { force });
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
    if (!silent) void Promise.resolve().then(() => {
      if (directoryLoadId !== directoryLoadIdRef.current) return;
      setLiveDataState("loading");
      setLiveDataError("");
    });
    return directoryRequests.then(([leadData, clientData, projectData, dashboardData]) => {
      if (directoryLoadId !== directoryLoadIdRef.current) return;
      const leadRows = Array.isArray(leadData.leads) ? leadData.leads as Record<string, unknown>[] : [];
      const clientRows = Array.isArray(clientData.clients) ? clientData.clients as Record<string, unknown>[] : [];
      const projectRows = Array.isArray(projectData.projects) ? projectData.projects as Record<string, unknown>[] : [];
      const nextLeads = leadRows.map(mapLeadRecord);
      const nextClients = clientRows.map(mapClientRecord);
      const nextProjects = projectRows.map((project) => {
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
      });
      setLeads(nextLeads);
      setClients(nextClients);
      setProjectItems(nextProjects);
      setSelectedLeadId((current) => current && nextLeads.some(({ id }) => id === current)
        ? current
        : null);
      setSelectedClient((current) => current
        ? nextClients.find(({ id }) => id === current.id) ?? null
        : null);
      setSelectedProject((current) => current
        ? nextProjects.find(({ id }) => id === current.id) ?? null
        : null);
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
      if (!silent || isTerminalCachedGetError(error)) {
        if (isTerminalCachedGetError(error)) {
          setLeads([]);
          setClients([]);
          setProjectItems([]);
          setSelectedLeadId(null);
          setSelectedClient(null);
          setSelectedProject(null);
          setLeadOpen(false);
          setClientOpen(false);
          setProjectOpen(false);
          setDashboard(null);
        }
        setLiveDataState("error");
        setLiveDataError(error instanceof Error ? error.message : "Live application data could not be loaded.");
      }
    }).finally(() => {
      if (!silent) directoryVisibleLoadsInFlightRef.current -= 1;
    });
  }, [userEmail, userName]);

  const refreshDashboardSnapshot = useCallback(async () => {
    const loadId = ++dashboardRefreshLoadIdRef.current;
    const data = await cachedGetJson<Record<string, unknown>>("/api/v1/dashboard", { force: true });
    if (loadId > dashboardAppliedLoadIdRef.current) {
      dashboardAppliedLoadIdRef.current = loadId;
      setDashboard(data as unknown as DashboardSummary);
    }
  }, []);

  useEffect(() => {
    void refreshDirectoryData();
  }, [refreshDirectoryData]);

  useCachedGetSubscription(DIRECTORY_GET_URLS, () => refreshDirectoryData(true));

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

  useCachedGetSubscription(["/api/v1/settings/me"], async () => {
    const loadId = ++pageLayoutsLoadIdRef.current;
    try {
      const data = await cachedGetJson<CurrentUserSettingsPayload>("/api/v1/settings/me");
      if (loadId === pageLayoutsLoadIdRef.current) reconcileCurrentUserSettings(data);
    } catch (error) {
      // Transient background failures preserve the last authenticated snapshot;
      // revoked/expired access must remove its role and layout material immediately.
      if (loadId === pageLayoutsLoadIdRef.current && isTerminalCachedGetError(error)) {
        failClosedCurrentUserSettings();
      }
    }
  });

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
      const response = await fetch("/api/v1/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: lead.company, contactName: lead.contact, projectName: lead.project, source: lead.source, stage: lead.stage, site: lead.site, estimatedValue: lead.estimatedValue, nextAction: lead.next, status: "active", ...(lead.addressReview ? { addressReview: lead.addressReview } : {}), ...(lead.contactEmail ? { contactEmail: lead.contactEmail } : {}), ...(lead.contactPhone ? { contactPhone: lead.contactPhone } : {}), ...(lead.nextActionAt ? { nextActionAt: lead.nextActionAt } : {}), ...(lead.ownerEmail ? { ownerEmail: lead.ownerEmail } : {}) }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Lead could not be saved.");
    } catch (error) {
      notifyError(notify, { message: "The lead save result could not be confirmed.", cause: error, action: { label: "Check records", run: () => void refreshDirectoryData(false, true) } });
      return;
    }
    setLeadModal(null);
    notify(`${lead.company} added to your live pipeline`, "success");
    if (afterCreate) await afterCreate();
    invalidateDirectoryGets();
    invalidateCachedGet("/api/v1/assistant/today");
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
    invalidateCachedGet("/api/v1/leads");
    invalidateCachedGet("/api/v1/dashboard");
    invalidateCachedGet("/api/v1/assistant/today");
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
          siteAddress: client.jobSite?.address ?? null,
          ...(client.addressReview ? { addressReview: client.addressReview } : {}),
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
      invalidateDirectoryGets();
      await refreshDirectoryData();
      setClientModal(false);
      notify(data.sheetSync?.message ?? `${client.name} saved in FCI Operations`, data.sheetSync?.status === "pending" ? "warning" : data.sheetSync?.status === "not-configured" ? "info" : "success");
    } catch (error) {
      notifyError(notify, { message: "The client save result could not be confirmed.", cause: error, action: { label: "Check records", run: () => void refreshDirectoryData(false, true) } });
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
    invalidateCachedGet("/api/v1/clients");
    invalidateCachedGet("/api/v1/projects");
    invalidateCachedGet("/api/v1/dashboard");
    invalidateCachedGet("/api/v1/assistant/today");
    const update = (item: Client): Client => item.id === client.id
      ? {
          ...item,
          name: saved.name,
          industry: saved.industry ?? "Commercial",
          industryRaw: saved.industry,
          status: displayStatus(saved.status, saved.status),
          jobSite: normalizeJobSiteLocation({
            address: saved.siteAddress,
            latitude: saved.latitude,
            longitude: saved.longitude,
          }),
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
    invalidateCachedGet("/api/v1/clients");
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
      const response = await fetch("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: project.clientId, name: project.name, status: project.status.toLowerCase(), site: project.jobSite?.address ?? project.site, ...(project.addressReview ? { addressReview: project.addressReview } : {}), projectManagerId: project.managerId, estimatedValue, flooringCategory: project.flooringCategory ?? undefined, squareFeet: project.squareFeet ?? undefined, contractValue: project.contractValue ?? undefined, segment: project.segment ?? undefined }) });
      const errorData = await response.clone().json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(errorData.error ?? "Project could not be saved.");
      const data = await response.json() as { id: string; projectNumber: string; sheetSync?: { status?: string; message?: string } };
      invalidateDirectoryGets();
      await refreshDirectoryData();
      setProjectModal(false);
      setProjectModalClientId(null);
      notify(data.sheetSync?.message ?? `${project.name} saved in FCI Operations`, data.sheetSync?.status === "pending" ? "warning" : data.sheetSync?.status === "not-configured" ? "info" : "success");
    } catch (error) {
      notifyError(notify, { message: "The project save result could not be confirmed.", cause: error, action: { label: "Check records", run: () => void refreshDirectoryData(false, true) } });
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
    invalidateCachedGet("/api/v1/projects");
    invalidateCachedGet("/api/v1/dashboard");
    invalidateCachedGet("/api/v1/assistant/today");
    const client = clients.find((item) => item.id === saved.clientId);
    const estimatedValue = optionalRecordNumber(saved.estimatedValue);
    const squareFeet = optionalRecordNumber(saved.squareFeet);
    const contractValue = optionalRecordNumber(saved.contractValue);
    const jobSite = normalizeJobSiteLocation({
      address: saved.site,
      latitude: saved.latitude,
      longitude: saved.longitude,
    });
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
      invalidateDirectoryGets();
      await refreshDirectoryData();
      notify(`Google Sheet synced: ${data.result?.clients?.total ?? 0} clients and ${data.result?.projects?.total ?? 0} projects`, "success");
    } catch (error) {
      notifyError(notify, { message: "Google Sheets could not complete the directory sync.", cause: error, action: { label: "Try sync again", run: () => void syncGoogleSheet() } });
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
      invalidateCachedGet("/api/v1/projects");
      invalidateCachedGet(`/api/v1/projects/${encodeURIComponent(project.id)}/drive/files`);
      setProjectItems((current) => current.map((item) => item.id === project.id ? updated : item));
      setSelectedProject((current) => current?.id === project.id ? updated : current);
      notify(data.created ? `${project.name} now has a ${data.environment ?? "test"} Drive workspace` : `${project.name} already has a Drive workspace`, data.created ? "success" : "info");
    } catch (error) {
      notifyError(notify, { message: "The project Drive workspace result could not be confirmed.", cause: error, action: { label: "Check project", run: () => void refreshDirectoryData(false, true) } });
    }
  }

  async function addRule(rule: FilingRuleDraft) {
    try {
      const response = await fetch("/api/v1/filing-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule) });
      const data = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? "Rule could not be saved.");
      invalidateCachedGet("/api/v1/filing-rules", { notify: false });
      setFilingRules((current) => [...current, { ...rule, id: data.id }].sort((a, b) => a.priority - b.priority));
      setRuleModal(false);
      notify(`Email rule “${rule.name}” added`, "success");
    } catch (error) {
      notifyError(notify, { message: "The email rule save result could not be confirmed.", cause: error, action: { label: "Check rules", run: () => void refreshDirectoryData(false, true) } });
    }
  }

  async function updateRule(rule: FilingRuleDraft, patch: Partial<Pick<FilingRuleDraft, "enabled" | "priority">>) {
    if (!rule.id) {
      const override = { ...rule, ...patch };
      try {
        const response = await fetch("/api/v1/filing-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(override) });
        const data = await response.json().catch(() => ({})) as { id?: string; error?: string };
        if (!response.ok || !data.id) throw new Error(data.error ?? "Rule could not be saved.");
        invalidateCachedGet("/api/v1/filing-rules", { notify: false });
        setFilingRules((current) => current.map((item) => item.name === rule.name ? { ...override, id: data.id } : item).sort((left, right) => left.priority - right.priority));
        notify(`Email rule “${rule.name}” ${patch.enabled === false ? "paused" : "updated"}`, "success");
      } catch (error) {
        notifyError(notify, { message: "The email rule update result could not be confirmed.", cause: error, action: { label: "Check rules", run: () => void refreshDirectoryData(false, true) } });
      }
      return;
    }
    try {
      const response = await fetch(`/api/v1/filing-rules/${encodeURIComponent(rule.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Rule could not be updated.");
      invalidateCachedGet("/api/v1/filing-rules", { notify: false });
      setFilingRules((current) => current.map((item) => item.id === rule.id ? { ...item, ...patch } : item).sort((left, right) => left.priority - right.priority));
      notify(`Email rule “${rule.name}” ${patch.enabled === false ? "paused" : "updated"}`, "success");
    } catch (error) {
      notifyError(notify, { message: "The email rule update result could not be confirmed.", cause: error, action: { label: "Check rules", run: () => void refreshDirectoryData(false, true) } });
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
      invalidateCachedGet("/api/v1/filing-rules", { notify: false });
      const defaultRule = DEFAULT_FILING_RULES.find((item) => item.name === rule.name);
      setFilingRules((current) => defaultRule ? current.map((item) => item.id === rule.id ? defaultRule : item).sort((left, right) => left.priority - right.priority) : current.filter((item) => item.id !== rule.id));
      notify(defaultRule ? `Email rule “${rule.name}” reset to its built-in default` : `Email rule “${rule.name}” deleted`, "success");
    } catch (error) {
      notifyError(notify, { message: "The email rule delete result could not be confirmed.", cause: error, action: { label: "Check rules", run: () => void refreshDirectoryData(false, true) } });
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
      invalidateDirectoryGets();
      await refreshDirectoryData();
      notify(`${currentLead.company} moved to ${nextStage}`, "success", { label: "Undo", run: () => {
        void (async () => {
          try {
            const undoResponse = await fetch(`/api/v1/leads/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: currentLead.stage }) });
            const undoData = await undoResponse.json().catch(() => ({})) as { error?: string };
            if (!undoResponse.ok) throw new Error(undoData.error ?? "Lead stage could not be restored.");
            invalidateDirectoryGets();
            await refreshDirectoryData();
            notify(`${currentLead.company} returned to ${currentLead.stage}`, "success");
          } catch (undoError) {
            notifyError(notify, { message: "The restored lead stage could not be confirmed.", cause: undoError, action: { label: "Check records", run: () => void refreshDirectoryData(false, true) } });
          }
        })();
      } });
    } catch (error) {
      notifyError(notify, { message: "The lead stage update could not be confirmed.", cause: error, action: { label: "Check records", run: () => void refreshDirectoryData(false, true) } });
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
      const data = await cachedGetJson<{ results?: WorkspaceSearchResult[] }>(
        `/api/v1/search?q=${encodeURIComponent(query)}`,
        { force: true },
      );
      const results = data.results ?? [];
      setSearchResults(results);
      setActiveSearchIndex(results.length > 0 ? 0 : -1);
      if (!results.length) notify(`No workspace records matched “${query}”`, "info");
    } catch (error) {
      setSearchResults([]);
      setActiveSearchIndex(-1);
      notifyError(notify, { message: "Workspace search could not be completed.", cause: error, action: {
        label: "Retry",
        run: () => void searchWorkspace(),
      } });
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
        notify("Project found. The directory will update automatically if it is not listed yet.", "warning");
      }
      return;
    }
    const client = clients.find((item) => item.id === result.clientId);
    if (client) {
      openClient(client, workspaceSearchRef.current);
      notify(`Opened ${client.name}`, "info");
    } else {
      navigateToView("Clients");
      notify("Client found. The directory will update automatically if it is not listed yet.", "warning");
    }
  }

  async function assignProjectToCurrentUser(project: Project) {
    try {
      const projectManagerId = userEmail.trim().toLowerCase();
      const response = await fetch("/api/v1/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, projectManagerId }) });
      const data = await response.json().catch(() => ({})) as { projectManagerId?: string; error?: string };
      if (!response.ok || !data.projectManagerId) throw new Error(data.error ?? "The project manager could not be assigned.");
      const managerId = data.projectManagerId.toLowerCase();
      invalidateCachedGet("/api/v1/projects");
      invalidateCachedGet("/api/v1/dashboard");
      const updateManager = (item: Project) => item.id === project.id
        ? { ...item, managerId, lead: projectManagerLabel(managerId, userEmail, userName) }
        : item;
      setProjectItems((current) => current.map(updateManager));
      setSelectedProject((current) => current ? updateManager(current) : current);
      notify(`${project.number} is now assigned to your signed-in account`, "success");
    } catch (error) {
      notifyError(notify, { message: "The project manager assignment could not be confirmed. Check the project before assigning it again.", cause: error, action: { label: "Check project", run: () => void refreshDirectoryData(false, true) } });
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
    invalidateCachedGet("/api/v1/projects");
    invalidateCachedGet("/api/v1/dashboard");
    invalidateCachedGet("/api/v1/assistant/today");
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
    invalidateCachedGet("/api/v1/projects");
    invalidateCachedGet("/api/v1/dashboard");
    invalidateCachedGet("/api/v1/assistant/today");
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
          {workspaceNavItems.map(({ label, icon: Icon }) => <Link key={label} href={operationsPath(label)} className={view === label ? "active" : ""} onClick={closeNavigationMenus} aria-current={view === label ? "page" : undefined} aria-label={label} title={label}><Icon size={18} /><span className="nav-label">{label}</span></Link>)}
          <p>Management</p>
          {managementNavItems.filter(({ label }) => label !== "Settings" || isAdmin).map(({ label, icon: Icon }) => <Link key={label} href={operationsPath(label)} className={view === label ? "active" : ""} onClick={closeNavigationMenus} aria-current={view === label ? "page" : undefined} aria-label={label} title={label}><Icon size={18} /><span className="nav-label">{label}</span></Link>)}
          {isAdmin && <a href="/management/access" aria-label="People & Access" title="People & Access"><ShieldCheck size={18} /><span className="nav-label">People &amp; Access</span></a>}
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
          <div className="top-actions"><div ref={notificationsMenuRef} className="notification-wrap"><button className="icon-button" onClick={() => { setNotificationsOpen((current) => !current); setWorkspaceMenuOpen(false); setProfileMenuOpen(false); }} aria-label="Workspace navigation" title="Workspace navigation" aria-controls="notifications-popover" aria-expanded={notificationsOpen}><Navigation size={19} aria-hidden="true" /></button>{notificationsOpen && <div id="notifications-popover" className="notification-menu"><strong>Workspace navigation</strong><button onClick={() => navigateToView("Inbox")}>Open the Gmail project inbox</button></div>}</div></div>
        </header>

        <div className="page-wrap">
          <AppErrorBoundary key={view}>
            {development && <section className="development-banner" role="status" aria-label="Development environment; test data only"><ShieldCheck size={17} /><div><strong>Development environment · Test data only</strong><span>Use approved test records while this working copy moves toward production readiness.</span></div></section>}
            <LiveDataBanner state={liveDataState} error={liveDataError} onRetry={() => void refreshDirectoryData(false, true)} />
            {view === "Overview" && <Overview firstName={firstName} timezone={displayTimezone} leads={leads} projects={projectItems} dashboard={dashboard} state={liveDataState} isAdmin={isAdmin} layout={pageLayouts.overview} layoutReady={pageLayoutsReady} layoutError={pageLayoutsError} onRetryLayout={() => void retryPageLayouts()} onSaveLayout={(layout) => savePageLayout("overview", layout)} onView={navigateToView} onProject={openProject} onLead={openLead} />}
            {view === "Leads" && <LeadsView leads={leads} state={liveDataState} filter={leadStageFilter} onAdd={() => setLeadModal({})} onAdvance={advanceLead} onLead={openLead} />}
            {view === "Clients" && <ClientsView clients={clients} state={liveDataState} projectCounts={clientProjectCounts} onAdd={() => setClientModal(true)} onClient={openClient} onNewProject={() => openNewProject()} sheetMirror={sheetMirror} onSyncGoogleSheet={syncGoogleSheet} syncingSheet={sheetSyncing} />}
            {view === "Projects" && <ProjectsView projects={projectItems} state={liveDataState} filter={projectStatus} lifecycle={projectLifecycle} onFilter={navigateToProjectStatus} onNewProject={() => openNewProject()} onProject={openProject} />}
            {view === "Schedule" && <ScheduleView dashboard={dashboard} onSettings={() => navigateToSettings("Workflow & notifications")} />}
            {view === "Inbox" && <InboxView notify={notify} bucket={inboxBucket} onBucket={navigateToInboxBucket} onRules={openRules} projects={projectItems} clients={clients} rules={filingRules} onGoogleSetup={openGoogleWorkspace} onCreateLead={openInboxLead} />}
            {view === "AI Assistant" && <AssistantView projects={projectItems} />}
            {view === "Reports" && <ReportsView leads={leads} projects={projectItems} clients={clients} dashboard={dashboard} state={liveDataState} isAdmin={isAdmin} layout={pageLayouts.reports} layoutReady={pageLayoutsReady} layoutError={pageLayoutsError} onRetryLayout={() => void retryPageLayouts()} onSaveLayout={(layout) => savePageLayout("reports", layout)} />}
            {view === "Settings" && <SettingsView notify={notify} section={settingsArea} onSection={navigateToSettings} onTimezoneChange={setDisplayTimezone} onCurrentUserSettingsLoaded={reconcileCurrentUserSettings} rules={filingRules} projects={projectItems} userName={userName} userEmail={userEmail} isAdmin={isAdmin} onGoogleSetup={openGoogleWorkspace} onAddRule={() => setRuleModal(true)} onUpdateRule={updateRule} onDeleteRule={deleteRule} sheetMirror={sheetMirror} onSyncGoogleSheet={syncGoogleSheet} onImportConfirmed={refreshDirectoryData} syncingSheet={sheetSyncing} />}
          </AppErrorBoundary>
        </div>
      </main>
      {leadModal && <LeadModal mode="create" initialValues={leadModal.initialValues} isAdmin={isAdmin} mapsRuntime={jobSiteMaps} onClose={() => setLeadModal(null)} onSave={addLead} />}
      {clientModal && <ClientModal mapsRuntime={jobSiteMaps} onClose={() => setClientModal(false)} onSave={addClient} />}
      {projectModal && <NewProjectModal clients={clients} initialClientId={projectModalClientId} managerId={userEmail.trim().toLowerCase()} managerLabel={userName.trim() || userEmail} isAdmin={isAdmin} mapsRuntime={jobSiteMaps} onClose={closeNewProject} onSave={addProject} />}
      {ruleModal && <RuleModal onClose={() => setRuleModal(false)} onSave={addRule} />}
      {leadOpen && selectedLead && <LeadDrawer lead={selectedLead} isAdmin={isAdmin} mapsRuntime={jobSiteMaps} onClose={() => setLeadOpen(false)} onAdvance={advanceLead} onSaveLead={saveLeadEdits} returnFocusRef={leadDrawerReturnFocusRef} fallbackFocusRef={workspaceSearchRef} />}
      {projectOpen && selectedProject && <ProjectDrawer project={selectedProject} clients={clients} jobSiteMaps={jobSiteMaps} onClose={() => setProjectOpen(false)} notify={notify} onSaveProject={saveProjectEdits} onProvisionDrive={provisionProjectDrive} onAssignToMe={assignProjectToCurrentUser} onRecordInstallationDates={recordProjectInstallationDates} onRecordFollowUpResult={recordProjectFollowUpResult} onMeetingRecorded={() => void refreshDashboardSnapshot().catch(() => {})} isAdmin={isAdmin} currentUserEmail={userEmail.trim().toLowerCase()} returnFocusRef={projectDrawerReturnFocusRef} />}
      {clientOpen && selectedClient && <ClientDrawer client={selectedClient} projects={projectItems.filter((project) => project.clientId === selectedClient.id)} jobSiteMaps={jobSiteMaps} onClose={() => setClientOpen(false)} onSaveClient={saveClientEdits} onSaveContact={saveContactEdits} onNewProject={() => { setClientOpen(false); openNewProject(selectedClient.id); }} onProject={(project) => { setClientOpen(false); openProject(project); }} returnFocusRef={clientDrawerReturnFocusRef} />}
      <AppNotifications notifications={notifications} onDismiss={dismissNotification} />
    </div>
  );
}

function LiveDataBanner({ state, error, onRetry }: { state: LiveDataState; error: string; onRetry: () => void }) {
  if (state === "ready") return null;
  return <ClientDataNotice
    state={state}
    error={error}
    onRetry={onRetry}
    loadingTitle="Loading live records"
    loadingDetail="Reading leads, clients, projects, activity, and Google directory status."
    errorTitle="Live records could not be loaded"
    retryLabel="Try again"
  />;
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
  // In the default render this panel is itself a `.dashboard-grid` child, so it carries
  // the span class; in the arranged render the wrapper carries it and the panel stays
  // plain. Both branches take the size from the same resolved spans, never a literal.
  const leadPipelinePanel = (spanClass: string) => <div className={`panel pipeline-panel${spanClass}`}>
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
      </div>;
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
    "lead-pipeline": leadPipelinePanel(""),
    "active-projects": <div className="panel projects-panel"><PanelHeader title="Active projects" subtitle={`${activeProjects.length} active`} action="View projects" onAction={() => onView("Projects")} /><div className="project-cards">{activeProjects.slice(0, 6).map((project) => <button className="project-card" key={project.number} onClick={() => onProject(project)}><div className="project-card-top"><Status text={project.status} /><ChevronRight size={17} aria-hidden="true" /></div><span className="project-number">{project.number}</span><h3>{project.name}</h3><p>{project.client}</p><div className="project-meta"><span><MapPin size={13} />{project.site}</span><span>{project.value}</span></div></button>)}{activeProjects.length === 0 && state === "ready" ? <OperationsEmptyState variant="table">No active projects. Completed, cancelled, and archived work remains available on the Projects page.</OperationsEmptyState> : null}</div></div>,
    "gmail-project-inbox": <div className="panel inbox-panel"><PanelHeader title="Gmail project inbox" subtitle="Google Workspace Gmail" subtitleKind="source" action="Open inbox" onAction={() => onView("Inbox")} /><OperationsEmptyState variant="dashboard"><Mail size={20} /><div><strong>Review every message before filing</strong><p>Select the exact project and approve the copy before anything is saved to Drive.</p></div></OperationsEmptyState><button className="inbox-cta" onClick={() => onView("Inbox")}><Mail size={15} /> Open Gmail project inbox</button></div>,
  } as const;

  return <PageLayoutEditor page="overview" layout={layout} isAdmin={isAdmin} enabled={layoutReady} loadError={layoutError} onRetry={onRetryLayout} onSave={onSaveLayout}>{({ layout: activeLayout, editing, editButton, editor, endDropZone, section }) => {
    const visibleKeys = activeLayout.order.filter((key) => !activeLayout.hidden.includes(key) && key in sectionNodes) as Array<keyof typeof sectionNodes>;
    const arrangedSpans = resolveArrangedSpans("overview", visibleKeys, activeLayout.fullWidth);
    const spanClassName = (key: keyof typeof sectionNodes) => arrangedSpans.find((span) => span.key === key)?.size === "full" ? " page-layout-span-all" : "";
    const defaultSections = <>
      {sectionNodes.metrics}
      {sectionNodes["todays-meetings"]}
      <section className="dashboard-grid">{leadPipelinePanel(spanClassName("lead-pipeline"))}</section>
      <section className="dashboard-grid lower-grid">{sectionNodes["active-projects"]}{sectionNodes["gmail-project-inbox"]}</section>
    </>;
    const arrangedSections = <><div className="page-layout-grid page-layout-grid-overview">{arrangedSpans.map(({ key, size }) => <div className={size === "full" ? "page-layout-span-all" : "page-layout-item"} data-page-layout-section={key} data-page-layout-size={size} key={key}>{section(key, sectionNodes[key])}</div>)}</div>{endDropZone}</>;
    return <>
      <PageTitle eyebrow={dateLabel} title={`${greeting}${firstName ? `, ${firstName}` : ""}.`} text={recordsReady ? "Here’s the latest from your operations workspace." : "Connecting to your operations workspace."} state="Working" action={editButton} />
      {editor}
      {!editing && isDefaultPageLayout(activeLayout, "overview", isAdmin) ? defaultSections : arrangedSections}
    </>;
  }}</PageLayoutEditor>;
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
    <div className="settings-layout"><SettingsAudienceNavigation section={visibleSection} isAdmin={isAdmin} sheetMirror={sheetMirror} onSection={onSection} />
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
