"use client";

import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity, Bell, Bot, BriefcaseBusiness, Building2, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CircleAlert, CircleCheckBig, Clipboard, Clock3, ContactRound, ExternalLink, FileText, FolderOpen, FolderTree, HardHat,
  Inbox, Info, LayoutDashboard, Mail, MapPin, Menu, MessageSquareText, MoreHorizontal,
  ListFilter, LogOut, Plus, RefreshCw, Reply, Search, Send, Settings, ShieldCheck, Sparkles, Users, X, Zap,
} from "lucide-react";
import type { AppEnvironment } from "./lib/app-environment";
import { DEFAULT_FILING_RULES, evaluateInboxFilingRules, type FilingRuleDraft } from "./lib/google-workspace";
import { dashboardTimeContext, friendlyFirstName } from "./lib/time-context";
import { AccessibleOverlay } from "./components/AccessibleOverlay";
import { FeatureStateBadge, type FeatureState } from "./components/FeatureStateBadge";
import { Avatar, Metric, PageTitle, PanelHeader, Status } from "./components/operations/OperationsPrimitives";
import { OperationsActionableList, OperationsActionableListItem } from "./components/operations/OperationsActionableList";
import { ActiveRouteFilter } from "./features/reports/ActiveRouteFilter";
import { BusinessKpisPanel } from "./features/reports/BusinessKpisPanel";
import { FINANCIAL_RESTRICTION_LABEL } from "./features/reports/flooring-kpis";
import { clearReportReturnFocusFromCurrentHistoryEntry, rememberReportReturnFocus, reportsReturnFocusHistoryKey } from "./features/reports/report-navigation";
import { cachedGetJson } from "./lib/client-get-cache";
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
  SETTINGS_SECTIONS,
  settingsSectionFromSearch,
  type InboxBucket,
  type LeadStageFilter,
  type OperationsView,
  type ProjectLifecycleFilter,
  type ProjectStatusFilter,
  type SettingsSection,
} from "./lib/operations-routes";
import { DataSecurityPanel } from "./settings/components/DataSecurityPanel";
import { DirectorySyncPanel } from "./settings/components/DirectorySyncPanel";
import { GmailFilingModal, GoogleWorkspacePanel, type GmailFilingPreview, type WorkspaceMessage } from "./settings/components/GoogleWorkspacePanel";
import { InboxRulesPanel, RuleModal } from "./settings/components/InboxRulesPanel";
import { MyAccountPanel } from "./settings/components/MyAccountPanel";
import { TestingLaunchPanel } from "./settings/components/TestingLaunchPanel";
import { WorkspaceDefaultsPanel } from "./settings/components/WorkspaceDefaultsPanel";

type Lead = { id: string; number: string; company: string; contact: string; project: string; value: string; estimatedValue: number; stage: string; source: string; next: string; site: string; status: string; initials: string; color: string; createdAt?: number | null; updatedAt?: number | null };
type Client = { id: string; code: string; name: string; contact: string; email: string; industry: string; status: string; initials: string; color: string; googleStatus: "Ready" | "Setup pending"; driveFolderId?: string; driveUrl?: string };
type Project = { id: string; clientId: string; number: string; client: string; name: string; status: string; progress: number; value: string; estimatedValue: number | null; site: string; managerId: string | null; lead: string; date: string; accent: string; createdAt?: number | null; updatedAt?: number | null; driveFolderId?: string; driveUrl?: string };
type DashboardSummary = {
  generatedAt: number;
  metrics: { activeLeads: number; estimatedPipelineValue: number; activeProjects: number; clientCount: number; meetingCount: number; filedEmailCount: number };
  projectsByStatus: Array<{ status: string; count: number }>;
  recentActivity: Array<{ id: string; action: string; detail: string | null; actor: string; created_at: number }>;
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
type SheetMirrorStatus = {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  spreadsheetUrl: string | null;
  spreadsheetName: string | null;
  clients: { status: string; lastSyncedAt: number | null; lastError: string | null };
  projects: { status: string; lastSyncedAt: number | null; lastError: string | null };
  lastSyncedAt: number | null;
  reason: string | null;
};
type WorkspaceSearchResult = { kind: "client" | "project" | "contact"; id: string; title: string; subtitle: string; clientId?: string; projectId?: string };

const leadStages = LEAD_STAGE_FILTERS.filter((stage) => stage !== "other").map((stage) => LEAD_STAGE_LABELS[stage]);
const projectLifecycleOrder = [...PROJECT_LIFECYCLE_FILTERS];
const terminalProjectStatuses = new Set(["archived", "completed", "cancelled"]);
const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const PIPELINE_ACTIONABLE_COLUMNS = ["Client / opportunity", "Stage", "Est. value", "Next action"] as const;
const CLIENT_ACTIONABLE_COLUMNS = ["Client", "Primary contact", "Projects", ""] as const;
const PROJECT_ACTIONABLE_COLUMNS = ["Project", "Status", "Schedule & site", "Value", ""] as const;
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
  return currencyFormatter.format(value);
}

function optionalRecordNumber(value: unknown) {
  const number = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : null;
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

export function FloorOpsApp({ initialView, environment, userName, userEmail, accessLabel, signOutHref }: { initialView: OperationsView; environment: AppEnvironment; userName: string; userEmail: string; accessLabel: "Admin" | "Office"; signOutHref: string }) {
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
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [leadModal, setLeadModal] = useState(false);
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
  const [isAdmin, setIsAdmin] = useState(accessLabel === "Admin");
  const mobileNavigationRef = useRef<HTMLElement>(null);
  const mobileNavigationCloseRef = useRef<HTMLButtonElement>(null);
  const mobileNavigationTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceSearchRef = useRef<HTMLInputElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const notificationsMenuRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const projectDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const clientDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const leadDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;
  const firstName = friendlyFirstName(userName, userEmail);
  const development = environment === "development";
  const userInitials = userName.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "FC";

  useEffect(() => {
    // The Workspace panel consumes its one-time OAuth result before normal
    // route canonicalization so these two URL updates cannot race on mount.
    if (new URLSearchParams(search).has("google")) return;
    const canonicalSearch = canonicalOperationsSearch(view, search);
    if (canonicalSearch === search) return;
    const canonicalUrl = `${operationsPath(view)}${canonicalSearch ? `?${canonicalSearch}` : ""}`;
    router.replace(canonicalUrl, { scroll: false });
  }, [router, search, view]);

  const refreshDirectoryData = useCallback(() => {
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
      setLiveDataState("loading");
      setLiveDataError("");
    });
    return directoryRequests.then(([leadData, clientData, projectData, dashboardData]) => {
      const leadRows = Array.isArray(leadData.leads) ? leadData.leads as Record<string, unknown>[] : [];
      const clientRows = Array.isArray(clientData.clients) ? clientData.clients as Record<string, unknown>[] : [];
      const projectRows = Array.isArray(projectData.projects) ? projectData.projects as Record<string, unknown>[] : [];
      setLeads(leadRows.map((lead) => {
        const estimatedValue = Number(lead.estimatedValue ?? 0);
        return { id: String(lead.id), number: String(lead.leadNumber ?? "Lead"), company: String(lead.company), contact: String(lead.contactName), project: String(lead.projectName), value: money(estimatedValue), estimatedValue, stage: String(lead.stage), source: String(lead.source), next: String(lead.nextAction), site: String(lead.site), status: String(lead.status), initials: recordInitials(String(lead.company)), color: "sage", createdAt: optionalRecordNumber(lead.createdAt), updatedAt: optionalRecordNumber(lead.updatedAt) };
      }));
      setClients(clientRows.map((client) => ({ id: String(client.id), code: String(client.client_code), name: String(client.name), contact: String(client.primary_contact_name ?? "Primary contact pending"), email: String(client.primary_contact_email ?? ""), industry: String(client.industry ?? "Commercial"), status: displayStatus(client.status, "Active"), initials: recordInitials(String(client.name)), color: "sage", googleStatus: client.drive_folder_id ? "Ready" as const : "Setup pending" as const, driveFolderId: client.drive_folder_id ? String(client.drive_folder_id) : undefined, driveUrl: client.drive_url ? String(client.drive_url) : undefined })));
      setProjectItems(projectRows.map((project) => {
        const managerId = typeof project.project_manager_id === "string" && project.project_manager_id.trim()
          ? project.project_manager_id.trim().toLowerCase()
          : null;
        const estimatedValue = optionalRecordNumber(project.estimated_value);
        return { id: String(project.id), clientId: String(project.client_id), number: String(project.project_number), client: String(project.client_name), name: String(project.name), status: displayStatus(project.status, "Planning"), progress: 0, value: estimatedValue === null ? "TBD" : money(estimatedValue), estimatedValue, site: String(project.site ?? "Site pending"), managerId, lead: projectManagerLabel(managerId, userEmail, userName), date: "Not scheduled", accent: "sage", createdAt: optionalRecordNumber(project.created_at), updatedAt: optionalRecordNumber(project.updated_at), driveFolderId: project.drive_folder_id ? String(project.drive_folder_id) : undefined, driveUrl: project.drive_url ? String(project.drive_url) : undefined };
      }));
      setDashboard(dashboardData as unknown as DashboardSummary);
      setLiveDataState("ready");

      void optionalRequests.then(([ruleResult, mirrorResult]) => {
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
      setLiveDataState("error");
      setLiveDataError(error instanceof Error ? error.message : "Live application data could not be loaded.");
    });
  }, [userEmail, userName]);

  useEffect(() => {
    void refreshDirectoryData();
  }, [refreshDirectoryData]);

  useEffect(() => {
    let active = true;
    void cachedGetJson<{ preferences?: { displayTimezone?: unknown }; isAdmin?: unknown }>("/api/v1/settings/me")
      .then((data) => {
        const timezone = data?.preferences?.displayTimezone;
        if (active && typeof timezone === "string") setDisplayTimezone(timezone);
        if (active && typeof data?.isAdmin === "boolean") setIsAdmin(data.isAdmin);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 820px)");
    const updateMobileNavigationMode = () => {
      setMobileNavViewport(mediaQuery.matches);
      if (!mediaQuery.matches) setMobileNav(false);
    };
    updateMobileNavigationMode();
    mediaQuery.addEventListener("change", updateMobileNavigationMode);
    return () => mediaQuery.removeEventListener("change", updateMobileNavigationMode);
  }, []);

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
        workspaceSearchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

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
    setToast(null);
  }, []);

  const notify = useCallback<Notify>((message, kind = "info", action) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setToast({ message, kind, action });
    if (kind !== "error") {
      const duration = kind === "warning" ? 8_000 : kind === "info" ? 5_000 : 3_200;
      toastTimerRef.current = window.setTimeout(() => {
        toastTimerRef.current = null;
        setToast(null);
      }, duration);
    }
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  async function addLead(lead: Lead) {
    try {
      const response = await fetch("/api/v1/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: lead.company, contactName: lead.contact, projectName: lead.project, source: lead.source, stage: lead.stage, site: lead.site, estimatedValue: lead.estimatedValue, nextAction: lead.next, status: "active" }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Lead could not be saved.");
      await refreshDirectoryData();
      setLeadModal(false);
      notify(`${lead.company} added to your live pipeline`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Lead could not be saved.", "error");
    }
  }

  async function addClient(client: Client) {
    try {
      const response = await fetch("/api/v1/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: client.name, industry: client.industry, status: client.status.toLowerCase(), primaryContact: { name: client.contact, email: client.email } }) });
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

  async function addProject(project: Project) {
    try {
      const estimatedValue = project.estimatedValue ?? undefined;
      const response = await fetch("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: project.clientId, name: project.name, status: project.status.toLowerCase(), site: project.site, projectManagerId: project.managerId, estimatedValue }) });
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
            <img src="/floor-coverings-international-logo.png" alt="Floor Coverings International" />
            <span className="brand-compact" aria-hidden="true"><Building2 size={22} /></span>
          </div>
          <button className="sidebar-collapse" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>{sidebarCollapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}</button>
        </div>
        <button ref={mobileNavigationCloseRef} className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={20} /></button>
        <nav className="main-nav" aria-label="Main navigation">
          <p>Workspace</p>
          {navItems.slice(0, 6).map(({ label, icon: Icon, state }) => <Link key={label} href={operationsPath(label)} className={view === label ? "active" : ""} onClick={closeNavigationMenus} aria-current={view === label ? "page" : undefined} aria-label={`${label} · ${state}`} title={`${label} · ${state}`}><Icon size={18} /><span className="nav-label">{label}</span><FeatureStateBadge state={state} /></Link>)}
          <p>Management</p>
          {navItems.slice(6).map(({ label, icon: Icon, state }) => <Link key={label} href={operationsPath(label)} className={view === label ? "active" : ""} onClick={closeNavigationMenus} aria-current={view === label ? "page" : undefined} aria-label={`${label} · ${state}`} title={`${label} · ${state}`}><Icon size={18} /><span className="nav-label">{label}</span><FeatureStateBadge state={state} /></Link>)}
          {accessLabel === "Admin" && <a href="/management/access" aria-label="People & Access · In development" title="People & Access · In development"><ShieldCheck size={18} /><span className="nav-label">People &amp; Access</span><FeatureStateBadge state="In development" /></a>}
        </nav>
        <div ref={workspaceMenuRef} className="sidebar-menu-wrap workspace-menu-wrap">
          <button className="workspace-card" onClick={() => { setWorkspaceMenuOpen((current) => !current); setProfileMenuOpen(false); setNotificationsOpen(false); }} aria-controls="workspace-actions-popover" aria-expanded={workspaceMenuOpen} title="Workspace actions"><div className="workspace-icon"><Building2 size={17} /></div><div><span>{development ? "Development workspace" : "Production workspace"}</span><strong>Floor Coverings International</strong></div><ChevronDown size={16} /></button>
          {workspaceMenuOpen && <div id="workspace-actions-popover" className="sidebar-popover workspace-popover"><div className="menu-heading"><strong>FCI Operations</strong><span>{development ? "Working development environment" : "Company production environment"}</span></div><button onClick={() => navigateToView("Clients")}><ContactRound size={15} /> Client Directory</button><button onClick={openDirectorySettings}><FolderTree size={15} /> Directory sync</button><button onClick={openGoogleWorkspace}><Building2 size={15} /> Google Workspace</button><button onClick={openTestingChecklist}><ShieldCheck size={15} /> Testing & launch</button></div>}
        </div>
        <div ref={profileMenuRef} className="sidebar-menu-wrap profile-menu-wrap">
          <button className="profile" onClick={() => { setProfileMenuOpen((current) => !current); setWorkspaceMenuOpen(false); setNotificationsOpen(false); }} aria-controls="account-actions-popover" aria-expanded={profileMenuOpen} aria-label={`${userName} account actions`} title="Account actions"><div className="avatar">{userInitials}</div><div><strong>{userName}</strong><span>{accessLabel}</span></div><MoreHorizontal size={18} /></button>
          {profileMenuOpen && <div id="account-actions-popover" className="sidebar-popover profile-popover"><div className="menu-heading"><strong>{userName}</strong><span>{userEmail} · {accessLabel}</span></div><button onClick={() => void copySignedInEmail()}><Clipboard size={15} /> Copy signed-in email</button><button onClick={openGoogleWorkspace}><Building2 size={15} /> Google connection</button><button onClick={() => navigateToSettings("My account")}><Settings size={15} /> My account</button><button onClick={toggleSidebar}><ChevronsLeft size={15} /> {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}</button><a href={signOutHref}><LogOut size={15} /> Sign out</a></div>}
        </div>
      </aside>

      {mobileNavActive && <div className="sidebar-scrim" role="presentation" aria-hidden="true" onMouseDown={() => setMobileNav(false)} />}
      <main className="main-area" inert={mobileNavActive ? true : undefined}>
        <header className="topbar">
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
          <div className="top-actions"><div ref={notificationsMenuRef} className="notification-wrap"><button className="icon-button" onClick={() => { setNotificationsOpen((current) => !current); setWorkspaceMenuOpen(false); setProfileMenuOpen(false); }} aria-label="Notifications" aria-controls="notifications-popover" aria-expanded={notificationsOpen}><Bell size={19} /></button>{notificationsOpen && <div id="notifications-popover" className="notification-menu"><strong>Notifications</strong><button onClick={() => navigateToView("Inbox")}>Open the Gmail project inbox</button><button onClick={() => navigateToView("Schedule")}>Schedule alerts will appear after scheduling is connected</button></div>}</div>{view === "Overview" && <button className="soft-button" onClick={() => setLeadModal(true)}><Plus size={17} /> Add lead</button>}</div>
        </header>

        <div className="page-wrap">
          {development && <section className="development-banner" role="status" aria-label="Development environment; test data only"><ShieldCheck size={17} /><div><strong>Development environment · Test data only</strong><span>Use approved test records while this working copy moves toward production readiness.</span></div></section>}
          <LiveDataBanner state={liveDataState} error={liveDataError} onRetry={() => void refreshDirectoryData()} />
          {view === "Overview" && <Overview firstName={firstName} timezone={displayTimezone} leads={leads} projects={projectItems} dashboard={dashboard} state={liveDataState} onView={navigateToView} onProject={openProject} onLead={openLead} />}
          {view === "Leads" && <LeadsView leads={leads} state={liveDataState} filter={leadStageFilter} onAdd={() => setLeadModal(true)} onAdvance={advanceLead} onLead={openLead} />}
          {view === "Clients" && <ClientsView clients={clients} state={liveDataState} projectCounts={clientProjectCounts} onAdd={() => setClientModal(true)} onClient={openClient} onNewProject={() => openNewProject()} sheetMirror={sheetMirror} onSyncGoogleSheet={syncGoogleSheet} syncingSheet={sheetSyncing} />}
          {view === "Projects" && <ProjectsView projects={projectItems} state={liveDataState} filter={projectStatus} lifecycle={projectLifecycle} onFilter={navigateToProjectStatus} onNewProject={() => openNewProject()} onProject={openProject} />}
          {view === "Schedule" && <ScheduleView dashboard={dashboard} onSettings={() => navigateToSettings("Workflow & notifications")} />}
          {view === "Inbox" && <InboxView notify={notify} bucket={inboxBucket} onBucket={navigateToInboxBucket} onRules={openRules} projects={projectItems} clients={clients} rules={filingRules} onGoogleSetup={openGoogleWorkspace} />}
          {view === "AI Assistant" && <AssistantView projects={projectItems} />}
          {view === "Reports" && <ReportsView leads={leads} projects={projectItems} clients={clients} dashboard={dashboard} state={liveDataState} isAdmin={isAdmin} />}
          {view === "Settings" && <SettingsView notify={notify} section={settingsArea} onSection={navigateToSettings} onTimezoneChange={setDisplayTimezone} rules={filingRules} projects={projectItems} userName={userName} userEmail={userEmail} isAdmin={isAdmin} onGoogleSetup={openGoogleWorkspace} onAddRule={() => setRuleModal(true)} onUpdateRule={updateRule} onDeleteRule={deleteRule} sheetMirror={sheetMirror} onSyncGoogleSheet={syncGoogleSheet} syncingSheet={sheetSyncing} />}
        </div>
      </main>
      {leadModal && <LeadModal onClose={() => setLeadModal(false)} onSave={addLead} />}
      {clientModal && <ClientModal onClose={() => setClientModal(false)} onSave={addClient} />}
      {projectModal && <NewProjectModal clients={clients} initialClientId={projectModalClientId} managerId={userEmail.trim().toLowerCase()} managerLabel={userName.trim() || userEmail} onClose={closeNewProject} onSave={addProject} />}
      {ruleModal && <RuleModal onClose={() => setRuleModal(false)} onSave={addRule} />}
      {leadOpen && selectedLead && <LeadDrawer lead={selectedLead} onClose={() => setLeadOpen(false)} onAdvance={advanceLead} returnFocusRef={leadDrawerReturnFocusRef} />}
      {projectOpen && selectedProject && <ProjectDrawer project={selectedProject} onClose={() => setProjectOpen(false)} notify={notify} onProvisionDrive={provisionProjectDrive} onAssignToMe={assignProjectToCurrentUser} canAssignManager={accessLabel === "Admin"} currentUserEmail={userEmail.trim().toLowerCase()} returnFocusRef={projectDrawerReturnFocusRef} />}
      {clientOpen && selectedClient && <ClientDrawer client={selectedClient} projects={projectItems.filter((project) => project.clientId === selectedClient.id)} onClose={() => setClientOpen(false)} onNewProject={() => { setClientOpen(false); openNewProject(selectedClient.id); }} onProject={(project) => { setClientOpen(false); openProject(project); }} returnFocusRef={clientDrawerReturnFocusRef} />}
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

function Overview({ firstName, timezone, leads, projects, dashboard, state, onView, onProject, onLead }: { firstName: string | null; timezone: string; leads: Lead[]; projects: Project[]; dashboard: DashboardSummary | null; state: LiveDataState; onView: (v: OperationsView) => void; onProject: (p: Project) => void; onLead: (lead: Lead, returnFocusTarget?: HTMLElement | null) => void }) {
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
  return <>
    <div className="page-heading"><div><div className="page-title-kicker"><p className="eyebrow">{dateLabel}</p><FeatureStateBadge state="Working" /></div><h1>{greeting}{firstName ? `, ${firstName}` : ""}.</h1><p>{recordsReady ? "Here’s the latest from your operations workspace." : "Connecting to your operations workspace."}</p></div><button className="soft-button" onClick={() => onView("Schedule")}><CalendarDays size={16} /> View scheduling status</button></div>
    <section className="metrics-grid">
      <Metric label="Active pipeline" value={recordsReady ? money(metrics?.estimatedPipelineValue ?? 0) : "—"} note={recordsReady ? `${metrics?.activeLeads ?? activeLeads.length} open opportunities` : "Loading current totals"} trend="Current" icon={Zap} color="orange" />
      <Metric label="Active projects" value={recordsReady ? String(metrics?.activeProjects ?? activeProjects.length) : "—"} note={recordsReady ? "Projects currently in progress" : "Loading current totals"} trend="Current" icon={HardHat} color="green" />
      <Metric label="Project meetings" value={recordsReady ? String(metrics?.meetingCount ?? 0) : "—"} note={recordsReady ? "Meeting notes saved" : "Loading current totals"} trend="Current" icon={MessageSquareText} color="blue" />
      <Metric label="Filed emails" value={recordsReady ? String(metrics?.filedEmailCount ?? 0) : "—"} note={recordsReady ? "Emails filed to projects" : "Loading current totals"} trend="Current" icon={Mail} color="violet" />
    </section>
    <section className="dashboard-grid">
      <div className="panel pipeline-panel">
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
        </OperationsActionableList> : state === "ready" ? <div className="empty-table">No active leads yet. Add the first opportunity to begin the live pipeline.</div> : null}
      </div>
      <div className="panel schedule-panel">
        <PanelHeader title="Scheduling" subtitle="Planned" action="View status" onAction={() => onView("Schedule")} />
        <div className="dashboard-inbox-empty"><CalendarDays size={20} /><div><strong>Scheduling is planned for a later milestone</strong><p>{dashboard?.readiness.scheduleReason ?? "Workers, crews, shifts, conflicts, and acknowledgements will appear here after the scheduling foundation is approved."}</p></div></div>
      </div>
    </section>
    <section className="dashboard-grid lower-grid">
      <div className="panel projects-panel"><PanelHeader title="Active projects" subtitle={`${activeProjects.length} active`} action="View projects" onAction={() => onView("Projects")} /><div className="project-cards">{activeProjects.slice(0, 6).map((project) => <button className="project-card" key={project.number} onClick={() => onProject(project)}><div className="project-card-top"><Status text={project.status} /><ChevronRight size={17} aria-hidden="true" /></div><span className="project-number">{project.number}</span><h3>{project.name}</h3><p>{project.client}</p><div className="project-meta"><span><MapPin size={13} />{project.site}</span><span>{project.value}</span></div></button>)}{activeProjects.length === 0 && state === "ready" ? <div className="empty-table">No active projects. Completed, cancelled, and archived work remains available on the Projects page.</div> : null}</div></div>
      <div className="panel inbox-panel"><PanelHeader title="Gmail project inbox" subtitle="Google Workspace Gmail" action="Open inbox" onAction={() => onView("Inbox")} /><div className="dashboard-inbox-empty"><Mail size={20} /><div><strong>Review every message before filing</strong><p>Select the exact project and approve the copy before anything is saved to Drive.</p></div></div><button className="inbox-cta" onClick={() => onView("Inbox")}><Mail size={15} /> Open Gmail project inbox</button></div>
    </section>
  </>;
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
    {visibleActiveLeads.length === 0 && state === "ready" ? <section className="panel empty-tab"><div><Zap size={25} /></div><h2>{filterLabel ? `No active leads in ${filterLabel}` : "No active leads"}</h2><p>{filterLabel ? "The report filter is valid, but no current records match it." : "Add your first lead. Inactive records remain listed below."}</p>{filterLabel ? <Link className="soft-button" href={operationsHref("Leads")}>Show all active leads</Link> : <button className="primary-button" onClick={onAdd}><Plus size={16} /> Add first lead</button>}</section> : standardLeads.length > 0 ? <div className={`board${filter ? " filtered-board" : ""}`}>{stagesToRender.map((stage) => { const stageLeads = standardLeads.filter((lead) => lead.stage.toLowerCase() === stage.toLowerCase()); return <section className="board-column" key={stage}><header><h2>{stage}</h2><b>{stageLeads.length}</b></header>{stageLeads.map((lead) => <article className="lead-card" key={lead.id}><div className="lead-card-head"><Avatar initials={lead.initials} color={lead.color} /><span>{lead.number}</span></div><h3>{lead.company}</h3><p>{lead.project}</p><div className="lead-value">{lead.value}</div><div className="lead-contact"><Users size={14} />{lead.contact}</div><button type="button" className="lead-detail-button" aria-label={`View details for ${lead.company}`} onClick={(event) => onLead(lead, event.currentTarget)}>View details <ChevronRight size={14} /></button><footer><span>{lead.source}</span><button onClick={() => onAdvance(lead.id)} aria-label={`Advance ${lead.company} from ${lead.stage}`}>Advance <ChevronRight size={15} /></button></footer></article>)}{stageLeads.length === 0 && <p className="board-empty">No leads in this stage.</p>}</section>; })}</div> : null}
    {customStageLeads.length > 0 && <LeadStatusPanel title="Custom pipeline stages" subtitle="These leads use stages outside the current pipeline. Review their stage before advancing them." leads={customStageLeads} onLead={onLead} />}
    {!filter && inactiveLeads.length > 0 && <LeadStatusPanel title="Inactive leads" subtitle="Converted, lost, closed, and archived leads are excluded from active totals." leads={inactiveLeads} showRecordStatus onLead={onLead} />}
  </>;
}

function LeadStatusPanel({ title, subtitle, leads, showRecordStatus = false, onLead }: { title: string; subtitle: string; leads: Lead[]; showRecordStatus?: boolean; onLead?: (lead: Lead, returnFocusTarget?: HTMLElement | null) => void }) {
  return <section className="panel pipeline-panel"><PanelHeader title={title} subtitle={subtitle} /><div className="pipeline-head"><span>Client / opportunity</span><span>{showRecordStatus ? "Status" : "Stage"}</span><span>Est. value</span><span>Next action</span></div>{leads.map((lead) => <div className="pipeline-row" key={lead.id}><div className="client-cell"><Avatar initials={lead.initials} color={lead.color} /><div className="client-cell-copy"><strong>{lead.company}</strong><span>{lead.project}</span></div></div><div><Status text={showRecordStatus ? displayStatus(lead.status, "Inactive") : lead.stage} /></div><strong className="value-cell">{lead.value}</strong><div className="next-cell lead-status-next"><span><Clock3 size={14} />{lead.next}</span>{onLead && <button type="button" className="lead-status-detail" aria-label={`View details for ${lead.company}`} onClick={(event) => onLead(lead, event.currentTarget)}>View details <ChevronRight size={14} /></button>}</div></div>)}</section>;
}

function sheetStateLabel(mirror: SheetMirrorStatus | null) {
  if (!mirror) return "Checking sync";
  if (mirror.clients.status === "syncing" || mirror.projects.status === "syncing") return "Syncing";
  if (mirror.reason || mirror.clients.status === "failed" || mirror.projects.status === "failed") return "Needs attention";
  if (mirror.clients.status === "synced" && mirror.projects.status === "synced") return "Synced";
  return "Not synced";
}

function ClientsView({ clients, state, projectCounts, onAdd, onClient, onNewProject, sheetMirror, onSyncGoogleSheet, syncingSheet }: { clients: Client[]; state: LiveDataState; projectCounts: Map<string, number>; onAdd: () => void; onClient: (client: Client, returnFocusTarget?: HTMLElement | null) => void; onNewProject: () => void; sheetMirror: SheetMirrorStatus | null; onSyncGoogleSheet: () => Promise<void>; syncingSheet: boolean }) {
  const [clientFilter, setClientFilter] = useState("");
  const syncLabel = sheetStateLabel(sheetMirror);
  const synced = syncLabel === "Synced";
  const needsAttention = syncLabel === "Needs attention";
  const syncStateClass = synced ? "synced" : needsAttention ? "needs-attention" : syncLabel === "Checking sync" || syncLabel === "Syncing" ? "checking" : "not-synced";
  const normalizedFilter = clientFilter.trim().toLowerCase();
  const visibleClients = normalizedFilter ? clients.filter((client) => [client.name, client.code, client.contact, client.email].some((value) => value.toLowerCase().includes(normalizedFilter))) : clients;
  return <><PageTitle eyebrow="Client directory" title="Clients" text="Keep each client’s contacts, account documents, and projects together." state="In development" action={<div className="title-actions"><button className="soft-button" onClick={onNewProject} disabled={clients.length === 0}><BriefcaseBusiness size={16} /> New project</button><button className="primary-button" onClick={onAdd}><Plus size={17} /> Add client</button></div>} />
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
    </OperationsActionableList>{clients.length === 0 && state === "ready" ? <div className="empty-table">No clients yet. Add the first client to create the live directory.</div> : visibleClients.length === 0 && state === "ready" ? <div className="empty-table">No clients match “{clientFilter.trim()}”.</div> : null}</div>
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
    </OperationsActionableList>{!filteredProjects.length && <div className="empty-table">{state === "ready" ? lifecycleLabel ? `There are no projects in ${lifecycleLabel}.` : filter === "Active" ? "No active projects yet." : `There are no ${filter.toLowerCase()} projects.` : "Loading projects…"}</div>}</div>
  </>;
}

function ScheduleView({ dashboard, onSettings }: { dashboard: DashboardSummary | null; onSettings: () => void }) {
  return <><PageTitle eyebrow="Field operations" title="Schedule & crews" text="Scheduling is planned for a later milestone." state="Planned" action={<button className="soft-button" onClick={onSettings}><Settings size={16} /> Workflow & notification settings</button>} />
    <section className="panel empty-tab"><div><CalendarDays size={27} /></div><h2>What the scheduling workspace will include</h2><p>{dashboard?.readiness.scheduleReason ?? "Workers, crews, shifts, conflicts, and assignment acknowledgements will appear here after the scheduling foundation is approved."}</p></section>
  </>;
}

type GmailWorkspaceStatus = {
  connectionStatus?: string;
  connectionAccount?: string | null;
  gmailConnected?: boolean;
  gmailEnabled?: boolean;
  requiresReauthorization?: boolean;
  runtimeMode?: "simulation" | "workspace";
  simulation?: boolean;
};

const inboxBucketLabels: Record<InboxBucket, string> = {
  inbox: "Inbox",
  intake: "FCI/Intake",
  "needs-review": "FCI/Needs Review",
  filed: "FCI/Filed",
};

function inboxDate(value: string | null) {
  if (!value) return "Date unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type InboxProjectSuggestion = { kind: "project" | "needs-review" | "intake" | "ignored"; text: string; reason: string };

function inboxProjectSuggestion(message: WorkspaceMessage, projects: Project[], clients: Client[], rules: FilingRuleDraft[]): InboxProjectSuggestion {
  const decision = evaluateInboxFilingRules({ message, projects, clients, rules });
  if (decision.kind === "project" && decision.project) return { kind: "project", text: `Suggested by ${decision.ruleName}: ${decision.project.number} — review before filing`, reason: decision.reason };
  if (decision.kind === "needs-review") return { kind: "needs-review", text: `Needs review${decision.ruleName ? ` by ${decision.ruleName}` : ""}: choose the exact independent project`, reason: decision.reason };
  if (decision.kind === "ignored") return { kind: "ignored", text: `No routing by ${decision.ruleName}: Gmail stays unchanged`, reason: decision.reason };
  return { kind: "intake", text: "FCI/Intake: no enabled built-in rule matched; choose a project before filing", reason: decision.reason };
}

function InboxView({ notify, bucket, onBucket, onRules, projects, clients, rules, onGoogleSetup }: { notify: Notify; bucket: InboxBucket; onBucket: (bucket: InboxBucket) => void; onRules: () => void; projects: Project[]; clients: Client[]; rules: FilingRuleDraft[]; onGoogleSetup: () => void }) {
  const [workspace, setWorkspace] = useState<GmailWorkspaceStatus | null>(null);
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [loadedBucket, setLoadedBucket] = useState<InboxBucket | null>(null);
  const [search, setSearch] = useState("");
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [labelReady, setLabelReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filingMessage, setFilingMessage] = useState<WorkspaceMessage | null>(null);
  const [filingProjectId, setFilingProjectId] = useState("");
  const [filingPreview, setFilingPreview] = useState<GmailFilingPreview | null>(null);
  const [filingLoading, setFilingLoading] = useState(false);
  const [filingSubmitting, setFilingSubmitting] = useState(false);
  const [replyMessage, setReplyMessage] = useState<WorkspaceMessage | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replySaving, setReplySaving] = useState(false);
  const [replySignature, setReplySignature] = useState("");

  function checkGmailConnection(force = false) {
    const request = cachedGetJson<{ workspace?: GmailWorkspaceStatus }>("/api/v1/google-workspace", { force });
    void Promise.resolve().then(() => setChecking(true));
    return request.then((data) => {
      setWorkspace(data.workspace ?? null);
      setError(null);
    }).catch((connectionError) => {
      setWorkspace(null);
      setError(connectionError instanceof Error ? connectionError.message : "Google Workspace status could not be checked.");
    }).finally(() => {
      setChecking(false);
    });
  }

  useEffect(() => {
    void checkGmailConnection();
  }, []);

  useEffect(() => {
    void cachedGetJson<{ preferences?: { replySignature?: unknown } }>("/api/v1/settings/me")
      .then((data) => setReplySignature(typeof data?.preferences?.replySignature === "string" ? data.preferences.replySignature.slice(0, 2_000) : ""))
      .catch(() => undefined);
  }, []);

  const gmailReady = workspace?.connectionStatus === "connected" && workspace.gmailEnabled === true && workspace.gmailConnected === true;
  const visibleMessages = loadedBucket === bucket ? messages : [];

  async function loadMessages() {
    setLoading(true);
    setError(null);
    try {
      const parameters = new URLSearchParams({ label: bucket });
      if (search.trim()) parameters.set("q", search.trim());
      const response = await fetch(`/api/v1/integrations/google/gmail/messages?${parameters.toString()}`);
      const data = await response.json().catch(() => ({})) as { messages?: WorkspaceMessage[]; labelReady?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Your Gmail messages could not be loaded.");
      setMessages(data.messages ?? []);
      setLoadedBucket(bucket);
      setLabelReady(Boolean(data.labelReady));
      notify(`Loaded ${data.messages?.length ?? 0} message${(data.messages?.length ?? 0) === 1 ? "" : "s"} from ${inboxBucketLabels[bucket]}.`, "info");
    } catch (loadError) {
      setMessages([]);
      setLoadedBucket(bucket);
      setError(loadError instanceof Error ? loadError.message : "Your Gmail messages could not be loaded.");
      await checkGmailConnection(true);
    } finally {
      setLoading(false);
    }
  }

  async function prepareLabels() {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/integrations/google/gmail/labels/prepare", { method: "POST" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "FCI Gmail labels could not be prepared.");
      setLabelReady(true);
      notify("FCI Gmail labels are ready. No messages were moved or archived.", "success");
      await loadMessages();
    } catch (prepareError) {
      const message = prepareError instanceof Error ? prepareError.message : "FCI Gmail labels could not be prepared.";
      setError(message);
      notify(message, "error");
    } finally {
      setLoading(false);
    }
  }

  function openFilingReview(message: WorkspaceMessage) {
    setFilingMessage(message);
    setFilingProjectId("");
    setFilingPreview(null);
  }

  function closeFilingReview() {
    if (filingLoading || filingSubmitting) return;
    setFilingMessage(null);
    setFilingProjectId("");
    setFilingPreview(null);
  }

  async function previewGmailFiling() {
    if (!filingMessage || !filingProjectId) {
      notify("Choose the exact independent project before reviewing this email filing.", "warning");
      return;
    }
    setFilingLoading(true);
    try {
      const response = await fetch(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(filingMessage.id)}/file?projectId=${encodeURIComponent(filingProjectId)}`);
      const data = await response.json().catch(() => ({})) as GmailFilingPreview & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The Gmail filing preview could not be loaded.");
      setFilingPreview(data);
      notify(`Review the Drive filing for ${data.project.number}. Nothing has been copied yet.`, "info");
    } catch (previewError) {
      setFilingPreview(null);
      notify(previewError instanceof Error ? previewError.message : "The Gmail filing preview could not be loaded.", "error");
    } finally {
      setFilingLoading(false);
    }
  }

  async function confirmGmailFiling() {
    if (!filingMessage || !filingProjectId || !filingPreview) return;
    setFilingSubmitting(true);
    try {
      const response = await fetch(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(filingMessage.id)}/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: filingProjectId }) });
      const data = await response.json().catch(() => ({})) as { filed?: boolean; alreadyFiled?: boolean; archive?: { attachmentCount?: number }; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The Gmail filing could not be completed.");
      notify(data.alreadyFiled ? "This email was already filed to the selected project. Your inbox was left intact." : `Email and ${data.archive?.attachmentCount ?? filingPreview.message.attachmentCount} attachment(s) were copied to the selected project. FCI/Filed was added; Inbox remains intact.`, data.alreadyFiled ? "info" : "success");
      setFilingMessage(null);
      setFilingProjectId("");
      setFilingPreview(null);
      await loadMessages();
    } catch (filingError) {
      notify(filingError instanceof Error ? filingError.message : "The Gmail filing could not be completed.", "error");
    } finally {
      setFilingSubmitting(false);
    }
  }

  function openReplyComposer(message: WorkspaceMessage) {
    setReplyMessage(message);
    setReplyBody(replySignature ? `\n\n${replySignature}` : "");
  }

  function closeReplyComposer() {
    if (replySaving) return;
    setReplyMessage(null);
    setReplyBody("");
  }

  async function saveReplyDraft() {
    if (!replyMessage || !replyBody.trim()) {
      notify("Write a reply before saving a Gmail draft.", "warning");
      return;
    }
    setReplySaving(true);
    try {
      const response = await fetch(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(replyMessage.id)}/reply-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: replyBody }) });
      const data = await response.json().catch(() => ({})) as { draftSaved?: boolean; recipient?: string; error?: string };
      if (!response.ok || !data.draftSaved) throw new Error(data.error ?? "Gmail draft could not be saved.");
      notify(`Reply draft saved in Gmail for ${data.recipient ?? "the original sender"}. It was not sent.`, "success");
      setReplyMessage(null);
      setReplyBody("");
    } catch (replyError) {
      notify(replyError instanceof Error ? replyError.message : "Gmail draft could not be saved.", "error");
    } finally {
      setReplySaving(false);
    }
  }

  const connectionText = workspace?.simulation ? "Local Workspace simulation is ready" : gmailReady ? `Connected Workspace Gmail: ${workspace?.connectionAccount ?? "company mailbox"}` : workspace?.requiresReauthorization ? "Google Workspace needs to be reconnected to approve Gmail access." : "Connect the company Google Workspace account to load messages.";
  return <>
    <PageTitle eyebrow="Gmail intake" title="Gmail project inbox" text="Search the company Gmail mailbox—or safe simulated messages—then review and copy each message to one independent project." state={gmailReady ? "In development" : "Setup required"} action={<div className="title-actions"><button className="soft-button" onClick={onRules}><ListFilter size={15} /> Inbox & file rules</button>{gmailReady ? <button className="soft-button" onClick={() => void loadMessages()} disabled={loading}>{loading ? "Loading…" : <><RefreshCw size={15} /> Refresh</>}</button> : <button className="primary-button" onClick={onGoogleSetup}><Building2 size={15} /> Google setup</button>}</div>} />
    <section className={`inbox-connection inbox-state-strip ${gmailReady ? "ready" : ""}`}><Mail size={18} /><div className="inbox-state-copy"><strong>{gmailReady ? connectionText : "Workspace Gmail connection required"}</strong><span>{workspace?.simulation ? "Sample messages only. No Google account is connected and nothing is sent to Google." : gmailReady ? "Messages load only after your direct action; filing remains review-first and keeps Inbox." : connectionText}</span><span className="inbox-safety-copy"><ShieldCheck size={14} />Suggestions only: {rules.filter((rule) => rule.enabled).length} enabled rules can recommend a destination, but you must choose the exact project and approve every copy.</span></div><div className="inbox-state-actions"><button className="soft-button" onClick={() => void checkGmailConnection(true)} disabled={checking}>{checking ? "Checking…" : "Check connection"}</button><button className="soft-button" onClick={onRules}>Manage rules</button></div></section>
    {error && <p className="workspace-missing">{error}</p>}
    <div className="inbox-layout">
      <section className="panel message-list">
        <header className="live-inbox-toolbar"><div><label>Mailbox<select value={bucket} onChange={(event) => onBucket(event.target.value as InboxBucket)} disabled={loading}><option value="inbox">Inbox</option><option value="intake">FCI/Intake</option><option value="needs-review">FCI/Needs Review</option><option value="filed">FCI/Filed</option></select></label><label>Search this Gmail mailbox<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. from:vendor@example.com" disabled={loading} /></label><small className="gmail-search-help">Use Gmail search terms such as <b>from:</b>, <b>subject:</b>, or a project number.</small></div><div className="workspace-actions">{labelReady === false && bucket !== "inbox" && <button className="soft-button" onClick={() => void prepareLabels()} disabled={loading}>Prepare FCI labels</button>}<button className="primary-button" onClick={() => void loadMessages()} disabled={!gmailReady || loading}>{loading ? "Loading…" : "Load messages"}</button></div></header>
        {!gmailReady ? <div className="inbox-empty"><Mail size={25} /><h2>Connect Workspace Gmail to see the company inbox</h2><p>Until Workspace is available, switch the local app to Workspace simulation to test the full inbox workflow with sample data.</p><button className="primary-button" onClick={onGoogleSetup}>Open Google Workspace setup</button></div> : visibleMessages.length === 0 ? <div className="inbox-empty"><Inbox size={25} /><h2>{loading ? "Loading your inbox…" : "No messages loaded yet"}</h2><p>Choose a mailbox, optionally enter a Gmail search, and use the Load messages button above. The view is limited to 20 message summaries.</p></div> : visibleMessages.map((message, index) => {
          const suggestion = inboxProjectSuggestion(message, projects, clients, rules);
          return <article className="message-row live-message-row" key={message.id}><div className={`sender-dot s${index % 4}`}>{(message.from ?? "?").split(/[\s@<]+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div><div className="message-copy"><strong>{message.from ?? "Unknown sender"}</strong><h3>{message.subject ?? "(No subject)"}</h3><p>{message.snippet || "No preview available."}</p><div className={`inbox-project-suggestion ${suggestion.kind}`} title={suggestion.reason} aria-label={`${suggestion.text}. ${suggestion.reason}`}><ShieldCheck size={13} /> {suggestion.text}</div></div><div className="message-actions"><span>{inboxDate(message.date)}</span><small>{message.to ? `To: ${message.to}` : workspace?.simulation ? "Simulated Workspace mailbox" : "Company Workspace mailbox"}</small><button className="primary-button" onClick={() => openFilingReview(message)}><FolderOpen size={14} /> Review & copy</button><button className="soft-button" onClick={() => openReplyComposer(message)}><Reply size={14} /> Draft reply</button></div></article>;
        })}
      </section>
      <aside className="panel inbox-summary"><div className="summary-icon"><Mail size={20} /></div><h2>Inbox status</h2><p>{gmailReady ? `Showing ${visibleMessages.length} loaded message${visibleMessages.length === 1 ? "" : "s"} from ${inboxBucketLabels[bucket]}.` : "Workspace Gmail is not connected yet."}</p><dl className="inbox-status-list"><div><dt>Provider</dt><dd>{workspace?.simulation ? "Local Workspace simulation" : workspace?.connectionAccount ?? "Not connected"}</dd></div><div><dt>Message limit</dt><dd>20 summaries</dd></div><div><dt>Filing protection</dt><dd>Exact project required</dd></div></dl><hr /><h3>Keep it organized</h3><ul className="inbox-organization"><li>Use only FCI/Intake, FCI/Needs Review, and FCI/Filed labels.</li><li>Use project numbers for the safest match.</li><li>Store the permanent email and attachments in that project’s Shared Drive folder.</li></ul><small>{workspace?.simulation ? "Simulation mode · no Google access" : "Google Workspace mode"}</small><small>Inbox is retained after filing</small></aside>
    </div>
    {filingMessage && <GmailFilingModal message={filingMessage} projects={projects} projectId={filingProjectId} preview={filingPreview} loading={filingLoading} submitting={filingSubmitting} onProject={(projectId) => { setFilingProjectId(projectId); setFilingPreview(null); }} onPreview={previewGmailFiling} onConfirm={confirmGmailFiling} onClose={closeFilingReview} />}
    {replyMessage && <GmailReplyModal message={replyMessage} body={replyBody} saving={replySaving} onBody={setReplyBody} onSave={saveReplyDraft} onClose={closeReplyComposer} />}
  </>;
}

type AssistantCitation = { id: string; label: string; detail: string };

function AssistantView({ projects }: { projects: Project[] }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<{ mode: "ai-grounded" | "records-only"; answer: string; citations: AssistantCitation[]; missingEvidence: string } | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [sourceDetail, setSourceDetail] = useState<AssistantCitation | null>(null);
  const activeProjectId = projects.some((project) => project.id === projectId) ? projectId : projects[0]?.id ?? "";
  async function ask(q?: string) {
    const prompt = q ?? question;
    if (!prompt.trim() || !activeProjectId) return;
    setQuestion(prompt);
    setLoading(true);
    try {
      const response = await fetch("/api/v1/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: prompt, projectId: activeProjectId }) });
      const data = await response.json().catch(() => ({})) as { mode?: "ai-grounded" | "records-only"; answer?: string; citations?: AssistantCitation[]; missingEvidence?: string; error?: string };
      if (!response.ok || !data.answer || !data.citations || !data.mode) throw new Error(data.error ?? "Assistant request failed");
      setAnswer({ mode: data.mode, answer: data.answer, citations: data.citations, missingEvidence: data.missingEvidence ?? "" });
    } catch (error) {
      setAnswer({ mode: "records-only", answer: error instanceof Error ? error.message : "The assistant could not reach its project-record service.", citations: [], missingEvidence: "No answer was generated. Check the selected project and the assistant configuration." });
    } finally {
      setLoading(false);
    }
  }
  return <><PageTitle eyebrow="Project-record assistant" title="Ask FCI Assistant" text="Ask about saved projects, clients, contacts, activity, approved email archives, and meeting notes. Every answer stays within the selected project." state="In development" />
    <div className="assistant-layout"><section className="assistant-main panel"><div className="assistant-hero"><div className="ai-orb"><Bot size={29} /></div><h2>What would you like to know?</h2><p>Choose one project so every answer has a clear, reviewable evidence boundary.</p></div><label className="assistant-project-scope">Project context<select value={activeProjectId} onChange={(event) => { setProjectId(event.target.value); setAnswer(null); }} disabled={!projects.length || loading}><option value="">Choose a project…</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.number} — {project.name}</option>)}</select></label>{!projects.length && <div className="assistant-blocker"><CircleAlert size={18} /><div><strong>Create a project first</strong><span>The assistant answers project-specific questions and needs a project record before it can search evidence.</span></div></div>}{answer && <article className="ai-answer" aria-live="polite"><div><Sparkles size={18} /><strong>{answer.mode === "ai-grounded" ? "AI-grounded answer" : "Project-record summary"}</strong><span className="assistant-mode">{answer.mode === "ai-grounded" ? "OpenAI enabled" : "Records-only mode"}</span></div><p>{answer.answer}</p>{answer.missingEvidence && <p className="assistant-missing"><CircleAlert size={14} /> {answer.missingEvidence}</p>}<h4>Sources</h4>{answer.citations.length ? answer.citations.map((citation, index) => <button key={citation.id} onClick={() => setSourceDetail(citation)}><FileText size={14} /><span>[{index + 1}] {citation.label}</span><ChevronRight size={14} /></button>) : <p className="source-empty">No verified sources were returned for this answer.</p>}</article>}<form className="ask-box" onSubmit={(event) => { event.preventDefault(); void ask(); }}><div><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about the selected project record…" aria-label="Ask FCI Assistant" maxLength={2000} disabled={!projects.length || loading} /><button disabled={loading || !question.trim() || !activeProjectId} aria-label="Send question">{loading ? <span className="spinner" /> : <Send size={18} />}</button></div><small><Sparkles size={12} /> Every answer is read-only and cites only server-selected project evidence.</small></form></section><aside className="panel recent-questions"><h3>Suggested questions</h3>{["What is the current project status?", "Who is the primary contact?", "How many email archives are linked?", "What evidence has not been captured yet?"].map((q) => <button key={q} onClick={() => void ask(q)} disabled={loading || !activeProjectId}><MessageSquareText size={15} /><span>{q}<small>Selected project only</small></span></button>)}<div className="privacy-note"><CheckCircle2 size={17} /><p><strong>Office-record scope</strong><br />This first version uses the operational records available to approved office users. Project-specific permissions are the next access-control layer.</p></div></aside></div>
    {sourceDetail && <SourceDetailModal citation={sourceDetail} onClose={() => setSourceDetail(null)} />}
  </>;
}

function ReportBarRow({ label, measure, width, href, accessibleName, focusId, destinationFocusKey }: { label: string; measure: string; width: number; href?: string; accessibleName?: string; focusId?: string; destinationFocusKey?: string }) {
  const content = <><span className="bar-chart-label">{label}</span><span className="bar-chart-track" aria-hidden="true"><i style={{ width: `${width}%` }} /></span><strong>{measure}</strong>{href ? <ChevronRight className="bar-chart-chevron" size={16} aria-hidden="true" /> : <span className="bar-chart-spacer" aria-hidden="true" />}</>;
  return <li>{href && accessibleName && focusId && destinationFocusKey ? <Link id={focusId} className="bar-chart-row actionable" href={href} aria-label={accessibleName} onClick={() => rememberReportReturnFocus(focusId, destinationFocusKey)}>{content}</Link> : <div className="bar-chart-row">{content}</div>}</li>;
}

function ReportsView({ leads, projects, clients, dashboard, state, isAdmin }: { leads: Lead[]; projects: Project[]; clients: Client[]; dashboard: DashboardSummary | null; state: LiveDataState; isAdmin: boolean }) {
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
  const metrics = dashboard?.metrics;
  const activeProjectCount = metrics?.activeProjects ?? projects.filter(isActiveProject).length;

  useEffect(() => {
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
  }, [activeLeads.length, projectStatuses.length, state]);

  return <>
    <PageTitle eyebrow="Business performance" title="Reports" text="Current totals from saved leads, clients, projects, and meeting notes." state="Working" />
    <section className="metrics-grid"><Metric label="Pipeline value" value={state !== "ready" ? "—" : isAdmin ? money(metrics?.estimatedPipelineValue ?? 0) : FINANCIAL_RESTRICTION_LABEL} note={state !== "ready" ? "Loading current totals" : isAdmin ? `${metrics?.activeLeads ?? activeLeads.length} active leads` : "Financial totals are restricted"} icon={Zap} color="orange" /><Metric label="Active projects" value={state === "ready" ? String(activeProjectCount) : "—"} note={state === "ready" ? `${activeProjectCount} of ${projects.length} project records active` : "Loading current totals"} icon={BriefcaseBusiness} color="green" /><Metric label="Clients" value={state === "ready" ? String(metrics?.clientCount ?? clients.length) : "—"} note={state === "ready" ? "Client accounts" : "Loading current totals"} icon={Users} color="blue" /><Metric label="Project meetings" value={state === "ready" ? String(metrics?.meetingCount ?? 0) : "—"} note={state === "ready" ? "Meeting notes saved" : "Loading current totals"} icon={MessageSquareText} color="violet" /></section>
    <BusinessKpisPanel leads={leads} projects={projects} isAdmin={isAdmin} state={state} />
    <div className="reports-grid">
      <section className="panel report-chart"><PanelHeader title="Pipeline by stage" subtitle={isAdmin ? "Estimated value" : "Lead count · financial values restricted"} />{activeLeads.length > 0 ? <ul className="bar-chart" aria-label="Pipeline stages">{stageValues.map((item) => { const href = item.count > 0 ? operationsHref("Leads", { leadStage: item.filter }) : undefined; const focusId = href ? `report-lead-${item.filter}` : undefined; const measure = isAdmin ? money(item.value) : String(item.count); return <ReportBarRow key={item.stage} label={item.stage} measure={measure} width={Math.round(((isAdmin ? item.value : item.count) / maximumStageMeasure) * 100)} href={href} focusId={focusId} destinationFocusKey={href ? `lead:${item.filter}` : undefined} accessibleName={href ? `View ${item.stage} leads — ${item.count} active ${item.count === 1 ? "lead" : "leads"}${isAdmin ? `, ${money(item.value)} estimated value` : ""}` : undefined} />; })}</ul> : state === "ready" ? <div className="empty-table">No active leads are available for this report.</div> : null}</section>
      <section className="panel report-chart"><PanelHeader title="Projects by status" subtitle={`${projects.length} records`} />{projectStatuses.length > 0 ? <ul className="bar-chart" aria-label="Project lifecycle statuses">{projectStatuses.map((item) => { const lifecycle = projectLifecycleFilter(item.status); const href = lifecycle && item.count > 0 ? operationsHref("Projects", { projectLifecycle: lifecycle }) : undefined; const label = displayStatus(item.status, "Unknown"); const focusId = href ? `report-project-${lifecycle}` : undefined; return <ReportBarRow key={item.status} label={label} measure={String(item.count)} width={Math.round((item.count / maximumProjectCount) * 100)} href={href} focusId={focusId} destinationFocusKey={href ? `project:${lifecycle}` : undefined} accessibleName={href ? `View ${label} projects — ${item.count} ${item.count === 1 ? "project" : "projects"}` : undefined} />; })}</ul> : state === "ready" ? <div className="empty-table">No project status data is available yet.</div> : null}</section>
    </div>
    <section className="client-directory-banner"><div className="directory-badge"><Activity size={20} /></div><div><strong>More reports will appear as additional workflows go live</strong><span>Margin, product mix, installation-cycle timing, customer reviews, and crew utilization require source records that are not available yet.</span></div></section>
  </>;
}

function SettingsView({ notify, section, onSection, onTimezoneChange, rules, projects, userName, userEmail, isAdmin, onGoogleSetup, onAddRule, onUpdateRule, onDeleteRule, sheetMirror, onSyncGoogleSheet, syncingSheet }: { notify: Notify; section: SettingsSection; onSection: (section: SettingsSection) => void; onTimezoneChange: (timezone: string) => void; rules: FilingRuleDraft[]; projects: Project[]; userName: string; userEmail: string; isAdmin: boolean; onGoogleSetup: () => void; onAddRule: () => void; onUpdateRule: (rule: FilingRuleDraft, patch: Partial<Pick<FilingRuleDraft, "enabled" | "priority">>) => Promise<void>; onDeleteRule: (rule: FilingRuleDraft) => Promise<void>; sheetMirror: SheetMirrorStatus | null; onSyncGoogleSheet: () => Promise<void>; syncingSheet: boolean }) {
  return <><PageTitle eyebrow="Control center" title="Settings" text="Keep account preferences, one Google Workspace connection, inbox rules, calendar defaults, and safeguards in one simple place." state="In development" />
    <div className="settings-layout"><aside className="settings-nav panel">{SETTINGS_SECTIONS.map((option) => <button className={section === option ? "active" : ""} aria-current={section === option ? "page" : undefined} key={option} onClick={() => onSection(option)}>{option}<ChevronRight size={15} /></button>)}</aside>
      {section === "My account" && <MyAccountPanel notify={notify} userName={userName} userEmail={userEmail} onGoogleSetup={onGoogleSetup} onTimezoneChange={onTimezoneChange} />}
      {section === "Google Workspace" && <GoogleWorkspacePanel notify={notify} projects={projects} isAdmin={isAdmin} />}
      {section === "Calendar & appointments" && <WorkspaceDefaultsPanel mode="calendar" notify={notify} onGoogleSetup={onGoogleSetup} isAdmin={isAdmin} />}
      {section === "Inbox & file rules" && <InboxRulesPanel rules={rules} onAddRule={onAddRule} onUpdateRule={onUpdateRule} onDeleteRule={onDeleteRule} />}
      {section === "Client Directory" && <DirectorySyncPanel mirror={sheetMirror} syncing={syncingSheet} onSync={onSyncGoogleSheet} onConfigure={() => { onSection("Google Workspace"); notify("Open the Workspace checklist to connect Google Sheets", "info"); }} isAdmin={isAdmin} />}
      {section === "Workflow & notifications" && <WorkspaceDefaultsPanel mode="workflow" notify={notify} onGoogleSetup={onGoogleSetup} isAdmin={isAdmin} />}
      {section === "Data & security" && <DataSecurityPanel />}
      {section === "Testing & launch" && <TestingLaunchPanel onGoogleSetup={() => onSection("Google Workspace")} />}
    </div></>;
}

function GmailReplyModal({ message, body, saving, onBody, onSave, onClose }: { message: WorkspaceMessage; body: string; saving: boolean; onBody: (value: string) => void; onSave: () => void; onClose: () => void }) {
  return <AccessibleOverlay ariaLabel="Save a Gmail reply draft" contentClassName="modal gmail-reply-modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">Workspace Gmail draft</p><h2>Save a reply draft</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={(event) => { event.preventDefault(); onSave(); }}><div className="modal-detail"><div className="filing-message-summary"><Mail size={17} /><div><strong>{message.subject || "(No subject)"}</strong><span>Reply target: {message.from || "original sender"}</span></div></div><label>Reply message<textarea data-overlay-initial-focus value={body} onChange={(event) => onBody(event.target.value)} placeholder="Write your reply…" maxLength={6000} required disabled={saving} /></label><p className="form-help"><ShieldCheck size={14} /> Live mode saves an unsent draft in the original Workspace Gmail thread. Simulation stores a local draft only. Sending remains a separate, deliberate action.</p></div><footer className="modal-footer"><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !body.trim()}>{saving ? "Saving…" : <><Reply size={16} /> Save draft</>}</button></footer></form></AccessibleOverlay>;
}

function SourceDetailModal({ citation, onClose }: { citation: AssistantCitation; onClose: () => void }) {
  return <AccessibleOverlay ariaLabel="Assistant evidence reference" contentClassName="modal" onClose={onClose}><header><div><p className="eyebrow">Assistant source</p><h2>Evidence reference</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="modal-detail"><strong>{citation.label}</strong><p>{citation.detail}</p><p>This is a server-selected project record reference. Meeting notes use saved summaries, decisions, action items, notes, and bounded transcript excerpts. Raw Gmail bodies and Drive files are not returned yet.</p></div><footer className="modal-footer"><button className="primary-button" onClick={onClose} data-overlay-initial-focus>Done</button></footer></AccessibleOverlay>;
}

function LeadModal({ onClose, onSave }: { onClose: () => void; onSave: (l: Lead) => Promise<void> }) { const [saving, setSaving] = useState(false); async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setSaving(true); const form = new FormData(e.currentTarget); const company = String(form.get("company")); const estimatedValue = Number(form.get("value") ?? 0); try { await onSave({ id: "", number: "", company, contact: String(form.get("contact")), project: String(form.get("project")), value: money(estimatedValue), estimatedValue, stage: "New inquiry", source: String(form.get("source")), next: String(form.get("notes")), site: String(form.get("site")), status: "active", initials: recordInitials(company), color: "sage" }); } finally { setSaving(false); } }
  return <AccessibleOverlay ariaLabel="Add a lead" contentClassName="modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">New opportunity</p><h2>Add a lead</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}><label>Client company<input data-overlay-initial-focus name="company" required placeholder="Business name" /></label><div className="form-row"><label>Primary contact<input name="contact" required placeholder="Full name" /></label><label>Lead source<select name="source"><option>Website</option><option>Referral</option><option>Bid invite</option><option>Repeat client</option></select></label></div><label>Project / opportunity<input name="project" required placeholder="Project name" /></label><div className="form-row"><label>Estimated value<input name="value" type="number" min="0" step="1" required placeholder="Estimated amount" /></label><label>Project site<input name="site" required placeholder="Address or city and state" /></label></div><label>Next action<textarea name="notes" required placeholder="What needs to happen next?" /></label><footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add to pipeline"}</button></footer></form></AccessibleOverlay>;
}

function ClientModal({ onClose, onSave }: { onClose: () => void; onSave: (client: Client) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); const name = String(form.get("name")); try { await onSave({ id: "", code: "", name, contact: String(form.get("contact")), email: String(form.get("email")), industry: String(form.get("industry")), status: String(form.get("status")), initials: recordInitials(name), color: "sage", googleStatus: "Setup pending" }); } finally { setSaving(false); } }
  return <AccessibleOverlay ariaLabel="Add a client" contentClassName="modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">Client Directory</p><h2>Add a client</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}><label>Client business name<input data-overlay-initial-focus name="name" required placeholder="Business name" /></label><div className="form-row"><label>Primary contact<input name="contact" required placeholder="Full name" /></label><label>Work email<input name="email" type="email" required placeholder="name@company.com" /></label></div><div className="form-row"><label>Industry<select name="industry"><option>General contractor</option><option>Healthcare</option><option>Retail</option><option>Hospitality</option><option>Property management</option><option>Other commercial</option></select></label><label>Client status<select name="status"><option>Active</option><option>Prospect</option><option>Inactive</option></select></label></div><p className="form-help"><FolderTree size={14} /> The app saves the client first, then syncs the Client Directory when Google Sheets is connected. The account folder is created with the first project workspace.</p><footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add client"}</button></footer></form></AccessibleOverlay>;
}

function NewProjectModal({ clients, initialClientId, managerId, managerLabel, onClose, onSave }: { clients: Client[]; initialClientId: string | null; managerId: string; managerLabel: string; onClose: () => void; onSave: (project: Project) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); const clientId = String(form.get("clientId")); const client = clients.find((item) => item.id === clientId); if (!client) { setSaving(false); return; } const name = String(form.get("name")); const estimatedValue = form.get("value") ? Number(form.get("value")) : null; try { await onSave({ id: "", clientId, number: "", client: client.name, name, status: String(form.get("status")), progress: 0, value: estimatedValue === null ? "TBD" : money(estimatedValue), estimatedValue, site: String(form.get("site")), managerId, lead: projectManagerLabel(managerId, managerId, managerLabel), date: "Not scheduled", accent: client.color }); } finally { setSaving(false); } }
  const selectedClientId = initialClientId && clients.some((client) => client.id === initialClientId) ? initialClientId : clients[0]?.id ?? "";
  return <AccessibleOverlay ariaLabel="Create a project" contentClassName="modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">Independent project</p><h2>Create a project</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}><label>Client<select data-overlay-initial-focus name="clientId" required defaultValue={selectedClientId} disabled={clients.length === 0}>{clients.length === 0 && <option value="">Create a client first</option>}{clients.map((client) => <option value={client.id} key={client.id}>{client.name} · {client.code}</option>)}</select></label><label>Project name<input name="name" required placeholder="Project name" /></label><div className="form-row"><label>Site<input name="site" required placeholder="Address or city and state" /></label><div className="assigned-manager-field" aria-label={`Project manager: ${managerLabel}, signed-in account`}><span>Project manager</span><strong>{managerLabel}</strong><small>{managerId} · signed-in account</small></div></div><div className="form-row"><label>Status<select name="status"><option>Planning</option><option>Mobilizing</option><option>Installation</option><option>Closeout</option></select></label><label>Estimated value<input name="value" type="number" min="0" placeholder="Estimated amount" /></label></div><p className="form-help"><ShieldCheck size={14} /> The project is assigned to your authorized signed-in account. An administrator can correct an unassigned legacy project from its project drawer.</p><p className="form-help"><FolderTree size={14} /> This creates an independent project number and Project Register row. Create its Drive folder from the project after saving.</p><footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving || clients.length === 0}>{saving ? "Creating…" : clients.length === 0 ? "Add a client first" : "Create project"}</button></footer></form></AccessibleOverlay>;
}

function LeadDrawer({ lead, onClose, onAdvance, returnFocusRef }: { lead: Lead; onClose: () => void; onAdvance: (id: string) => Promise<void>; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const [advancing, setAdvancing] = useState(false);
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

  return <AccessibleOverlay variant="drawer" ariaLabel={`${lead.number} ${lead.company}`} contentClassName="project-drawer lead-drawer" onClose={onClose} busy={advancing} returnFocusRef={returnFocusRef}>
    <header><button data-overlay-initial-focus onClick={onClose} aria-label="Close lead details" disabled={advancing}><X size={20} /></button><Status text={lead.stage} /><span>{lead.number}</span></header>
    <div className="drawer-title"><p>Lead opportunity</p><h2>{lead.company}</h2><div><span><BriefcaseBusiness size={14} />{lead.project}</span><span><MapPin size={14} />{lead.site}</span></div></div>
    <div className="drawer-body">
      <div className="drawer-stats"><div><span>Estimated value</span><strong>{lead.value}</strong></div><div><span>Stage</span><strong>{lead.stage}</strong></div><div><span>Primary contact</span><strong>{lead.contact}</strong></div><div><span>Lead source</span><strong>{lead.source}</strong></div></div>
      <section className="lead-next-action"><h3>Next action</h3><p><Clock3 size={15} />{lead.next}</p></section>
      <section className="lead-record-note"><ShieldCheck size={16} /><p>This drawer is read-only. Stage changes remain a separate deliberate action and can be undone from the confirmation message.</p></section>
    </div>
    <footer><button type="button" className="soft-button" onClick={onClose} disabled={advancing}>Close</button>{canAdvance && <button type="button" className="primary-button" onClick={() => void handleAdvance()} disabled={advancing}>{advancing ? "Advancing…" : <><span>Advance stage</span><ChevronRight size={16} /></>}</button>}</footer>
  </AccessibleOverlay>;
}

function ProjectDrawer({ project, onClose, notify, onProvisionDrive, onAssignToMe, canAssignManager, currentUserEmail, returnFocusRef }: { project: Project; onClose: () => void; notify: Notify; onProvisionDrive: (project: Project) => Promise<void>; onAssignToMe: (project: Project) => Promise<void>; canAssignManager: boolean; currentUserEmail: string; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const [tab, setTab] = useState<"Overview" | "Meetings">("Overview");
  const [provisioning, setProvisioning] = useState(false);
  const [assigningManager, setAssigningManager] = useState(false);
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

  return <AccessibleOverlay variant="drawer" ariaLabel={`${project.number} ${project.name}`} contentClassName="project-drawer" onClose={onClose} busy={busy} returnFocusRef={returnFocusRef}>
      <header><button data-overlay-initial-focus onClick={onClose} aria-label="Close project" disabled={busy}><X size={20} /></button><Status text={project.status} /><span>{project.number}</span></header>
      <div className="drawer-title"><p>{project.client}</p><h2>{project.name}</h2><div><span><MapPin size={14} />{project.site}</span><span><CalendarDays size={14} />{project.date}</span></div></div>
      <nav aria-label="Available project views">{(["Overview", "Meetings"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
      <div className="drawer-body">
        {tab === "Overview" ? <>
          <section className="project-health"><div><span>Delivery progress</span><strong>Not tracked yet</strong></div><p><CheckCircle2 size={15} /> This live project is managed independently from other client work</p></section>
          <div className="drawer-stats"><div><span>Estimated value</span><strong>{project.value}</strong></div><div className="project-manager-stat"><span>Project manager</span><strong>{project.lead}</strong>{project.managerId === currentUserEmail ? <small>Assigned to your signed-in account</small> : canAssignManager ? <button className="manager-assignment-button" onClick={() => void handleAssignToMe()} disabled={assigningManager}>{assigningManager ? "Assigning…" : "Assign to me"}</button> : project.managerId ? <small>Authorized office account</small> : <small>No authorized manager is assigned</small>}</div><div><span>Meetings</span><strong>Working</strong></div><div><span>Drive folder</span><strong>{project.driveFolderId ? "Ready" : "Setup required"}</strong></div></div>
          <section className="project-capability-plan"><header><div><h3>Planned project capabilities</h3><p>These items are informational and are not available as controls yet.</p></div><FeatureStateBadge state="Planned" /></header><ul><li>Durable tasks and follow-ups</li><li>Indexed project files beyond the working Drive folder link</li><li>Crews, shifts, and field schedule</li><li>Project activity feed and outbound updates</li></ul></section>
        </> : <ProjectMeetings project={project} notify={notify} />}
      </div>
      <footer>
        <span className="planned-project-updates"><FeatureStateBadge state="Planned" /> Project updates</span>
        <button className="soft-button" onClick={handleDrive} disabled={busy}><FolderOpen size={16} /> {provisioning ? "Creating folder…" : project.driveUrl ? "Open Drive folder" : "Create Drive folder"}</button>
      </footer>
  </AccessibleOverlay>;
}

function meetingDateInputValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatMeetingDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

async function fetchProjectMeetings(projectId: string) {
  const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/meetings`);
  const data = await response.json().catch(() => ({})) as { meetings?: ProjectMeeting[]; error?: string };
  if (!response.ok) throw new Error(data.error ?? "Meeting notes could not be loaded.");
  return data.meetings ?? [];
}

function ProjectMeetings({ project, notify }: { project: Project; notify: Notify }) {
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
    setMeetings((current) => [meeting, ...current]);
    setAdding(false);
    notify(`${meeting.title} saved to ${project.number}`, "success");
  }

  return <section className="project-meetings">
    <header className="meeting-section-header"><div><p className="eyebrow">Project knowledge</p><h3>Meeting notes</h3><span>Link Otter, paste its summary or transcript, and keep decisions with this independent project.</span></div><button className="primary-button" onClick={() => setAdding(true)}><Plus size={15} /> Add meeting</button></header>
    <div className="meeting-capture-guide"><MessageSquareText size={18} /><div><strong>Recommended Otter workflow</strong><span>Copy the private Otter conversation link, paste the Summary and Action Items, then add the exported transcript when the record needs full searchable detail.</span></div></div>
    {loading ? <div className="meeting-empty"><RefreshCw size={21} /><strong>Loading project meetings…</strong></div> : error ? <div className="meeting-empty error"><CircleAlert size={21} /><strong>{error}</strong><button className="soft-button" onClick={() => void loadMeetings()}>Try again</button></div> : meetings.length === 0 ? <div className="meeting-empty"><MessageSquareText size={24} /><strong>No meeting notes yet</strong><span>Add a client meeting, site walk, internal huddle, pre-install meeting, or closeout review.</span><button className="soft-button" onClick={() => setAdding(true)}><Plus size={14} /> Capture the first meeting</button></div> : <div className="meeting-list">{meetings.map((meeting) => <article className="meeting-card" key={meeting.id}>
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
    <div className="form-row"><label>Date and time<input name="meetingAt" type="datetime-local" required defaultValue={meetingDateInputValue()} /></label><label>Meeting type<select name="meetingType" defaultValue="client"><option value="client">Client meeting</option><option value="site-walk">Site walk</option><option value="internal">Internal huddle</option><option value="pre-install">Pre-install meeting</option><option value="closeout">Closeout review</option><option value="other">Other</option></select></label></div>
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

function ClientDrawer({ client, projects, onClose, onNewProject, onProject, returnFocusRef }: { client: Client; projects: Project[]; onClose: () => void; onNewProject: () => void; onProject: (project: Project) => void; returnFocusRef?: RefObject<HTMLElement | null> }) { return <AccessibleOverlay variant="drawer" ariaLabel={`${client.name} client account`} contentClassName="project-drawer client-drawer" onClose={onClose} returnFocusRef={returnFocusRef}><header><button data-overlay-initial-focus onClick={onClose} aria-label="Close client"><X size={20} /></button><Status text={client.status} /><span>{client.code}</span></header><div className="drawer-title"><p>Client account</p><h2>{client.name}</h2><div><span><ContactRound size={14} />{client.contact}</span><span><Mail size={14} />{client.email || "Contact email pending"}</span></div></div><div className="client-drawer-body"><section className="client-account-card"><div className="directory-badge"><FolderTree size={19} /></div><div><strong>Client account folder</strong><span>{client.driveUrl ? "Google Drive folder ready" : "Google Drive folder not created yet"}</span></div></section><div className="client-summary-grid"><div><span>Industry</span><strong>{client.industry}</strong></div><div><span>Independent projects</span><strong>{projects.length}</strong></div></div><section className="client-project-section"><header><h3>Projects for this client</h3><button onClick={onNewProject}><Plus size={14} /> New project</button></header>{projects.map((project) => <button type="button" className="client-project-link" key={project.id} onClick={() => onProject(project)}><div><Status text={project.status} /><strong>{project.name}</strong><span>{project.number} · {project.site}</span></div><ChevronRight size={16} /></button>)}{!projects.length && <p className="empty-client-projects">No projects yet. Create the first independent project for this client.</p>}</section><section className="client-account-notes"><h3>Account-level documents</h3><p>Store reusable client documents here. Project-specific documents stay inside their own project folders.</p></section></div></AccessibleOverlay>; }
