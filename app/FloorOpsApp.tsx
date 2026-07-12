"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Bell, Bot, BriefcaseBusiness, Building2, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CircleAlert, CircleCheckBig, Clipboard, Clock3, ContactRound, ExternalLink, FileText, FolderOpen, FolderTree, HardHat,
  Inbox, LayoutDashboard, ListTodo, Mail, MapPin, Menu, MessageSquareText, MoreHorizontal,
  ListFilter, LogOut, Plus, RefreshCw, Reply, Search, Send, Settings, ShieldCheck, Sparkles, Trash2, Users, X, Zap,
} from "lucide-react";
import { DEFAULT_FILING_RULES, DRIVE_BLUEPRINT, evaluateInboxFilingRules, type FilingRuleDraft } from "./lib/google-workspace";
import { PhoneInstallPanel } from "./PhoneInstallPanel";

type View = "Overview" | "Leads" | "Clients" | "Projects" | "Schedule" | "Inbox" | "AI Assistant" | "Reports" | "Settings";
type Lead = { id: string; number: string; company: string; contact: string; project: string; value: string; estimatedValue: number; stage: string; source: string; next: string; site: string; status: string; initials: string; color: string };
type Client = { id: string; code: string; name: string; contact: string; email: string; industry: string; status: string; initials: string; color: string; googleStatus: "Ready" | "Setup pending"; driveFolderId?: string; driveUrl?: string };
type Project = { id: string; clientId: string; number: string; client: string; name: string; status: string; progress: number; value: string; site: string; lead: string; date: string; accent: string; driveFolderId?: string; driveUrl?: string };
type DashboardSummary = {
  generatedAt: number;
  metrics: { activeLeads: number; estimatedPipelineValue: number; activeProjects: number; clientCount: number; meetingCount: number; filedEmailCount: number };
  projectsByStatus: Array<{ status: string; count: number }>;
  recentActivity: Array<{ id: string; action: string; detail: string | null; actor: string; created_at: number }>;
  readiness: { scheduleDataAvailable: boolean; scheduleReason: string; reportsUseLiveProjectLeadTotals: boolean };
};
type LiveDataState = "loading" | "ready" | "error";
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
type ProjectUpdateDraft = { project: Project; subject: string; message: string };
type WorkspaceSearchResult = { kind: "client" | "project" | "contact"; id: string; title: string; subtitle: string; clientId?: string; projectId?: string };

const leadStages = ["New inquiry", "Site visit", "Proposal", "Decision"];

const navItems: { label: View; icon: typeof LayoutDashboard }[] = [
  { label: "Overview", icon: LayoutDashboard }, { label: "Leads", icon: Zap },
  { label: "Clients", icon: ContactRound }, { label: "Projects", icon: BriefcaseBusiness }, { label: "Schedule", icon: CalendarDays },
  { label: "Inbox", icon: Inbox }, { label: "AI Assistant", icon: Sparkles },
  { label: "Reports", icon: Activity }, { label: "Settings", icon: Settings },
];

function recordInitials(value: string) {
  return value.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "FC";
}

function displayStatus(value: unknown, fallback: string) {
  const status = String(value ?? "").trim();
  return status ? status.split(/[-_\s]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ") : fallback;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function FloorOpsApp({ userName, userEmail, signOutHref }: { userName: string; userEmail: string; signOutHref: string }) {
  const [view, setView] = useState<View>("Overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [leadModal, setLeadModal] = useState(false);
  const [clientModal, setClientModal] = useState(false);
  const [projectModal, setProjectModal] = useState(false);
  const [ruleModal, setRuleModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projectItems, setProjectItems] = useState<Project[]>([]);
  const [filingRules, setFilingRules] = useState<FilingRuleDraft[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [liveDataState, setLiveDataState] = useState<LiveDataState>("loading");
  const [liveDataError, setLiveDataError] = useState("");
  const [settingsArea, setSettingsArea] = useState("Inbox & file rules");
  const [toast, setToast] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [projectUpdate, setProjectUpdate] = useState<Project | null>(null);
  const [sheetMirror, setSheetMirror] = useState<SheetMirrorStatus | null>(null);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const firstName = userName.includes("@") ? "there" : userName.split(" ")[0];
  const userInitials = userName.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "FC";

  const refreshDirectoryData = useCallback(async () => {
    setLiveDataState("loading");
    setLiveDataError("");
    try {
      async function getJson(path: string) {
        const response = await fetch(path, { headers: { Accept: "application/json" } });
        const data = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Live data request failed (${response.status}).`);
        return data;
      }
      const [leadData, clientData, projectData, dashboardData, ruleData, mirrorData] = await Promise.all([
        getJson("/api/v1/leads"),
        getJson("/api/v1/clients"),
        getJson("/api/v1/projects"),
        getJson("/api/v1/dashboard"),
        getJson("/api/v1/filing-rules"),
        getJson("/api/v1/integrations/google/sheets/status"),
      ]);
      const leadRows = Array.isArray(leadData.leads) ? leadData.leads as Record<string, unknown>[] : [];
      const clientRows = Array.isArray(clientData.clients) ? clientData.clients as Record<string, unknown>[] : [];
      const projectRows = Array.isArray(projectData.projects) ? projectData.projects as Record<string, unknown>[] : [];
      const ruleRows = Array.isArray(ruleData.rules) ? ruleData.rules as Record<string, unknown>[] : [];
      setLeads(leadRows.map((lead) => {
        const estimatedValue = Number(lead.estimatedValue ?? 0);
        return { id: String(lead.id), number: String(lead.leadNumber ?? "Lead"), company: String(lead.company), contact: String(lead.contactName), project: String(lead.projectName), value: money(estimatedValue), estimatedValue, stage: String(lead.stage), source: String(lead.source), next: String(lead.nextAction), site: String(lead.site), status: String(lead.status), initials: recordInitials(String(lead.company)), color: "sage" };
      }));
      setClients(clientRows.map((client) => ({ id: String(client.id), code: String(client.client_code), name: String(client.name), contact: String(client.primary_contact_name ?? "Primary contact pending"), email: String(client.primary_contact_email ?? ""), industry: String(client.industry ?? "Commercial"), status: displayStatus(client.status, "Active"), initials: recordInitials(String(client.name)), color: "sage", googleStatus: client.drive_folder_id ? "Ready" as const : "Setup pending" as const, driveFolderId: client.drive_folder_id ? String(client.drive_folder_id) : undefined, driveUrl: client.drive_url ? String(client.drive_url) : undefined })));
      setProjectItems(projectRows.map((project) => ({ id: String(project.id), clientId: String(project.client_id), number: String(project.project_number), client: String(project.client_name), name: String(project.name), status: displayStatus(project.status, "Planning"), progress: 0, value: project.estimated_value !== null && project.estimated_value !== undefined ? money(Number(project.estimated_value)) : "TBD", site: String(project.site ?? "Site pending"), lead: String(project.project_manager ?? "Unassigned"), date: "Dates not set", accent: "sage", driveFolderId: project.drive_folder_id ? String(project.drive_folder_id) : undefined, driveUrl: project.drive_url ? String(project.drive_url) : undefined })));
      setDashboard(dashboardData as unknown as DashboardSummary);
      setFilingRules(ruleRows.map((rule) => ({ id: rule.id ? String(rule.id) : undefined, name: String(rule.name), enabled: Boolean(rule.enabled), priority: Number(rule.priority), matchSummary: String(rule.matchSummary ?? rule.match_summary), action: String(rule.action) as FilingRuleDraft["action"], targetCategory: String(rule.targetCategory ?? rule.target_category), approvalRequired: Boolean(rule.approvalRequired ?? rule.approval_required) })));
      setSheetMirror(mirrorData.mirror ? mirrorData.mirror as SheetMirrorStatus : null);
      setLiveDataState("ready");
    } catch (error) {
      setLiveDataState("error");
      setLiveDataError(error instanceof Error ? error.message : "Live application data could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const refresh = window.setTimeout(() => { void refreshDirectoryData(); }, 0);
    return () => window.clearTimeout(refresh);
  }, [refreshDirectoryData]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNav(false);
        setWorkspaceMenuOpen(false);
        setProfileMenuOpen(false);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("workspace-search")?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function notify(message: string) {
    if (message === "Google Drive folder will open after Workspace setup") {
      openGoogleWorkspace();
      return;
    }
    if (message === "Project update composer opened") {
      setProjectOpen(false);
      if (selectedProject) setProjectUpdate(selectedProject);
      return;
    }
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function addLead(lead: Lead) {
    try {
      const response = await fetch("/api/v1/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: lead.company, contactName: lead.contact, projectName: lead.project, source: lead.source, stage: lead.stage, site: lead.site, estimatedValue: lead.estimatedValue, nextAction: lead.next, status: "active" }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Lead could not be saved.");
      await refreshDirectoryData();
      setLeadModal(false);
      notify(`${lead.company} added to your live pipeline`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Lead could not be saved.");
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
      notify(data.sheetSync?.message ?? `${client.name} saved in FCI Operations`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Client could not be saved.");
    }
  }

  async function addProject(project: Project) {
    try {
      const response = await fetch("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: project.clientId, name: project.name, status: project.status.toLowerCase(), site: project.site, projectManager: project.lead, estimatedValue: Number(project.value.replace(/[^0-9]/g, "")) || undefined }) });
      const errorData = await response.clone().json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(errorData.error ?? "Project could not be saved.");
      const data = await response.json() as { id: string; projectNumber: string; sheetSync?: { status?: string; message?: string } };
      await refreshDirectoryData();
      setProjectModal(false);
      notify(data.sheetSync?.message ?? `${project.name} saved in FCI Operations`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Project could not be saved.");
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
      notify(`Google Sheet synced: ${data.result?.clients?.total ?? 0} clients and ${data.result?.projects?.total ?? 0} projects`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Google Sheet sync could not be completed.");
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
      notify(data.created ? `${project.name} now has a ${data.environment ?? "test"} Drive workspace` : `${project.name} already has a Drive workspace`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The project Drive workspace could not be created.");
    }
  }

  async function addRule(rule: FilingRuleDraft) {
    try {
      const response = await fetch("/api/v1/filing-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule) });
      const data = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? "Rule could not be saved.");
      setFilingRules((current) => [...current, { ...rule, id: data.id }].sort((a, b) => a.priority - b.priority));
      setRuleModal(false);
      notify(`Email rule “${rule.name}” added`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Rule could not be saved.");
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
        notify(`Email rule “${rule.name}” ${patch.enabled === false ? "paused" : "updated"}`);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Rule could not be updated.");
      }
      return;
    }
    try {
      const response = await fetch(`/api/v1/filing-rules/${encodeURIComponent(rule.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Rule could not be updated.");
      setFilingRules((current) => current.map((item) => item.id === rule.id ? { ...item, ...patch } : item).sort((left, right) => left.priority - right.priority));
      notify(`Email rule “${rule.name}” ${patch.enabled === false ? "paused" : "updated"}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Rule could not be updated.");
    }
  }

  async function deleteRule(rule: FilingRuleDraft) {
    if (!rule.id) {
      notify("Starter rules stay available for reference. Add custom rules to manage your own routing.");
      return;
    }
    try {
      const response = await fetch(`/api/v1/filing-rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Rule could not be deleted.");
      const defaultRule = DEFAULT_FILING_RULES.find((item) => item.name === rule.name);
      setFilingRules((current) => defaultRule ? current.map((item) => item.id === rule.id ? defaultRule : item).sort((left, right) => left.priority - right.priority) : current.filter((item) => item.id !== rule.id));
      notify(defaultRule ? `Email rule “${rule.name}” reset to its built-in default` : `Email rule “${rule.name}” deleted`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Rule could not be deleted.");
    }
  }

  const clientProjectCounts = useMemo(() => new Map(clients.map((client) => [client.id, projectItems.filter((project) => project.clientId === client.id).length])), [clients, projectItems]);

  function openRules() {
    setSettingsArea("Inbox & file rules");
    setView("Settings");
    setWorkspaceMenuOpen(false);
    setProfileMenuOpen(false);
  }

  function openGoogleWorkspace() {
    setProjectOpen(false);
    setClientOpen(false);
    setSettingsArea("Google Workspace");
    setView("Settings");
    setWorkspaceMenuOpen(false);
    setProfileMenuOpen(false);
    notify("Google Workspace setup opened");
  }

  function openDirectorySettings() {
    setSettingsArea("Client Directory");
    setView("Settings");
    setWorkspaceMenuOpen(false);
    setProfileMenuOpen(false);
  }

  function openTestingChecklist() {
    setSettingsArea("Testing & launch");
    setView("Settings");
    setWorkspaceMenuOpen(false);
    setProfileMenuOpen(false);
  }

  async function copySignedInEmail() {
    try {
      await navigator.clipboard.writeText(userEmail);
      notify("Signed-in email copied");
    } catch {
      notify(`Signed in as ${userEmail}`);
    }
    setProfileMenuOpen(false);
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => !current);
    setWorkspaceMenuOpen(false);
    setProfileMenuOpen(false);
  }

  function openProject(project: Project) {
    setSelectedProject(project);
    setClientOpen(false);
    setProjectOpen(true);
  }

  function openClient(client: Client) {
    setSelectedClient(client);
    setProjectOpen(false);
    setClientOpen(true);
  }

  async function advanceLead(id: string) {
    const currentLead = leads.find((lead) => lead.id === id);
    if (!currentLead) return;
    const currentIndex = leadStages.indexOf(currentLead.stage);
    const nextStage = leadStages[Math.min(currentIndex + 1, leadStages.length - 1)];
    if (nextStage === currentLead.stage) {
      notify(`${currentLead.company} is already at the final pipeline stage`);
      return;
    }
    try {
      const response = await fetch(`/api/v1/leads/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: nextStage, nextAction: "Review this stage" }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Lead stage could not be updated.");
      await refreshDirectoryData();
      notify(`${currentLead.company} moved to ${nextStage}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Lead stage could not be updated.");
    }
  }

  async function searchWorkspace() {
    const query = searchTerm.trim();
    if (query.length < 2) {
      setSearchResults([]);
      notify("Enter at least two characters to search clients, projects, and contacts");
      return;
    }
    setSearching(true);
    try {
      const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`);
      const data = await response.json().catch(() => ({})) as { results?: WorkspaceSearchResult[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Workspace search could not be completed.");
      setSearchResults(data.results ?? []);
      if (!data.results?.length) notify(`No workspace records matched “${query}”`);
    } catch (error) {
      setSearchResults([]);
      notify(error instanceof Error ? error.message : "Workspace search could not be completed.");
    } finally {
      setSearching(false);
    }
  }

  function openSearchResult(result: WorkspaceSearchResult) {
    setSearchResults([]);
    setSearchTerm("");
    if (result.kind === "project") {
      const project = projectItems.find((item) => item.id === result.projectId);
      if (project) {
        openProject(project);
        notify(`Opened ${project.number}`);
      } else {
        setView("Projects");
        notify("Project found. Refresh the directory if it is not listed yet.");
      }
      return;
    }
    const client = clients.find((item) => item.id === result.clientId);
    if (client) {
      openClient(client);
      notify(`Opened ${client.name}`);
    } else {
      setView("Clients");
      notify("Client found. Refresh the directory if it is not listed yet.");
    }
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
      <aside className={`sidebar ${mobileNav ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-brand-row">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- The supplied local brand mark does not need optimizer handling. */}
            <img src="/floor-coverings-international-logo.png" alt="Floor Coverings International" />
            <span className="brand-compact" aria-hidden="true"><Building2 size={22} /></span>
          </div>
          <button className="sidebar-collapse" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>{sidebarCollapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}</button>
        </div>
        <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={20} /></button>
        <nav className="main-nav" aria-label="Main navigation">
          <p>Workspace</p>
          {navItems.slice(0, 7).map(({ label, icon: Icon }) => <button key={label} className={view === label ? "active" : ""} onClick={() => { setView(label); setMobileNav(false); setWorkspaceMenuOpen(false); setProfileMenuOpen(false); }} aria-label={label} title={label}><Icon size={18} /><span>{label}</span></button>)}
          <p>Management</p>
          {navItems.slice(7).map(({ label, icon: Icon }) => <button key={label} className={view === label ? "active" : ""} onClick={() => { setView(label); setMobileNav(false); setWorkspaceMenuOpen(false); setProfileMenuOpen(false); }} aria-label={label} title={label}><Icon size={18} /><span>{label}</span></button>)}
        </nav>
        <div className="sidebar-menu-wrap workspace-menu-wrap">
          <button className="workspace-card" onClick={() => { setWorkspaceMenuOpen((current) => !current); setProfileMenuOpen(false); }} aria-haspopup="menu" aria-expanded={workspaceMenuOpen} title="Workspace actions"><div className="workspace-icon"><Building2 size={17} /></div><div><span>Workspace</span><strong>Floor Coverings International</strong></div><ChevronDown size={16} /></button>
          {workspaceMenuOpen && <div className="sidebar-popover workspace-popover" role="menu"><div className="menu-heading"><strong>FCI Operations</strong><span>Single-company workspace</span></div><button role="menuitem" onClick={() => { setView("Clients"); setWorkspaceMenuOpen(false); }}><ContactRound size={15} /> Client Directory</button><button role="menuitem" onClick={openDirectorySettings}><FolderTree size={15} /> Directory sync</button><button role="menuitem" onClick={openGoogleWorkspace}><Building2 size={15} /> Google Workspace</button><button role="menuitem" onClick={openTestingChecklist}><ShieldCheck size={15} /> Testing & launch</button></div>}
        </div>
        <div className="sidebar-menu-wrap profile-menu-wrap">
          <button className="profile" onClick={() => { setProfileMenuOpen((current) => !current); setWorkspaceMenuOpen(false); }} aria-haspopup="menu" aria-expanded={profileMenuOpen} aria-label={`${userName} account actions`} title="Account actions"><div className="avatar">{userInitials}</div><div><strong>{userName}</strong><span>Administrator</span></div><MoreHorizontal size={18} /></button>
          {profileMenuOpen && <div className="sidebar-popover profile-popover" role="menu"><div className="menu-heading"><strong>{userName}</strong><span>{userEmail} · Administrator</span></div><button role="menuitem" onClick={() => void copySignedInEmail()}><Clipboard size={15} /> Copy signed-in email</button><button role="menuitem" onClick={openGoogleWorkspace}><Building2 size={15} /> Google connection</button><button role="menuitem" onClick={() => { setView("Settings"); setWorkspaceMenuOpen(false); setProfileMenuOpen(false); }}><Settings size={15} /> Workspace settings</button><button role="menuitem" onClick={toggleSidebar}><ChevronsLeft size={15} /> {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}</button><a role="menuitem" href={signOutHref}><LogOut size={15} /> Sign out</a></div>}
        </div>
      </aside>

      {mobileNav && <button className="sidebar-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <form className="search" onSubmit={(event) => { event.preventDefault(); void searchWorkspace(); }}><Search size={18} /><input id="workspace-search" value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setSearchResults([]); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchWorkspace(); } }} aria-label="Search workspace" placeholder="Search projects, clients, contacts…" /><button className="search-shortcut" type="submit" disabled={searching} aria-label="Search workspace">{searching ? "…" : "⌘ K"}</button>{searchResults.length > 0 && <div className="global-search-results" role="listbox" aria-label="Workspace search results">{searchResults.map((result) => <button type="button" key={`${result.kind}-${result.id}`} role="option" aria-selected={false} onClick={() => openSearchResult(result)}><span>{result.kind === "project" ? <BriefcaseBusiness size={14} /> : result.kind === "contact" ? <ContactRound size={14} /> : <Users size={14} />}</span><div><strong>{result.title}</strong><small>{result.kind} · {result.subtitle}</small></div><ChevronRight size={14} /></button>)}</div>}</form>
          <div className="top-actions"><div className="notification-wrap"><button className="icon-button" onClick={() => setNotificationsOpen((current) => !current)} aria-label="Notifications" aria-expanded={notificationsOpen}><Bell size={19} /></button>{notificationsOpen && <div className="notification-menu" role="status"><strong>Notifications</strong><button onClick={() => { setView("Inbox"); setNotificationsOpen(false); }}>Open your connected Gmail inbox</button><button onClick={() => { setView("Schedule"); setNotificationsOpen(false); }}>Schedule alerts will appear after scheduling is connected</button></div>}</div><button className="primary-button" onClick={() => setLeadModal(true)}><Plus size={17} /> Add lead</button></div>
        </header>

        <div className="page-wrap">
          <LiveDataBanner state={liveDataState} error={liveDataError} onRetry={() => void refreshDirectoryData()} />
          {view === "Overview" && <Overview firstName={firstName} leads={leads} projects={projectItems} dashboard={dashboard} state={liveDataState} onView={setView} onProject={openProject} />}
          {view === "Leads" && <LeadsView leads={leads} state={liveDataState} onAdd={() => setLeadModal(true)} onAdvance={advanceLead} />}
          {view === "Clients" && <ClientsView clients={clients} projects={projectItems} state={liveDataState} projectCounts={clientProjectCounts} onAdd={() => setClientModal(true)} onClient={openClient} onNewProject={() => setProjectModal(true)} sheetMirror={sheetMirror} onSyncGoogleSheet={syncGoogleSheet} syncingSheet={sheetSyncing} />}
          {view === "Projects" && <ProjectsView projects={projectItems} state={liveDataState} onNewProject={() => setProjectModal(true)} onProject={openProject} />}
          {view === "Schedule" && <ScheduleView dashboard={dashboard} onSettings={() => { setSettingsArea("Workflow defaults"); setView("Settings"); }} />}
          {view === "Inbox" && <InboxView notify={notify} onRules={openRules} projects={projectItems} clients={clients} rules={filingRules} onGoogleSetup={openGoogleWorkspace} />}
          {view === "AI Assistant" && <AssistantView projects={projectItems} />}
          {view === "Reports" && <ReportsView leads={leads} projects={projectItems} clients={clients} dashboard={dashboard} state={liveDataState} />}
          {view === "Settings" && <SettingsView notify={notify} section={settingsArea} onSection={setSettingsArea} rules={filingRules} projects={projectItems} userName={userName} userEmail={userEmail} onGoogleSetup={openGoogleWorkspace} onAddRule={() => setRuleModal(true)} onUpdateRule={updateRule} onDeleteRule={deleteRule} sheetMirror={sheetMirror} onSyncGoogleSheet={syncGoogleSheet} syncingSheet={sheetSyncing} />}
        </div>
      </main>
      {leadModal && <LeadModal onClose={() => setLeadModal(false)} onSave={addLead} />}
      {clientModal && <ClientModal onClose={() => setClientModal(false)} onSave={addClient} />}
      {projectModal && <NewProjectModal clients={clients} onClose={() => setProjectModal(false)} onSave={addProject} />}
      {ruleModal && <RuleModal onClose={() => setRuleModal(false)} onSave={addRule} />}
      {projectOpen && selectedProject && <ProjectDrawer project={selectedProject} onClose={() => setProjectOpen(false)} notify={notify} onProvisionDrive={provisionProjectDrive} />}
      {clientOpen && selectedClient && <ClientDrawer client={selectedClient} projects={projectItems.filter((project) => project.clientId === selectedClient.id)} onClose={() => setClientOpen(false)} onNewProject={() => { setClientOpen(false); setProjectModal(true); }} onProject={(project) => { setClientOpen(false); openProject(project); }} />}
      {projectUpdate && <ProjectUpdateModal project={projectUpdate} onClose={() => setProjectUpdate(null)} onSave={(draft) => { setProjectUpdate(null); notify(`Update for ${draft.project.name} prepared. Connect Gmail before sending.`); }} />}
      {toast && <div className="toast"><CheckCircle2 size={18} />{toast}</div>}
    </div>
  );
}

function LiveDataBanner({ state, error, onRetry }: { state: LiveDataState; error: string; onRetry: () => void }) {
  if (state === "ready") return null;
  if (state === "loading") return <section className="client-directory-banner"><div className="directory-badge"><RefreshCw size={19} /></div><div><strong>Loading live records</strong><span>Reading leads, clients, projects, activity, and Google directory status.</span></div></section>;
  return <section className="schedule-alert"><CircleAlert size={19} /><div><strong>Live records could not be loaded</strong><span>{error}</span></div><button onClick={onRetry}>Try again</button></section>;
}

function Overview({ firstName, leads, projects, dashboard, state, onView, onProject }: { firstName: string; leads: Lead[]; projects: Project[]; dashboard: DashboardSummary | null; state: LiveDataState; onView: (v: View) => void; onProject: (p: Project) => void }) {
  const dateLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const metrics = dashboard?.metrics;
  return <>
    <div className="page-heading"><div><p className="eyebrow">{dateLabel}</p><h1>Good morning, {firstName}.</h1><p>{state === "ready" ? "Your live operation records are below." : "Connecting to your operation records."}</p></div><button className="soft-button" onClick={() => onView("Schedule")}><CalendarDays size={16} /> Schedule readiness</button></div>
    <section className="metrics-grid">
      <Metric label="Active pipeline" value={money(metrics?.estimatedPipelineValue ?? 0)} note={`${metrics?.activeLeads ?? leads.length} open opportunities`} trend="Live" icon={Zap} color="orange" />
      <Metric label="Active projects" value={String(metrics?.activeProjects ?? projects.length)} note="Durable project records" trend="Live" icon={HardHat} color="green" />
      <Metric label="Project meetings" value={String(metrics?.meetingCount ?? 0)} note="Saved meeting records" trend="Live" icon={MessageSquareText} color="blue" />
      <Metric label="Filed emails" value={String(metrics?.filedEmailCount ?? 0)} note="Approved project archives" trend="Live" icon={Mail} color="violet" />
    </section>
    <section className="dashboard-grid">
      <div className="panel pipeline-panel">
        <PanelHeader title="Lead pipeline" subtitle={`${leads.length} live records`} action="View all" onAction={() => onView("Leads")} />
        {leads.length > 0 ? <><div className="pipeline-head"><span>Client / opportunity</span><span>Stage</span><span>Est. value</span><span>Next action</span></div>{leads.slice(0, 4).map((lead) => <div className="pipeline-row" key={lead.id}><div className="client-cell"><Avatar initials={lead.initials} color={lead.color} /><div><strong>{lead.company}</strong><span>{lead.project}</span></div></div><div><Status text={lead.stage} /></div><strong className="value-cell">{lead.value}</strong><div className="next-cell"><Clock3 size={14} />{lead.next}</div></div>)}</> : state === "ready" ? <div className="empty-table">No leads yet. Add the first opportunity to begin the live pipeline.</div> : null}
      </div>
      <div className="panel schedule-panel">
        <PanelHeader title="Scheduling" subtitle="Data model pending" action="Review setup" onAction={() => onView("Schedule")} />
        <div className="dashboard-inbox-empty"><CalendarDays size={20} /><div><strong>No schedule records are being inferred</strong><p>{dashboard?.readiness.scheduleReason ?? "Workers, crews, shifts, and acknowledgements still need durable records before a live calendar can be shown."}</p></div></div>
      </div>
    </section>
    <section className="dashboard-grid lower-grid">
      <div className="panel projects-panel"><PanelHeader title="Active projects" subtitle={`${projects.length} total`} action="View projects" onAction={() => onView("Projects")} /><div className="project-cards">{projects.map((project) => <button className="project-card" key={project.number} onClick={() => onProject(project)}><div className="project-card-top"><Status text={project.status} /><MoreHorizontal size={17} /></div><span className="project-number">{project.number}</span><h3>{project.name}</h3><p>{project.client}</p><div className="project-meta"><span><MapPin size={13} />{project.site}</span><span>{project.value}</span></div></button>)}{projects.length === 0 && state === "ready" ? <div className="empty-table">No projects yet. Create a client, then create its first independent project.</div> : null}</div></div>
      <div className="panel inbox-panel"><PanelHeader title="Connected inbox" subtitle="Explicit Workspace Gmail access" action="Open inbox" onAction={() => onView("Inbox")} /><div className="dashboard-inbox-empty"><Mail size={20} /><div><strong>The company inbox stays review-first</strong><p>Filing always requires your project selection and confirmation.</p></div></div><button className="inbox-cta" onClick={() => onView("Inbox")}><Mail size={15} /> Open connected inbox</button></div>
    </section>
  </>;
}

function LeadsView({ leads, state, onAdd, onAdvance }: { leads: Lead[]; state: LiveDataState; onAdd: () => void; onAdvance: (id: string) => void }) {
  const pipelineValue = leads.reduce((total, lead) => total + lead.estimatedValue, 0);
  return <><PageTitle eyebrow="Sales pipeline" title="Leads & opportunities" text={`${leads.length} open opportunities · ${money(pipelineValue)} estimated value`} action={<button className="primary-button" onClick={onAdd}><Plus size={17} /> Add lead</button>} />
    {leads.length === 0 && state === "ready" ? <section className="panel empty-tab"><div><Zap size={25} /></div><h3>No leads yet</h3><p>Add your first live opportunity. Nothing on this page is demonstration data.</p><button className="primary-button" onClick={onAdd}><Plus size={16} /> Add first lead</button></section> : <div className="board">{leadStages.map((stage) => <section className="board-column" key={stage}><header><span>{stage}</span><b>{leads.filter((lead) => lead.stage.toLowerCase() === stage.toLowerCase()).length}</b><MoreHorizontal size={17} /></header>{leads.filter((lead) => lead.stage.toLowerCase() === stage.toLowerCase()).map((lead) => <article className="lead-card" key={lead.id}><div className="lead-card-head"><Avatar initials={lead.initials} color={lead.color} /><span>{lead.number}</span></div><h3>{lead.company}</h3><p>{lead.project}</p><div className="lead-value">{lead.value}</div><div className="lead-contact"><Users size={14} />{lead.contact}</div><footer><span>{lead.source}</span><button onClick={() => onAdvance(lead.id)} aria-label={`Advance ${lead.company} to the next pipeline stage`}><ChevronRight size={15} /></button></footer></article>)}<button className="add-card" onClick={onAdd}><Plus size={15} /> Add opportunity</button></section>)}</div>}
  </>;
}

function sheetStateLabel(mirror: SheetMirrorStatus | null) {
  if (!mirror) return "Checking sync";
  if (mirror.clients.status === "syncing" || mirror.projects.status === "syncing") return "Syncing";
  if (mirror.reason || mirror.clients.status === "failed" || mirror.projects.status === "failed") return "Needs attention";
  if (mirror.clients.status === "synced" && mirror.projects.status === "synced") return "Synced";
  return "Not synced";
}

function ClientsView({ clients, projects, state, projectCounts, onAdd, onClient, onNewProject, sheetMirror, onSyncGoogleSheet, syncingSheet }: { clients: Client[]; projects: Project[]; state: LiveDataState; projectCounts: Map<string, number>; onAdd: () => void; onClient: (client: Client) => void; onNewProject: () => void; sheetMirror: SheetMirrorStatus | null; onSyncGoogleSheet: () => Promise<void>; syncingSheet: boolean }) {
  const syncLabel = sheetStateLabel(sheetMirror);
  const synced = syncLabel === "Synced";
  const needsAttention = syncLabel === "Needs attention";
  return <><PageTitle eyebrow="Google Workspace directory" title="Clients" text="Each client can have multiple independent projects, contacts, and account-level documents" action={<div className="title-actions"><button className="soft-button" onClick={onNewProject}><BriefcaseBusiness size={16} /> New project</button><button className="primary-button" onClick={onAdd}><Plus size={17} /> Add client</button></div>} />
    <section className="client-directory-banner"><div className="directory-badge"><FolderTree size={20} /></div><div><strong>FCI Operations is the source of truth; Google Sheets is a live directory mirror</strong><span>{sheetMirror?.reason ?? "The Client Directory preserves account notes, while Project Register is generated from the app."}</span></div><div className="directory-sync-actions"><span className={`directory-status ${needsAttention ? "needs-attention" : ""}`}>{synced ? <CircleCheckBig size={14} /> : <Clock3 size={14} />}{syncLabel}</span><button className="soft-button" onClick={() => void onSyncGoogleSheet()} disabled={syncingSheet}>{syncingSheet ? "Syncing…" : "Sync Google Sheet"}</button></div></section>
    <div className="client-directory panel"><div className="client-table-head"><span>Client</span><span>Primary contact</span><span>Independent projects</span><span>Google Sheet</span><span /></div>{clients.map((client) => { const projectCount = projectCounts.get(client.id) ?? 0; const clientProjects = projects.filter((project) => project.clientId === client.id); return <button className="client-table-row" key={client.id} onClick={() => onClient(client)}><div className="client-identity"><Avatar initials={client.initials} color={client.color} /><span><strong>{client.name}</strong><small>{client.code} · {client.industry}</small></span></div><span><strong>{client.contact}</strong><small>{client.email || "Email to add"}</small></span><span className="client-project-count"><b>{projectCount}</b><small>{projectCount === 1 ? "project" : "projects"}{clientProjects.length > 1 ? " · independently managed" : ""}</small></span><span className={synced ? "google-ready" : "google-pending"}>{synced ? <CircleCheckBig size={13} /> : <Clock3 size={13} />}{syncLabel}</span><ChevronRight size={17} /></button>})}{clients.length === 0 && state === "ready" ? <div className="empty-table">No clients yet. Add the first client to create the live directory.</div> : null}</div>
  </>;
}

function ProjectsView({ projects, state, onProject, onNewProject }: { projects: Project[]; state: LiveDataState; onProject: (p: Project) => void; onNewProject: () => void }) {
  const [filter, setFilter] = useState("Active");
  const filteredProjects = projects.filter((project) => {
    const status = project.status.toLowerCase();
    return filter === "Active" ? !["archived", "completed", "cancelled"].includes(status) : status === filter.toLowerCase();
  });
  const filterCount = (stage: string) => stage === "Active" ? projects.filter((project) => !["archived", "completed", "cancelled"].includes(project.status.toLowerCase())).length : projects.filter((project) => project.status.toLowerCase() === stage.toLowerCase()).length;
  return <><PageTitle eyebrow="Project delivery" title="Active projects" text="Every project is independent, even when a client has repeat work" action={<button className="primary-button" onClick={onNewProject}><Plus size={17} /> New project</button>} />
    <div className="filterbar"><div className="tabs">{["Active", "Planning", "Closeout", "Archived"].map((stage) => <button className={filter === stage ? "active" : ""} key={stage} onClick={() => setFilter(stage)}>{stage}<b>{filterCount(stage)}</b></button>)}</div></div>
    <div className="projects-table panel"><div className="projects-table-head"><span>Project</span><span>Phase</span><span>Progress</span><span>Schedule</span><span>Value</span><span /></div>{filteredProjects.map((p) => <button className="projects-table-row" key={p.id} onClick={() => onProject(p)}><div><Avatar initials={recordInitials(p.client)} color={p.accent} /><span><strong>{p.name}</strong><small>{p.number} · {p.client}</small></span></div><Status text={p.status} /><div><small>Not tracked yet</small></div><span><strong>{p.date}</strong><small><MapPin size={12} />{p.site}</small></span><strong>{p.value}</strong><ChevronRight size={17} /></button>)}{!filteredProjects.length && <div className="empty-table">{state === "ready" ? `No ${filter.toLowerCase()} projects match this view.` : "Loading projects…"}</div>}</div>
  </>;
}

function ScheduleView({ dashboard, onSettings }: { dashboard: DashboardSummary | null; onSettings: () => void }) {
  return <><PageTitle eyebrow="Field operations" title="Schedule & crews" text="Scheduling will only show durable worker, crew, shift, and assignment records" action={<button className="soft-button" onClick={onSettings}><Settings size={16} /> Workflow settings</button>} />
    <section className="panel empty-tab"><div><CalendarDays size={27} /></div><h3>Live scheduling is not connected yet</h3><p>{dashboard?.readiness.scheduleReason ?? "The scheduling schema and publication workflow still need to be implemented. No sample shifts or conflicts are shown."}</p></section>
    <section className="client-directory-banner"><div className="directory-badge"><ListTodo size={20} /></div><div><strong>Next scheduling milestone</strong><span>Create workers and crews, save project shifts as drafts, detect conflicts, then publish assignments with acknowledgement links.</span></div></section>
  </>;
}

type InboxBucket = "inbox" | "intake" | "needs-review" | "filed";
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
  intake: "FCI Intake",
  "needs-review": "Needs Review",
  filed: "Filed",
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
  return { kind: "intake", text: "FCI Intake: no enabled built-in rule matched; choose a project before filing", reason: decision.reason };
}

function InboxView({ notify, onRules, projects, clients, rules, onGoogleSetup }: { notify: (s: string) => void; onRules: () => void; projects: Project[]; clients: Client[]; rules: FilingRuleDraft[]; onGoogleSetup: () => void }) {
  const [workspace, setWorkspace] = useState<GmailWorkspaceStatus | null>(null);
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [bucket, setBucket] = useState<InboxBucket>("inbox");
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

  async function checkGmailConnection() {
    setChecking(true);
    try {
      const response = await fetch("/api/v1/google-workspace");
      if (!response.ok) throw new Error("Google Workspace status could not be checked.");
      const data = await response.json() as { workspace?: GmailWorkspaceStatus };
      setWorkspace(data.workspace ?? null);
      setError(null);
    } catch (connectionError) {
      setWorkspace(null);
      setError(connectionError instanceof Error ? connectionError.message : "Google Workspace status could not be checked.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    const check = window.setTimeout(() => { void checkGmailConnection(); }, 0);
    return () => window.clearTimeout(check);
  }, []);

  useEffect(() => {
    void fetch("/api/v1/settings/me")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setReplySignature(typeof data?.preferences?.replySignature === "string" ? data.preferences.replySignature.slice(0, 2_000) : ""))
      .catch(() => undefined);
  }, []);

  const gmailReady = workspace?.connectionStatus === "connected" && workspace.gmailEnabled === true && workspace.gmailConnected === true;

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
      setLabelReady(Boolean(data.labelReady));
      notify(`Loaded ${data.messages?.length ?? 0} message${(data.messages?.length ?? 0) === 1 ? "" : "s"} from ${inboxBucketLabels[bucket]}.`);
    } catch (loadError) {
      setMessages([]);
      setError(loadError instanceof Error ? loadError.message : "Your Gmail messages could not be loaded.");
      await checkGmailConnection();
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
      notify("FCI Gmail labels are ready. No messages were moved or archived.");
      await loadMessages();
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : "FCI Gmail labels could not be prepared.");
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
      notify("Choose the exact independent project before reviewing this email filing.");
      return;
    }
    setFilingLoading(true);
    try {
      const response = await fetch(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(filingMessage.id)}/file?projectId=${encodeURIComponent(filingProjectId)}`);
      const data = await response.json().catch(() => ({})) as GmailFilingPreview & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The Gmail filing preview could not be loaded.");
      setFilingPreview(data);
      notify(`Review the Drive filing for ${data.project.number}. Nothing has been copied yet.`);
    } catch (previewError) {
      setFilingPreview(null);
      notify(previewError instanceof Error ? previewError.message : "The Gmail filing preview could not be loaded.");
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
      notify(data.alreadyFiled ? "This email was already filed to the selected project. Your inbox was left intact." : `Email and ${data.archive?.attachmentCount ?? filingPreview.message.attachmentCount} attachment(s) were copied to the selected project. FCI/Filed was added; Inbox remains intact.`);
      setFilingMessage(null);
      setFilingProjectId("");
      setFilingPreview(null);
      await loadMessages();
    } catch (filingError) {
      notify(filingError instanceof Error ? filingError.message : "The Gmail filing could not be completed.");
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
      notify("Write a reply before saving a Gmail draft.");
      return;
    }
    setReplySaving(true);
    try {
      const response = await fetch(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(replyMessage.id)}/reply-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: replyBody }) });
      const data = await response.json().catch(() => ({})) as { draftSaved?: boolean; recipient?: string; error?: string };
      if (!response.ok || !data.draftSaved) throw new Error(data.error ?? "Gmail draft could not be saved.");
      notify(`Reply draft saved in Gmail for ${data.recipient ?? "the original sender"}. It was not sent.`);
      setReplyMessage(null);
      setReplyBody("");
    } catch (replyError) {
      notify(replyError instanceof Error ? replyError.message : "Gmail draft could not be saved.");
    } finally {
      setReplySaving(false);
    }
  }

  const connectionText = workspace?.simulation ? "Local Workspace simulation is ready" : gmailReady ? `Connected Workspace Gmail: ${workspace?.connectionAccount ?? "company mailbox"}` : workspace?.requiresReauthorization ? "Google Workspace needs to be reconnected to approve Gmail access." : "Connect the company Google Workspace account to load messages.";
  return <>
    <PageTitle eyebrow="Gmail intake" title="Connected inbox" text="Search the company Workspace mailbox—or safe simulated messages—then link each message to one independent project." action={<div className="title-actions"><button className="soft-button" onClick={onRules}><ListFilter size={15} /> Inbox & file rules</button>{gmailReady ? <button className="primary-button" onClick={() => void loadMessages()} disabled={loading}>{loading ? "Loading…" : <><RefreshCw size={15} /> Refresh inbox</>}</button> : <button className="primary-button" onClick={onGoogleSetup}><Building2 size={15} /> Google setup</button>}</div>} />
    <section className={`inbox-connection ${gmailReady ? "ready" : ""}`}><Mail size={18} /><div><strong>{gmailReady ? connectionText : "Workspace Gmail connection required"}</strong><span>{workspace?.simulation ? "Sample messages only. No Google account is connected and nothing is sent to Google." : gmailReady ? "Messages load only after your direct action; filing remains review-first and keeps Inbox." : connectionText}</span></div><button className="soft-button" onClick={() => void checkGmailConnection()} disabled={checking}>{checking ? "Checking…" : "Check connection"}</button></section>
    <section className="inbox-safety"><ShieldCheck size={18} /><div><strong>Safe filing is on</strong><span>{rules.filter((rule) => rule.enabled).length} enabled rules are applied in priority order. Paused rules do not influence suggestions, and every message still needs your exact project selection before filing.</span></div><button onClick={onRules}>Manage rules</button></section>
    {error && <p className="workspace-missing">{error}</p>}
    <div className="inbox-layout">
      <section className="panel message-list">
        <header className="live-inbox-toolbar"><div><label>Mailbox<select value={bucket} onChange={(event) => { setBucket(event.target.value as InboxBucket); setMessages([]); setLabelReady(null); }} disabled={loading}><option value="inbox">Inbox</option><option value="intake">FCI Intake</option><option value="needs-review">FCI Needs Review</option><option value="filed">FCI Filed</option></select></label><label>Search this Gmail mailbox<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. from:vendor@example.com" disabled={loading} /></label><small className="gmail-search-help">Use Gmail search terms such as <b>from:</b>, <b>subject:</b>, or a project number.</small></div><div className="workspace-actions">{labelReady === false && bucket !== "inbox" && <button className="soft-button" onClick={() => void prepareLabels()} disabled={loading}>Prepare FCI labels</button>}<button className="primary-button" onClick={() => void loadMessages()} disabled={!gmailReady || loading}>{loading ? "Loading…" : "Load messages"}</button></div></header>
        {!gmailReady ? <div className="inbox-empty"><Mail size={25} /><h3>Connect Workspace Gmail to see the company inbox</h3><p>Until Workspace is available, switch the local app to Workspace simulation to test the full inbox workflow with sample data.</p><button className="primary-button" onClick={onGoogleSetup}>Open Google Workspace setup</button></div> : messages.length === 0 ? <div className="inbox-empty"><Inbox size={25} /><h3>{loading ? "Loading your inbox…" : "No messages loaded yet"}</h3><p>Choose a mailbox, optionally enter a Gmail search, and select Load messages. The view is limited to 20 message summaries.</p><button className="primary-button" onClick={() => void loadMessages()} disabled={loading}>Load {inboxBucketLabels[bucket]}</button></div> : messages.map((message, index) => {
          const suggestion = inboxProjectSuggestion(message, projects, clients, rules);
          return <article className="message-row live-message-row" key={message.id}><div className={`sender-dot s${index % 4}`}>{(message.from ?? "?").split(/[\s@<]+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div><div className="message-copy"><strong>{message.from ?? "Unknown sender"}</strong><h3>{message.subject ?? "(No subject)"}</h3><p>{message.snippet || "No preview available."}</p><div className={`inbox-project-suggestion ${suggestion.kind}`} title={suggestion.reason} aria-label={`${suggestion.text}. ${suggestion.reason}`}><ShieldCheck size={13} /> {suggestion.text}</div></div><div className="message-actions"><span>{inboxDate(message.date)}</span><small>{message.to ? `To: ${message.to}` : workspace?.simulation ? "Simulated Workspace mailbox" : "Company Workspace mailbox"}</small><button className="primary-button" onClick={() => openFilingReview(message)}><FolderOpen size={14} /> File to project</button><button className="soft-button" onClick={() => openReplyComposer(message)}><Reply size={14} /> Reply</button></div></article>;
        })}
      </section>
      <aside className="panel inbox-summary"><div className="summary-icon"><Mail size={20} /></div><h3>Inbox status</h3><p>{gmailReady ? `Showing ${messages.length} loaded message${messages.length === 1 ? "" : "s"} from ${inboxBucketLabels[bucket]}.` : "Workspace Gmail is not connected yet."}</p><div><span>Provider</span><strong>{workspace?.simulation ? "Local Workspace simulation" : workspace?.connectionAccount ?? "Not connected"}</strong></div><div><span>Message limit</span><strong>20 summaries</strong></div><div><span>Filing protection</span><strong>Exact project required</strong></div><hr /><h4>Keep it organized</h4><ul className="inbox-organization"><li>Use only FCI Intake, Needs Review, and Filed labels.</li><li>Use project numbers for the safest match.</li><li>Store the permanent email and attachments in that project’s Shared Drive folder.</li></ul><small>{workspace?.simulation ? "Simulation mode · no Google access" : "Google Workspace mode"}</small><small>Inbox is retained after filing</small></aside>
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
  return <><PageTitle eyebrow="Project-record assistant" title="Ask FCI Assistant" text="Ask about saved project, client, contact, activity, approved email archives, and project meeting notes. Drive files will join after approved indexing is added." />
    <div className="assistant-layout"><section className="assistant-main panel"><div className="assistant-hero"><div className="ai-orb"><Bot size={29} /></div><h2>What would you like to know?</h2><p>Choose one project so every answer has a clear, reviewable evidence boundary.</p></div><div className="prompt-chips">{["What facts are saved for this project?", "Summarize the current project record", "What evidence is still missing?"].map((q) => <button key={q} onClick={() => void ask(q)} disabled={!activeProjectId}>{q}<ChevronRight size={14} /></button>)}</div>{answer && <article className="ai-answer"><div><Sparkles size={18} /><strong>{answer.mode === "ai-grounded" ? "AI-grounded answer" : "Project-record summary"}</strong><span className="assistant-mode">{answer.mode === "ai-grounded" ? "OpenAI enabled" : "OpenAI not configured or unavailable"}</span></div><p>{answer.answer}</p><p className="assistant-missing"><CircleAlert size={14} /> {answer.missingEvidence}</p><h4>Sources</h4>{answer.citations.length ? answer.citations.map((citation, index) => <button key={citation.id} onClick={() => setSourceDetail(citation)}><FileText size={14} /><span>[{index + 1}] {citation.label}</span><ChevronRight size={14} /></button>) : <p className="source-empty">No verified sources were returned for this answer.</p>}</article>}<form className="ask-box" onSubmit={(event) => { event.preventDefault(); void ask(); }}><select value={activeProjectId} onChange={(event) => { setProjectId(event.target.value); setAnswer(null); }} aria-label="Project context" disabled={!projects.length}><option value="">Choose a project…</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.number} — {project.name}</option>)}</select><div><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about the selected project record…" aria-label="Ask FCI Assistant" /><button disabled={loading || !question.trim() || !activeProjectId} aria-label="Send question">{loading ? <span className="spinner" /> : <Send size={18} />}</button></div><small><Sparkles size={12} /> Every answer is read-only and cites only server-selected project evidence.</small></form></section><aside className="panel recent-questions"><h3>Suggested questions</h3>{["What is the current project status?", "Who is the primary contact?", "How many email archives are linked?", "What evidence has not been captured yet?"].map((q) => <button key={q} onClick={() => void ask(q)} disabled={!activeProjectId}><MessageSquareText size={15} /><span>{q}<small>Selected project only</small></span></button>)}<div className="privacy-note"><CheckCircle2 size={17} /><p><strong>Office-record scope</strong><br />This first version uses the operational records available to approved office users. Project-specific permissions are the next access-control layer.</p></div></aside></div>
    {sourceDetail && <SourceDetailModal citation={sourceDetail} onClose={() => setSourceDetail(null)} />}
  </>;
}

function ReportsView({ leads, projects, clients, dashboard, state }: { leads: Lead[]; projects: Project[]; clients: Client[]; dashboard: DashboardSummary | null; state: LiveDataState }) {
  const stageValues = leadStages.map((stage) => ({ stage, value: leads.filter((lead) => lead.stage.toLowerCase() === stage.toLowerCase()).reduce((total, lead) => total + lead.estimatedValue, 0) }));
  const maximumStageValue = Math.max(1, ...stageValues.map((item) => item.value));
  const projectStatuses = dashboard?.projectsByStatus ?? [];
  const maximumProjectCount = Math.max(1, ...projectStatuses.map((item) => item.count));
  const metrics = dashboard?.metrics;
  return <><PageTitle eyebrow="Business performance" title="Reports" text="Live persisted totals only; unsupported forecasting and crew metrics are not estimated" /><section className="metrics-grid"><Metric label="Pipeline value" value={money(metrics?.estimatedPipelineValue ?? 0)} note={`${metrics?.activeLeads ?? leads.length} active leads`} trend="Live" icon={Zap} color="orange" /><Metric label="Active projects" value={String(metrics?.activeProjects ?? projects.length)} note={`${projects.length} project records`} trend="Live" icon={BriefcaseBusiness} color="green" /><Metric label="Clients" value={String(metrics?.clientCount ?? clients.length)} note="Directory records" trend="Live" icon={Users} color="blue" /><Metric label="Project meetings" value={String(metrics?.meetingCount ?? 0)} note="Captured records" trend="Live" icon={MessageSquareText} color="violet" /></section><div className="reports-grid"><section className="panel report-chart"><PanelHeader title="Pipeline by stage" subtitle="Estimated value" />{leads.length > 0 ? <div className="bar-chart">{stageValues.map((item) => <div key={item.stage}><span>{item.stage}</span><div><i style={{ width: `${Math.round((item.value / maximumStageValue) * 100)}%` }} /></div><strong>{money(item.value)}</strong></div>)}</div> : state === "ready" ? <div className="empty-table">No lead records are available for this report.</div> : null}</section><section className="panel report-chart"><PanelHeader title="Projects by status" subtitle={`${projects.length} records`} />{projectStatuses.length > 0 ? <div className="bar-chart">{projectStatuses.map((item) => <div key={item.status}><span>{displayStatus(item.status, "Unknown")}</span><div><i style={{ width: `${Math.round((item.count / maximumProjectCount) * 100)}%` }} /></div><strong>{item.count}</strong></div>)}</div> : state === "ready" ? <div className="empty-table">No project status data is available yet.</div> : null}</section></div><section className="client-directory-banner"><div className="directory-badge"><Activity size={20} /></div><div><strong>Additional operational reports require additional live models</strong><span>Crew utilization, sales-cycle duration, margin, earned revenue, and closeout duration will appear only after those records and dates are implemented.</span></div></section></>;
}

function SettingsView({ notify, section, onSection, rules, projects, userName, userEmail, onGoogleSetup, onAddRule, onUpdateRule, onDeleteRule, sheetMirror, onSyncGoogleSheet, syncingSheet }: { notify: (s: string) => void; section: string; onSection: (section: string) => void; rules: FilingRuleDraft[]; projects: Project[]; userName: string; userEmail: string; onGoogleSetup: () => void; onAddRule: () => void; onUpdateRule: (rule: FilingRuleDraft, patch: Partial<Pick<FilingRuleDraft, "enabled" | "priority">>) => Promise<void>; onDeleteRule: (rule: FilingRuleDraft) => Promise<void>; sheetMirror: SheetMirrorStatus | null; onSyncGoogleSheet: () => Promise<void>; syncingSheet: boolean }) {
  const options = ["My account", "Google Workspace", "Calendar & appointments", "Inbox & file rules", "Client Directory", "Workflow & notifications", "Data & security", "Testing & launch"];
  return <><PageTitle eyebrow="Control center" title="Settings" text="Keep account preferences, one Google Workspace connection, inbox rules, calendar defaults, and safeguards in one simple place." />
    <div className="settings-layout"><aside className="settings-nav panel">{options.map((option) => <button className={section === option ? "active" : ""} key={option} onClick={() => onSection(option)}>{option}<ChevronRight size={15} /></button>)}</aside>
      {section === "My account" && <MyAccountPanel notify={notify} userName={userName} userEmail={userEmail} onGoogleSetup={onGoogleSetup} />}
      {section === "Google Workspace" && <GoogleWorkspacePanel notify={notify} projects={projects} />}
      {section === "Calendar & appointments" && <WorkspaceDefaultsPanel mode="calendar" notify={notify} onGoogleSetup={onGoogleSetup} />}
      {section === "Inbox & file rules" && <section className="panel rule-settings"><div className="settings-heading"><div><p className="eyebrow">Gmail intake rules</p><h2>Inbox & file rules</h2><p>The three built-in rules below apply in priority order. Pausing one immediately removes it from inbox suggestions; every Drive filing still requires your approval.</p></div><button className="primary-button" onClick={onAddRule}><Plus size={16} /> Add rule</button></div><div className="rule-callout"><ShieldCheck size={19} /><p><strong>Multi-project protection</strong><br />A project number is the safest match. A client with multiple independent projects is always kept in review until you choose the exact job.</p></div><div className="rules-table"><div className="rules-table-head"><span>Priority</span><span>Rule</span><span>When it matches</span><span>Action</span><span>Destination</span></div>{rules.map((rule) => <div className="rule-row" key={rule.id ?? rule.name}><span className="rule-priority">{rule.priority}</span><span><strong>{rule.name}</strong><small>{rule.enabled ? "Enabled" : "Paused"} · approval required</small><div className="rule-inline-actions"><button className="soft-button" onClick={() => void onUpdateRule(rule, { enabled: !rule.enabled })}>{rule.enabled ? "Pause" : "Enable"}</button>{rule.id && <button className="icon-text-button danger" aria-label={`Delete ${rule.name}`} onClick={() => { if (window.confirm(`Delete the email rule “${rule.name}”?`)) void onDeleteRule(rule); }}><Trash2 size={14} /> Delete</button>}</div></span><span>{rule.matchSummary}</span><Status text={rule.action === "review" ? "Needs review" : rule.action === "ignore" ? "Ignored" : "Suggest"} /><span>{rule.targetCategory}</span></div>)}</div><div className="rule-footnote"><Mail size={15} /><span>Custom rules are saved as review-first policies until a supported matcher is added. Keep Gmail simple: use only <b>{DRIVE_BLUEPRINT.gmailLabels.join(", ")}</b>. The project’s Drive folder—not a Gmail label per project—is the permanent filing location.</span></div></section>}
      {section === "Client Directory" && <DirectorySyncPanel mirror={sheetMirror} syncing={syncingSheet} onSync={onSyncGoogleSheet} onConfigure={() => { onSection("Google Workspace"); notify("Open the Workspace checklist to connect Google Sheets"); }} />}
      {section === "Workflow & notifications" && <WorkspaceDefaultsPanel mode="workflow" notify={notify} onGoogleSetup={onGoogleSetup} />}
      {section === "Data & security" && <DataSecurityPanel />}
      {section === "Testing & launch" && <TestingLaunchPanel onGoogleSetup={() => onSection("Google Workspace")} />}
    </div></>;
}

type UserAccountPreferences = { displayTimezone: string; replySignature: string };
type WorkspacePreferenceValues = {
  timezone: string;
  appointmentCalendarName: string;
  fieldCalendarName: string;
  calendarSetupMode: "create-shared" | "use-existing";
  appointmentCalendarId: string;
  fieldCalendarId: string;
  calendarEditPolicy: "app-authoritative";
  appointmentReminderHours: number;
  crewReminderHours: number;
  inboxReviewMode: "review-first";
  officeNotificationEmail: string;
};

const defaultUserAccountPreferences: UserAccountPreferences = { displayTimezone: "America/New_York", replySignature: "" };
const defaultWorkspacePreferences: WorkspacePreferenceValues = {
  timezone: "America/New_York",
  appointmentCalendarName: "FCI • Client Appointments",
  fieldCalendarName: "FCI • Field Schedule",
  calendarSetupMode: "create-shared",
  appointmentCalendarId: "",
  fieldCalendarId: "",
  calendarEditPolicy: "app-authoritative",
  appointmentReminderHours: 24,
  crewReminderHours: 24,
  inboxReviewMode: "review-first",
  officeNotificationEmail: "",
};

function MyAccountPanel({ notify, userName, userEmail, onGoogleSetup }: { notify: (message: string) => void; userName: string; userEmail: string; onGoogleSetup: () => void }) {
  const [preferences, setPreferences] = useState<UserAccountPreferences>(defaultUserAccountPreferences);
  const [connectionAccount, setConnectionAccount] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/v1/settings/me").then((response) => response.ok ? response.json() : null),
      fetch("/api/v1/google-workspace").then((response) => response.ok ? response.json() : null),
    ]).then(([preferenceData, googleData]) => {
      if (!active) return;
      if (preferenceData?.preferences) setPreferences({ ...defaultUserAccountPreferences, ...preferenceData.preferences });
      setConnectionAccount(typeof googleData?.workspace?.connectionAccount === "string" ? googleData.workspace.connectionAccount : null);
    }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/v1/settings/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preferences) });
      const data = await response.json().catch(() => ({})) as { preferences?: UserAccountPreferences; error?: string };
      if (!response.ok || !data.preferences) throw new Error(data.error ?? "Your account preferences could not be saved.");
      setPreferences({ ...defaultUserAccountPreferences, ...data.preferences });
      notify("Your preferences are saved to your signed-in FCI account");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Your account preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  return <section className="panel settings-form-panel"><div className="settings-heading"><div><p className="eyebrow">Signed-in account</p><h2>My account</h2><p>Your timezone and reply signature are saved to this FCI account and follow you between browsers.</p></div></div><div className="account-identity"><div className="avatar">{userName.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "FC"}</div><div><strong>{userName}</strong><span>{userEmail}</span></div></div><form onSubmit={save}><div className="form-row"><label>My display timezone<select value={preferences.displayTimezone} onChange={(event) => setPreferences((current) => ({ ...current, displayTimezone: event.target.value }))} disabled={loading || saving}><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option></select></label><label>Workspace connection<input value={connectionAccount ?? "Not connected"} readOnly /></label></div><label>Default reply signature<textarea value={preferences.replySignature} onChange={(event) => setPreferences((current) => ({ ...current, replySignature: event.target.value }))} placeholder="Name, title, phone, and company" maxLength={2000} disabled={loading || saving} /></label><p className="form-help"><Reply size={14} /> Local simulation never connects a Google account. When the company Workspace is ready, one administrator-approved connection supplies Gmail, Calendar, Shared Drive, and Sheets.</p><footer><button type="button" className="soft-button" onClick={onGoogleSetup}><Building2 size={15} /> Manage Google Workspace</button><button type="submit" className="primary-button" disabled={loading || saving}>{saving ? "Saving…" : <><Check size={15} /> Save my preferences</>}</button></footer></form></section>;
}

function WorkspaceDefaultsPanel({ mode, notify, onGoogleSetup }: { mode: "calendar" | "workflow"; notify: (message: string) => void; onGoogleSetup: () => void }) {
  const [settings, setSettings] = useState<WorkspacePreferenceValues>(defaultWorkspacePreferences);
  const [saving, setSaving] = useState(false);
  const [calendarAccount, setCalendarAccount] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  useEffect(() => {
    void Promise.all([fetch("/api/v1/settings/workspace").then((response) => response.ok ? response.json() : null), fetch("/api/v1/google-workspace").then((response) => response.ok ? response.json() : null)]).then(([settingsData, googleData]) => {
      if (settingsData?.settings) setSettings({ ...defaultWorkspacePreferences, ...settingsData.settings });
      setCalendarAccount(typeof googleData?.workspace?.connectionAccount === "string" ? googleData.workspace.connectionAccount : null);
      setCalendarConnected(googleData?.workspace?.calendarConnected === true && googleData?.workspace?.calendarEnabled === true && googleData?.workspace?.connectionStatus === "connected");
    }).catch(() => undefined);
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/v1/settings/workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await response.json().catch(() => ({})) as { settings?: WorkspacePreferenceValues; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error ?? "Settings could not be saved.");
      setSettings({ ...defaultWorkspacePreferences, ...data.settings });
      notify(mode === "calendar" ? "Calendar defaults saved" : "Workflow and notification defaults saved");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  if (mode === "calendar") {
    return <section className="panel settings-form-panel">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">Organization calendar plan</p>
          <h2>Calendar & appointments</h2>
          <p>Keep company work in two shared FCI Workspace calendars: one for client appointments and one for field scheduling.</p>
        </div>
        <button className="soft-button" type="button" onClick={onGoogleSetup}><Building2 size={15} /> Google connection</button>
      </div>
      <div className={`settings-connection ${calendarConnected ? "ready" : ""}`}>
        <CalendarDays size={18} />
        <div>
          <strong>{calendarConnected ? "Workspace calendar service ready" : "Workspace Calendar connection required"}</strong>
          <span>{calendarConnected ? `${calendarAccount ?? "Local Workspace simulation"} is ready for appointment testing.` : "Connect Google Workspace and approve Calendar before publishing appointments."}</span>
        </div>
      </div>
      <form onSubmit={save}>
        <div className="settings-static-row">
          <CalendarDays size={16} />
          <div><strong>Recommended setup</strong><span>Create or select one shared <b>FCI • Client Appointments</b> calendar and one shared <b>FCI • Field Schedule</b> calendar. Do not create one calendar per user; invite assigned people to the same company event instead.</span></div>
        </div>
        <div className="form-row">
          <label>Calendar setup<select value={settings.calendarSetupMode} onChange={(event) => setSettings((current) => ({ ...current, calendarSetupMode: event.target.value as WorkspacePreferenceValues["calendarSetupMode"] }))}><option value="create-shared">Create two shared FCI calendars (recommended)</option><option value="use-existing">Use existing company calendars</option></select></label>
          <label>Workspace timezone<select value={settings.timezone} onChange={(event) => setSettings((current) => ({ ...current, timezone: event.target.value }))}><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option></select></label>
        </div>
        <div className="form-row">
          <label>Client appointments calendar name<input value={settings.appointmentCalendarName} onChange={(event) => setSettings((current) => ({ ...current, appointmentCalendarName: event.target.value }))} /></label>
          <label>Field schedule calendar name<input value={settings.fieldCalendarName} onChange={(event) => setSettings((current) => ({ ...current, fieldCalendarName: event.target.value }))} /></label>
        </div>
        {settings.calendarSetupMode === "use-existing" && <div className="form-row">
          <label>Client appointments calendar ID<input value={settings.appointmentCalendarId} onChange={(event) => setSettings((current) => ({ ...current, appointmentCalendarId: event.target.value }))} placeholder="Calendar ID, not an event ID" /></label>
          <label>Field schedule calendar ID<input value={settings.fieldCalendarId} onChange={(event) => setSettings((current) => ({ ...current, fieldCalendarId: event.target.value }))} placeholder="Calendar ID, not an event ID" /></label>
        </div>}
        <div className="form-row">
          <label>Appointment reminder hours<input type="number" min="0" max="168" value={settings.appointmentReminderHours} onChange={(event) => setSettings((current) => ({ ...current, appointmentReminderHours: Number(event.target.value) || 0 }))} /></label>
          <label>Scheduling source<input value="FCI Operations + shared Workspace calendars" readOnly /></label>
        </div>
        <div className="settings-static-row">
          <ShieldCheck size={16} />
          <div><strong>Sync & conflict policy</strong><span>FCI Operations will remain authoritative. A later edit to an app-created Google event will be flagged for review instead of silently overwriting the project schedule.</span></div>
        </div>
        <div className="settings-static-row">
          <Mail size={16} />
          <div><strong>Gmail relationship</strong><span>Gmail and Calendar are separate. When a message becomes an appointment, the app will link the thread to the appointment; Gmail-generated travel or reservation events are never imported into the company schedule automatically.</span></div>
        </div>
        <p className="form-help"><CalendarDays size={14} /> Local simulation stores safe sample holds without contacting Google. Live mode uses the configured company calendar IDs and keeps FCI Operations authoritative.</p>
        <footer><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : <><Check size={15} /> Save calendar plan</>}</button></footer>
      </form>
    </section>;
  }
  return <section className="panel settings-form-panel">
    <div className="settings-heading">
      <div><p className="eyebrow">Operating defaults</p><h2>Workflow & notifications</h2><p>Set simple defaults for the office. These are saved now and will be used by appointment and field-message automation as it is enabled.</p></div>
      <button className="soft-button" type="button" onClick={onGoogleSetup}><Building2 size={15} /> Google connection</button>
    </div>
    <form onSubmit={save}>
      <div className="form-row">
        <label>Client reminder hours<input type="number" min="0" max="168" value={settings.appointmentReminderHours} onChange={(event) => setSettings((current) => ({ ...current, appointmentReminderHours: Number(event.target.value) || 0 }))} /></label>
        <label>Crew reminder hours<input type="number" min="0" max="168" value={settings.crewReminderHours} onChange={(event) => setSettings((current) => ({ ...current, crewReminderHours: Number(event.target.value) || 0 }))} /></label>
      </div>
      <label>Office notification email<input type="email" value={settings.officeNotificationEmail} onChange={(event) => setSettings((current) => ({ ...current, officeNotificationEmail: event.target.value }))} placeholder="office@example.com" /></label>
      <div className="settings-static-row"><ShieldCheck size={16} /><div><strong>Inbox action policy</strong><span>Review-first is enforced: no email is automatically archived, labeled Filed, or copied to a project without an explicit project selection and confirmation.</span></div></div>
      <footer><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : <><Check size={15} /> Save defaults</>}</button></footer>
    </form>
  </section>;
}

function DataSecurityPanel() {
  return <section className="panel settings-form-panel"><div className="settings-heading"><div><p className="eyebrow">Safety & access</p><h2>Data & security</h2><p>These safeguards are active in the prototype and identify what must be completed before staff-wide use.</p></div></div><div className="settings-security-list"><div><ShieldCheck size={18} /><span><strong>Review-first email filing</strong><small>Messages retain Inbox; project copies and FCI/Filed occur only after a direct approval.</small></span></div><div><Users size={18} /><span><strong>One administrator-approved Workspace connection</strong><small>The company connection supplies Gmail, Calendar, Shared Drive, and Sheets. Consumer Google accounts are rejected in live mode.</small></span></div><div><Building2 size={18} /><span><strong>Local Workspace simulation is isolated</strong><small>Simulation uses local sample data, creates no OAuth tokens, and never sends requests to Google services.</small></span></div><div><Settings size={18} /><span><strong>Installable web app</strong><small>This site includes a web-app manifest. A true Gmail sidebar remains a separate Google Workspace Add-on deployment.</small></span></div></div><PhoneInstallPanel /></section>;
}

function formatSyncTime(value: number | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not yet synced";
}

function DirectorySyncPanel({ mirror, syncing, onSync, onConfigure }: { mirror: SheetMirrorStatus | null; syncing: boolean; onSync: () => Promise<void>; onConfigure: () => void }) {
  const ready = Boolean(mirror?.configured && mirror.enabled && mirror.connected);
  const clientsStatus = mirror?.clients.status ?? "checking";
  const projectsStatus = mirror?.projects.status ?? "checking";
  return <section className="panel client-directory-settings"><div className="settings-heading"><div><p className="eyebrow">Google Sheets mirror</p><h2>Client Directory & Project Register</h2><p>FCI Operations stores the working metadata and relationships. Your Google spreadsheet is a one-way, always-current directory and export view.</p></div><div className="workspace-actions">{mirror?.spreadsheetUrl && <a className="soft-button" href={mirror.spreadsheetUrl} target="_blank" rel="noreferrer"><FolderOpen size={15} /> Open spreadsheet</a>}<button className="primary-button" onClick={() => void onSync()} disabled={syncing || !ready}>{syncing ? "Syncing…" : "Sync now"}</button></div></div>
    {!ready && <div className="workspace-missing"><CircleAlert size={16} /><span>{mirror?.reason ?? "Checking Google Sheets configuration…"}</span><button className="soft-button" onClick={onConfigure}>Google setup</button></div>}
    <div className="directory-sync-summary"><article><div><FolderTree size={17} /></div><span>Client Directory</span><strong>{clientsStatus === "synced" ? "Synced" : clientsStatus === "failed" ? "Needs attention" : clientsStatus}</strong><small>{formatSyncTime(mirror?.clients.lastSyncedAt ?? null)}</small><p>Updates client code, contacts, project count, folder link, status, and last update. Your Account Notes column remains yours.</p></article><article><div><BriefcaseBusiness size={17} /></div><span>Project Register</span><strong>{projectsStatus === "synced" ? "Synced" : projectsStatus === "failed" ? "Needs attention" : projectsStatus}</strong><small>{formatSyncTime(mirror?.projects.lastSyncedAt ?? null)}</small><p>Generated from independent project records, including the client, status, site, value, manager, and Drive workspace link.</p></article></div>
    {(mirror?.clients.lastError || mirror?.projects.lastError) && <div className="workspace-missing"><CircleAlert size={16} /><span>{mirror.clients.lastError ?? mirror.projects.lastError}</span></div>}
    <div className="directory-layout"><div><h3>What lives in the app</h3><ul><li>Client-to-project relationships and project numbers</li><li>Contacts, statuses, dates, values, and Drive mappings</li><li>Future tasks, notes, meetings, communications, schedules, and activity history</li></ul></div><div><h3>How to use the spreadsheet</h3><p>Use it to view, filter, export, and add account notes. Do not edit the generated Project Register; the next sync rebuilds it from FCI Operations. Spreadsheet edits do not write back to the app yet.</p></div></div></section>;
}

type WorkspaceMessage = { id: string; threadId?: string | null; from: string | null; to?: string | null; subject: string | null; date: string | null; snippet: string; labelIds?: string[] };
type GmailFilingPreview = {
  message: { id: string; threadId: string | null; from: string | null; to: string | null; subject: string | null; date: string | null; attachmentCount: number; attachments: Array<{ filename: string; mimeType: string; byteSize: number }> };
  project: { id: string; number: string; name: string; client: string };
  destinations: { emailArchive: string; attachments: string };
  existing: { status: string; filed: boolean; emailDriveUrl: string | null; attachmentCount: number; filedAt: number | null } | null;
  inboxRetained: boolean;
};

function GoogleWorkspacePanel({ notify, projects }: { notify: (s: string) => void; projects: Project[] }) {
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<"unknown" | "missing" | "credentials">("unknown");
  const [missing, setMissing] = useState<string[]>([]);
  const [workspace, setWorkspace] = useState<{
    mode?: "shared-drive";
    runtimeMode?: "simulation" | "workspace";
    simulation?: boolean;
    storageLabel?: string;
    storageName?: string;
    storageConfigured?: boolean;
    connectionStatus?: string;
    connectionAccount?: string | null;
    driveConnected?: boolean;
    gmailConnected?: boolean;
    calendarConnected?: boolean;
    sheetsConnected?: boolean;
    requiresReauthorization?: boolean;
    provisioningEnabled?: boolean;
    gmailEnabled?: boolean;
    calendarEnabled?: boolean;
    sheetsEnabled?: boolean;
    clientDirectorySheetConfigured?: boolean;
    enabledServices?: string[];
    broadScopeAcknowledged?: boolean;
  } | null>(null);
  const [gmailMessages, setGmailMessages] = useState<WorkspaceMessage[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<Array<{ id: string; title: string; start: string; end: string; url?: string }>>([]);
  const [gmailWorking, setGmailWorking] = useState(false);
  const [calendarWorking, setCalendarWorking] = useState(false);
  const [gmailLabelsReady, setGmailLabelsReady] = useState(false);
  const [filingMessage, setFilingMessage] = useState<WorkspaceMessage | null>(null);
  const [filingProjectId, setFilingProjectId] = useState("");
  const [filingPreview, setFilingPreview] = useState<GmailFilingPreview | null>(null);
  const [filingLoading, setFilingLoading] = useState(false);
  const [filingSubmitting, setFilingSubmitting] = useState(false);
  const readinessChecked = useRef(false);

  const checkSetup = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/v1/google-workspace");
      if (!response.ok) throw new Error("Workspace readiness check failed");
      const data = await response.json() as {
        credentialsPresent?: boolean;
        missing?: string[];
        workspace?: {
          mode?: "shared-drive";
          runtimeMode?: "simulation" | "workspace";
          simulation?: boolean;
          storageLabel?: string;
          storageName?: string;
          storageConfigured?: boolean;
          connectionStatus?: string;
          connectionAccount?: string | null;
          driveConnected?: boolean;
          gmailConnected?: boolean;
          calendarConnected?: boolean;
          sheetsConnected?: boolean;
          requiresReauthorization?: boolean;
          provisioningEnabled?: boolean;
          gmailEnabled?: boolean;
          calendarEnabled?: boolean;
          sheetsEnabled?: boolean;
          clientDirectorySheetConfigured?: boolean;
          enabledServices?: string[];
          broadScopeAcknowledged?: boolean;
        };
      };
      setMissing(data.missing ?? []);
      setWorkspace(data.workspace ?? null);
      setStatus(data.credentialsPresent ? "credentials" : "missing");
      notify(data.workspace?.simulation ? "Local Workspace simulation is ready. No Google account is connected." : data.credentialsPresent ? "Workspace configuration is present. Finish OAuth authorization before Google data can be accessed." : `Workspace setup still needs ${Math.max(1, data.missing?.length ?? 0)} item(s)`);
    } catch {
      setStatus("missing");
      notify("Workspace readiness could not be checked. Confirm the app is running and try again.");
    } finally {
      setChecking(false);
    }
  }, [notify]);

  useEffect(() => {
    if (readinessChecked.current) return;
    readinessChecked.current = true;
    const check = window.setTimeout(() => { void checkSetup(); }, 0);
    return () => window.clearTimeout(check);
  }, [checkSetup]);

  useEffect(() => {
    if (workspace?.simulation !== true) return;
    const current = new URL(window.location.href);
    if (!current.searchParams.has("google")) return;
    current.searchParams.delete("google");
    window.history.replaceState(null, "", `${current.pathname}${current.search}${current.hash}`);
  }, [workspace?.simulation]);

  async function connectGoogleDrive() {
    setWorking(true);
    try {
      const response = await fetch("/api/v1/integrations/google/authorize", { method: "POST" });
      const data = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !data.authorizationUrl) throw new Error(data.error ?? "Google Drive could not be authorized.");
      window.location.assign(data.authorizationUrl);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Google Drive could not be authorized.");
      setWorking(false);
    }
  }

  async function verifyGoogleDrive() {
    setWorking(true);
    try {
      const response = await fetch("/api/v1/integrations/google/drive/verify", { method: "POST" });
      const data = await response.json() as { verified?: boolean; error?: string };
      if (!response.ok || !data.verified) throw new Error(data.error ?? "The Drive workspace could not be verified.");
      notify("The active Drive workspace was verified. You can now enable project-folder testing when ready.");
      await checkSetup();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Drive workspace could not be verified.");
    } finally {
      setWorking(false);
    }
  }

  async function disconnectGoogleDrive() {
    setWorking(true);
    try {
      const response = await fetch("/api/v1/integrations/google/connection", { method: "DELETE" });
      const data = await response.json() as { disconnected?: boolean; error?: string };
      if (!response.ok || !data.disconnected) throw new Error(data.error ?? "The Google connection could not be removed.");
      notify("The active Google connection was removed from FCI Operations.");
      await checkSetup();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Google connection could not be removed.");
    } finally {
      setWorking(false);
    }
  }

  async function readApi<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "The Workspace action could not be completed.");
    return data;
  }

  async function prepareTestGmailLabels() {
    setGmailWorking(true);
    try {
      await readApi<{ prepared: boolean }>("/api/v1/integrations/google/gmail/labels/prepare", { method: "POST" });
      setGmailLabelsReady(true);
      notify("FCI Gmail labels are ready. No messages were moved or archived.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gmail labels could not be prepared.");
    } finally {
      setGmailWorking(false);
    }
  }

  async function refreshTestGmail() {
    setGmailWorking(true);
    try {
      const data = await readApi<{ messages?: WorkspaceMessage[]; labelReady?: boolean }>("/api/v1/integrations/google/gmail/messages?label=inbox");
      setGmailMessages(data.messages ?? []);
      setGmailLabelsReady((current) => current || Boolean(data.labelReady));
      notify(`Loaded ${data.messages?.length ?? 0} Workspace inbox message(s).`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The test inbox could not be loaded.");
    } finally {
      setGmailWorking(false);
    }
  }

  async function sendSelfTestEmail() {
    setGmailWorking(true);
    try {
      await readApi<{ sent: boolean }>("/api/v1/integrations/google/gmail/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      notify(workspace?.simulation ? "A sample email was added to the simulated Workspace inbox." : "A test email was sent only to the configured Workspace mailbox.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The self-test email could not be sent.");
    } finally {
      setGmailWorking(false);
    }
  }

  async function labelTestMessageFiled(messageId: string) {
    setGmailWorking(true);
    try {
      await readApi<{ filed: boolean }>(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(messageId)}/label`, { method: "POST" });
      notify("FCI/Filed was added. The message remains in your inbox.");
      await refreshTestGmail();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Filed label could not be added.");
    } finally {
      setGmailWorking(false);
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
      notify("Choose the exact independent project before reviewing this email filing.");
      return;
    }
    setFilingLoading(true);
    try {
      const data = await readApi<GmailFilingPreview>(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(filingMessage.id)}/file?projectId=${encodeURIComponent(filingProjectId)}`);
      setFilingPreview(data);
      notify(`Ready to review the Drive filing for ${data.project.number}. Nothing has been copied yet.`);
    } catch (error) {
      setFilingPreview(null);
      notify(error instanceof Error ? error.message : "The Gmail filing preview could not be loaded.");
    } finally {
      setFilingLoading(false);
    }
  }

  async function confirmGmailFiling() {
    if (!filingMessage || !filingProjectId || !filingPreview) return;
    setFilingSubmitting(true);
    try {
      const data = await readApi<{ filed: boolean; alreadyFiled?: boolean; archive?: { attachmentCount?: number } }>(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(filingMessage.id)}/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: filingProjectId }),
      });
      notify(data.alreadyFiled ? "This email was already filed to the selected project. Your inbox was left intact." : `Email and ${data.archive?.attachmentCount ?? filingPreview.message.attachmentCount} attachment(s) were copied to the selected project. FCI/Filed was added; Inbox remains intact.`);
      setFilingMessage(null);
      setFilingProjectId("");
      setFilingPreview(null);
      await refreshTestGmail();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Gmail filing could not be completed.");
    } finally {
      setFilingSubmitting(false);
    }
  }

  async function refreshTestCalendar() {
    setCalendarWorking(true);
    try {
      const data = await readApi<{ events?: Array<{ id: string; title: string; start: string; end: string; url?: string }> }>("/api/v1/integrations/google/calendar/events");
      setCalendarEvents(data.events ?? []);
      notify(`Loaded ${data.events?.length ?? 0} upcoming Workspace Calendar event(s).`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Workspace Calendar could not be loaded.");
    } finally {
      setCalendarWorking(false);
    }
  }

  async function createTestCalendarHold() {
    setCalendarWorking(true);
    try {
      await readApi<{ event: { start: string } }>("/api/v1/integrations/google/calendar/test-hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      notify(workspace?.simulation ? "A 30-minute hold was added to the simulated Workspace calendar." : "A private 30-minute Workspace test hold was created with no attendees or notifications.");
      await refreshTestCalendar();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The test calendar hold could not be created.");
    } finally {
      setCalendarWorking(false);
    }
  }

  async function resetSimulation() {
    setWorking(true);
    try {
      const data = await readApi<{ reset: boolean; messages: number; events: number }>("/api/v1/integrations/google/simulation/reset", { method: "POST" });
      setGmailMessages([]);
      setCalendarEvents([]);
      setGmailLabelsReady(true);
      notify(`Workspace simulation reset with ${data.messages} sample messages and ${data.events} calendar events.`);
      await checkSetup();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Workspace simulation could not be reset.");
    } finally {
      setWorking(false);
    }
  }

  const configured = status === "credentials";
  const simulation = workspace?.simulation === true;
  const connected = workspace?.connectionStatus === "connected";
  const gmailReady = connected && workspace?.gmailEnabled === true && workspace?.gmailConnected === true;
  const calendarReady = connected && workspace?.calendarEnabled === true && workspace?.calendarConnected === true;
  const sheetsReady = connected && workspace?.sheetsEnabled === true && workspace?.sheetsConnected === true && workspace?.clientDirectorySheetConfigured === true;
  const reconnectRequired = workspace?.requiresReauthorization === true;
  const selectedServices = workspace?.enabledServices?.join(", ") ?? "drive";
  const storageName = workspace?.storageName ?? "FCI Operations";
  const oauthResult = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("google");
  const oauthMessage = oauthResult === "connected"
    ? "Google was connected. Run the readiness check to refresh this panel."
    : oauthResult === "authorization-cancelled"
      ? "Google authorization was cancelled; no connection was saved."
      : oauthResult === "authorization-expired"
        ? "Google authorization expired. Start the connection again from this page."
        : oauthResult === "admin-required"
          ? "An approved FCI administrator must complete the Google connection."
          : oauthResult === "setup-needed"
              ? "Google setup is incomplete. Review the missing configuration below."
            : oauthResult === "connection-failed"
              ? "Google could not be connected. Confirm the approved account, folder, and requested services, then try again."
              : null;

  return <section className="panel workspace-settings">
    <div className="settings-heading">
      <div><p className="eyebrow">Company integration</p><h2>Google Workspace</h2><p>Use one company Workspace connection in live operation. Until that tenant exists, local simulation keeps every prototype workflow testable without Google access.</p></div>
      <button className="primary-button" onClick={checkSetup} disabled={checking}>{checking ? "Checking…" : "Check readiness"}</button>
    </div>
    <div className={`workspace-mode-card ${simulation ? "simulation" : "live"}`}>
      {simulation ? <Zap size={18} /> : <Building2 size={18} />}
      <span><strong>{simulation ? "Local Workspace simulation" : "Company Google Workspace"}</strong><small>{simulation ? "Sample data only · no Google account connected · nothing is sent to Google" : "One administrator-approved organization connection"}</small></span>
      <b>{simulation ? "LOCAL" : connected ? "CONNECTED" : "SETUP"}</b>
    </div>
    <div className={`workspace-connection ${connected ? "ready" : ""}`}>
      <div className="integration-logo google"><Mail size={20} /></div>
      <div><strong>{simulation ? "All four simulated services are ready" : connected ? "Google Workspace services connected" : reconnectRequired ? "Google permission update required" : configured ? "Ready to connect Google Workspace" : "Google Workspace setup required"}</strong><span>{simulation ? "Gmail, Calendar, Shared Drive, and Sheets use local sample state." : connected ? `${workspace?.connectionAccount ?? "Approved Workspace account"} is connected with ${selectedServices}.` : reconnectRequired ? "Reconnect and approve every selected service." : configured ? `The company connection will request ${selectedServices}.` : "Add the missing company Workspace settings below."}</span></div>
      <span>{simulation ? "Simulated" : connected ? "Connected" : reconnectRequired ? "Reconnect" : configured ? "Authorize next" : "Not connected"}</span>
    </div>
    {simulation && <p className="workspace-warning"><ShieldCheck size={15} /><span><strong>Safe local testing:</strong> OAuth is disabled, no refresh token exists, and all messages, events, folders, and Sheet sync results stay inside this local prototype.</span></p>}
    {!simulation && workspace?.sheetsEnabled && <p className="workspace-warning"><FileText size={15} /><span><strong>Google Sheets:</strong> {sheetsReady ? "the Client Directory and Project Register mirror are ready." : workspace.clientDirectorySheetConfigured ? "reconnect Workspace to approve Sheets." : "add the Client Directory spreadsheet ID before syncing."}</span></p>}
    {!simulation && oauthMessage && <p className={oauthResult === "connected" ? "workspace-warning" : "workspace-missing"}>{oauthMessage}</p>}
    {!simulation && missing.length > 0 && <p className="workspace-missing"><strong>Still needed:</strong> {missing.join(", ")}</p>}
    <div className="workspace-actions">
      {simulation ? <button className="primary-button" onClick={resetSimulation} disabled={working}>{working ? "Resetting…" : "Reset simulation data"}</button> : <>
        {!connected && <button className="primary-button" onClick={connectGoogleDrive} disabled={!configured || working}>{working ? "Preparing…" : reconnectRequired ? "Reconnect Google Workspace" : "Connect Google Workspace"}</button>}
        {connected && <button className="primary-button" onClick={verifyGoogleDrive} disabled={working}>{working ? "Verifying…" : "Verify Shared Drive"}</button>}
        {connected && <button className="soft-button" onClick={disconnectGoogleDrive} disabled={working}>Disconnect Workspace</button>}
      </>}
    </div>
    {!simulation && connected && !workspace?.provisioningEnabled && <p className="workspace-missing"><strong>Folder creation remains off:</strong> enable Workspace Drive provisioning only after the company Shared Drive is verified.</p>}
    <section className="test-google-services" aria-label="Workspace service controls">
      <header><div><p className="eyebrow">{simulation ? "Simulation controls" : "Workspace controls"}</p><h3>Gmail & Calendar</h3><p>{simulation ? "Use the same actions as live mode with local sample data." : "Every Gmail and Calendar change still requires a direct action."}</p></div></header>
      <div className="test-service-grid">
        <section className="test-service-card">
          <div className="test-service-heading"><Mail size={17} /><div><strong>{simulation ? "Simulated Workspace Gmail" : "Workspace Gmail"}</strong><span>{gmailReady ? "Ready for explicit actions" : "Connect Workspace and approve Gmail"}</span></div></div>
          <p>Prepare FCI labels, view up to 20 messages, add a sample email in simulation, and review-file one message into the exact project. Inbox stays intact.</p>
          <div className="workspace-actions"><button className="soft-button" onClick={prepareTestGmailLabels} disabled={!gmailReady || gmailWorking}>{gmailWorking ? "Working…" : gmailLabelsReady ? "Refresh FCI labels" : "Prepare FCI labels"}</button><button className="soft-button" onClick={refreshTestGmail} disabled={!gmailReady || gmailWorking}>{gmailWorking ? "Loading…" : "View inbox"}</button><button className="primary-button" onClick={sendSelfTestEmail} disabled={!gmailReady || gmailWorking}>{gmailWorking ? "Working…" : simulation ? "Add sample email" : "Send Workspace test"}</button></div>
          {gmailMessages.length > 0 && <div className="test-service-list">{gmailMessages.map((message) => <article key={message.id}><div><strong>{message.subject || "(No subject)"}</strong><span>{message.from || "Unknown sender"}{message.date ? ` · ${new Date(message.date).toLocaleString()}` : ""}</span><p>{message.snippet}</p></div><div className="gmail-message-actions"><button className="primary-button" onClick={() => openFilingReview(message)} disabled={gmailWorking}>File to project</button><button className="soft-button" onClick={() => labelTestMessageFiled(message.id)} disabled={gmailWorking}>Label only</button></div></article>)}</div>}
        </section>
        <section className="test-service-card">
          <div className="test-service-heading"><CalendarDays size={17} /><div><strong>{simulation ? "Simulated shared calendars" : "Workspace shared calendars"}</strong><span>{calendarReady ? "Ready for appointment testing" : "Connect Workspace and approve Calendar"}</span></div></div>
          <p>View a seven-day appointments window or create one 30-minute hold. Simulation stores it locally; live mode uses the configured company calendar.</p>
          <div className="workspace-actions"><button className="soft-button" onClick={refreshTestCalendar} disabled={!calendarReady || calendarWorking}>{calendarWorking ? "Loading…" : "View upcoming events"}</button><button className="primary-button" onClick={createTestCalendarHold} disabled={!calendarReady || calendarWorking}>{calendarWorking ? "Creating…" : "Create test hold"}</button></div>
          {calendarEvents.length > 0 && <div className="test-service-list">{calendarEvents.map((event) => <article key={event.id}><div><strong>{event.title}</strong><span>{new Date(event.start).toLocaleString()} – {new Date(event.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>{event.url && <button className="soft-button" onClick={() => window.open(event.url, "_blank", "noopener,noreferrer")}>Open</button>}</article>)}</div>}
        </section>
      </div>
    </section>
    <div className="drive-blueprint"><div><h3>{simulation ? "Simulated Shared Drive blueprint" : "Company Shared Drive blueprint"}</h3><p>{storageName}</p></div><ol>{DRIVE_BLUEPRINT.roots.map((item) => <li key={item}>{item}</li>)}</ol><div className="project-folder-list"><strong>Every independent project receives:</strong>{DRIVE_BLUEPRINT.projectFolders.map((item) => <span key={item}><FolderOpen size={13} />{item}</span>)}</div></div>
    <div className="workspace-checklist"><h3>{simulation ? "Simulation safeguards" : "Workspace launch safeguards"}</h3><label><input type="checkbox" /> {simulation ? "Use only seeded sample data" : "Use a company-owned Shared Drive and sender mailbox"}</label><label><input type="checkbox" /> {simulation ? "Confirm no OAuth account or Google token is connected" : "Restrict authorization to the approved Workspace domain"}</label><label><input type="checkbox" /> Keep Gmail filing review-first and project-specific</label><label><input type="checkbox" /> Verify the two shared calendars and Sheet mirror before staff launch</label></div>
    {filingMessage && <GmailFilingModal message={filingMessage} projects={projects} projectId={filingProjectId} preview={filingPreview} loading={filingLoading} submitting={filingSubmitting} onProject={(projectId) => { setFilingProjectId(projectId); setFilingPreview(null); }} onPreview={previewGmailFiling} onConfirm={confirmGmailFiling} onClose={closeFilingReview} />}
  </section>;
}

function GmailFilingModal({ message, projects, projectId, preview, loading, submitting, onProject, onPreview, onConfirm, onClose }: {
  message: WorkspaceMessage;
  projects: Project[];
  projectId: string;
  preview: GmailFilingPreview | null;
  loading: boolean;
  submitting: boolean;
  onProject: (projectId: string) => void;
  onPreview: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const selectedProject = projects.find((project) => project.id === projectId);
  const attachmentLabel = preview?.message.attachmentCount ?? 0;
  const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const alreadyFiled = preview?.existing?.filed === true;
  return <div className="modal-backdrop" role="presentation"><div className="modal gmail-filing-modal" role="dialog" aria-modal="true" aria-labelledby="gmail-filing-title"><header><div><p className="eyebrow">Review-approved Gmail filing</p><h2 id="gmail-filing-title">File to one project</h2></div><button onClick={onClose} aria-label="Close" disabled={loading || submitting}><X size={20} /></button></header><div className="modal-detail"><div className="filing-message-summary"><Mail size={17} /><div><strong>{message.subject || "(No subject)"}</strong><span>{message.from || "Unknown sender"}{message.date ? ` · ${new Date(message.date).toLocaleString()}` : ""}</span></div></div><label className="filing-project-select">Exact independent project<select value={projectId} onChange={(event) => onProject(event.target.value)} disabled={loading || submitting}><option value="">Choose a project…</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.number} — {project.name} · {project.client}</option>)}</select></label>{selectedProject && <p className={selectedProject.driveFolderId ? "filing-workspace-ready" : "filing-workspace-pending"}>{selectedProject.driveFolderId ? <><CheckCircle2 size={14} /> Managed Drive workspace detected for this project.</> : <><CircleAlert size={14} /> This project needs its managed Drive workspace before email can be filed. The review will not create a folder.</>}</p>}<p className="form-help"><ShieldCheck size={14} /> The original email becomes an <b>.eml</b> in <b>05_Correspondence / Email Archive</b>. Attachments go to <b>05_Correspondence / Email Attachments</b>. Your Gmail Inbox label is retained.</p>{preview && <div className="filing-preview"><div className="filing-preview-heading"><div><FolderOpen size={16} /><strong>{preview.project.number} — {preview.project.name}</strong><span>{preview.project.client}</span></div>{alreadyFiled && <Status text="Filed" />}</div>{alreadyFiled ? <p className="filing-existing">This email was already filed to this project. No second copy will be made.</p> : <><dl><div><dt>Email archive</dt><dd>{preview.destinations.emailArchive}</dd></div><div><dt>Attachments</dt><dd>{preview.destinations.attachments}</dd></div></dl><div className="filing-attachments"><strong>{attachmentLabel} attachment{attachmentLabel === 1 ? "" : "s"}</strong>{preview.message.attachments.length ? <ul>{preview.message.attachments.map((attachment, index) => <li key={`${attachment.filename}-${index}`}><FileText size={13} /><span>{attachment.filename}</span><small>{attachment.mimeType} · {formatBytes(attachment.byteSize)}</small></li>)}</ul> : <p>No separate attachments were found. The original email will still be copied as an .eml file.</p>}</div><p className="filing-confirmation"><ShieldCheck size={14} /> Nothing has been copied yet. Select <b>Copy email to project</b> to complete this one approved filing.</p></>}</div>}</div><footer className="modal-footer"><button className="soft-button" onClick={onClose} disabled={loading || submitting}>Cancel</button>{preview ? <button className="primary-button" onClick={onConfirm} disabled={loading || submitting || alreadyFiled}>{submitting ? "Copying…" : alreadyFiled ? "Already filed" : `Copy email + ${attachmentLabel} attachment${attachmentLabel === 1 ? "" : "s"}`}</button> : <button className="primary-button" onClick={onPreview} disabled={!projectId || loading || submitting}>{loading ? "Reviewing…" : "Review destination"}</button>}</footer></div></div>;
}

function GmailReplyModal({ message, body, saving, onBody, onSave, onClose }: { message: WorkspaceMessage; body: string; saving: boolean; onBody: (value: string) => void; onSave: () => void; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation"><div className="modal gmail-reply-modal" role="dialog" aria-modal="true" aria-labelledby="gmail-reply-title"><header><div><p className="eyebrow">Workspace Gmail draft</p><h2 id="gmail-reply-title">Save a reply draft</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={(event) => { event.preventDefault(); onSave(); }}><div className="modal-detail"><div className="filing-message-summary"><Mail size={17} /><div><strong>{message.subject || "(No subject)"}</strong><span>Reply target: {message.from || "original sender"}</span></div></div><label>Reply message<textarea value={body} onChange={(event) => onBody(event.target.value)} placeholder="Write your reply…" maxLength={6000} required disabled={saving} /></label><p className="form-help"><ShieldCheck size={14} /> Live mode saves an unsent draft in the original Workspace Gmail thread. Simulation stores a local draft only. Sending remains a separate, deliberate action.</p></div><footer className="modal-footer"><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !body.trim()}>{saving ? "Saving…" : <><Reply size={16} /> Save draft</>}</button></footer></form></div></div>;
}

function TestingLaunchPanel({ onGoogleSetup }: { onGoogleSetup: () => void }) {
  return <section className="panel test-launch"><div className="settings-heading"><div><p className="eyebrow">Live verification</p><h2>Test & launch checklist</h2><p>Verify only workflows backed by durable records, then connect the company Workspace when its tenant and permissions are ready.</p></div><button className="primary-button" onClick={onGoogleSetup}>Open Workspace check</button></div><ol className="test-checklist"><li><strong>Clients and projects:</strong> add a client, create two independent projects, create their folders, refresh, and verify the relationships persist.</li><li><strong>Meetings:</strong> save an Otter-linked summary with decisions and action items, reload it, and ask the assistant about the meeting.</li><li><strong>Inbox:</strong> connect Workspace Gmail, prepare labels, save a reply draft, and review-file one message to the exact project.</li><li><strong>Calendar:</strong> verify connected calendar readiness. Shift, crew, conflict, publishing, and acknowledgement tests remain blocked until those durable models exist.</li><li><strong>AI:</strong> ask a project question and open every cited source. Configure OpenAI separately before evaluating generated answers.</li><li><strong>Workspace launch:</strong> verify the Shared Drive, mailbox, Sheet, shared calendars, OAuth client, allowed domain, and admin-approved connection.</li></ol></section>;
}

function SourceDetailModal({ citation, onClose }: { citation: AssistantCitation; onClose: () => void }) {
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Assistant source</p><h2>Evidence reference</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="modal-detail"><strong>{citation.label}</strong><p>{citation.detail}</p><p>This is a server-selected project record reference. Meeting notes use saved summaries, decisions, action items, notes, and bounded transcript excerpts. Raw Gmail bodies and Drive files are not returned yet.</p></div><footer className="modal-footer"><button className="primary-button" onClick={onClose}>Done</button></footer></div></div>;
}

function ProjectUpdateModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (draft: ProjectUpdateDraft) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({ project, subject: String(form.get("subject")), message: String(form.get("message")) });
  }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Project communication</p><h2>Prepare update</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>To<input value={`${project.client} contacts`} readOnly aria-label="Recipients" /></label><label>Subject<input name="subject" required defaultValue={`${project.number} — project update`} /></label><label>Message<textarea name="message" required defaultValue={`Status update for ${project.name}:`} /></label><p className="form-help"><Mail size={14} /> This creates a draft only. Gmail sending will be enabled after OAuth and consent controls are in place.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button"><Send size={16} /> Prepare update</button></footer></form></div></div>;
}

function LeadModal({ onClose, onSave }: { onClose: () => void; onSave: (l: Lead) => Promise<void> }) { const [saving, setSaving] = useState(false); async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setSaving(true); const form = new FormData(e.currentTarget); const company = String(form.get("company")); const estimatedValue = Number(form.get("value") ?? 0); try { await onSave({ id: "", number: "", company, contact: String(form.get("contact")), project: String(form.get("project")), value: money(estimatedValue), estimatedValue, stage: "New inquiry", source: String(form.get("source")), next: String(form.get("notes")), site: String(form.get("site")), status: "active", initials: recordInitials(company), color: "sage" }); } finally { setSaving(false); } }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">New opportunity</p><h2>Add a lead</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client company<input name="company" required placeholder="Business name" /></label><div className="form-row"><label>Primary contact<input name="contact" required placeholder="Full name" /></label><label>Lead source<select name="source"><option>Website</option><option>Referral</option><option>Bid invite</option><option>Repeat client</option></select></label></div><label>Project / opportunity<input name="project" required placeholder="Project name" /></label><div className="form-row"><label>Estimated value<input name="value" type="number" min="0" step="1" required placeholder="Estimated amount" /></label><label>Project site<input name="site" required placeholder="Address or city and state" /></label></div><label>Next action<textarea name="notes" required placeholder="What needs to happen next?" /></label><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add to pipeline"}</button></footer></form></div></div>;
}

function ClientModal({ onClose, onSave }: { onClose: () => void; onSave: (client: Client) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); const name = String(form.get("name")); try { await onSave({ id: "", code: "", name, contact: String(form.get("contact")), email: String(form.get("email")), industry: String(form.get("industry")), status: String(form.get("status")), initials: recordInitials(name), color: "sage", googleStatus: "Setup pending" }); } finally { setSaving(false); } }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Client Directory</p><h2>Add a client</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client business name<input name="name" required placeholder="Business name" /></label><div className="form-row"><label>Primary contact<input name="contact" required placeholder="Full name" /></label><label>Work email<input name="email" type="email" required placeholder="name@company.com" /></label></div><div className="form-row"><label>Industry<select name="industry"><option>General contractor</option><option>Healthcare</option><option>Retail</option><option>Hospitality</option><option>Property management</option><option>Other commercial</option></select></label><label>Client status<select name="status"><option>Active</option><option>Prospect</option><option>Inactive</option></select></label></div><p className="form-help"><FolderTree size={14} /> The app saves the client first, then syncs the Client Directory when Google Sheets is connected. The account folder is created with the first project workspace.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add client"}</button></footer></form></div></div>;
}

function NewProjectModal({ clients, onClose, onSave }: { clients: Client[]; onClose: () => void; onSave: (project: Project) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); const clientId = String(form.get("clientId")); const client = clients.find((item) => item.id === clientId); if (!client) { setSaving(false); return; } const name = String(form.get("name")); try { await onSave({ id: "", clientId, number: "", client: client.name, name, status: String(form.get("status")), progress: 0, value: form.get("value") ? money(Number(form.get("value"))) : "TBD", site: String(form.get("site")), lead: String(form.get("manager")), date: "Dates not set", accent: client.color }); } finally { setSaving(false); } }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Independent project</p><h2>Create a project</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client<select name="clientId" required>{clients.map((client) => <option value={client.id} key={client.id}>{client.name} · {client.code}</option>)}</select></label><label>Project name<input name="name" required placeholder="Project name" /></label><div className="form-row"><label>Site<input name="site" required placeholder="Address or city and state" /></label><label>Project manager<input name="manager" required placeholder="Assigned manager" /></label></div><div className="form-row"><label>Status<select name="status"><option>Planning</option><option>Mobilizing</option><option>Installation</option><option>Closeout</option></select></label><label>Estimated value<input name="value" type="number" min="0" placeholder="Estimated amount" /></label></div><p className="form-help"><FolderTree size={14} /> This creates an independent project number and Project Register row. Create its Drive folder from the project after saving.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Creating…" : "Create project"}</button></footer></form></div></div>;
}

function RuleModal({ onClose, onSave }: { onClose: () => void; onSave: (rule: FilingRuleDraft) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); try { await onSave({ name: String(form.get("name")), enabled: true, priority: Number(form.get("priority")), matchSummary: String(form.get("matchSummary")), action: String(form.get("action")) as FilingRuleDraft["action"], targetCategory: String(form.get("targetCategory")), approvalRequired: true }); } finally { setSaving(false); } }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Gmail intake</p><h2>Add an email filing rule</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Rule name<input name="name" required placeholder="e.g. Estimator bid invitations" /></label><div className="form-row"><label>Priority<input name="priority" type="number" min="1" defaultValue="10" required /></label><label>Action<select name="action"><option value="suggest">Suggest a project</option><option value="review">Send to review</option><option value="ignore">Ignore</option></select></label></div><label>When this matches<textarea name="matchSummary" required placeholder="Example: sender is estimator@builder.com and subject contains BID" /></label><label>Default Drive destination<input name="targetCategory" required defaultValue="05_Correspondence / Email Archive" /></label><p className="form-help"><ShieldCheck size={14} /> New rules always require review before Gmail labels, email archives, or attachments are changed.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add rule"}</button></footer></form></div></div>;
}

function ProjectDrawer({ project, onClose, notify, onProvisionDrive }: { project: Project; onClose: () => void; notify: (s: string) => void; onProvisionDrive: (project: Project) => Promise<void> }) {
  const [tab, setTab] = useState("Overview");
  const [provisioning, setProvisioning] = useState(false);

  async function handleDrive() {
    if (project.driveUrl) {
      window.open(project.driveUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setProvisioning(true);
    await onProvisionDrive(project);
    setProvisioning(false);
  }

  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="project-drawer">
      <header><button onClick={onClose} aria-label="Close project"><X size={20} /></button><Status text={project.status} /><span>{project.number}</span></header>
      <div className="drawer-title"><p>{project.client}</p><h2>{project.name}</h2><div><span><MapPin size={14} />{project.site}</span><span><CalendarDays size={14} />{project.date}</span></div></div>
      <nav>{["Overview", "Meetings", "Tasks", "Files", "Schedule", "Activity"].map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
      <div className="drawer-body">
        {tab === "Overview" ? <>
          <section className="project-health"><div><span>Delivery progress</span><strong>Not tracked yet</strong></div><p><CheckCircle2 size={15} /> This live project is managed independently from other client work</p></section>
          <div className="drawer-stats"><div><span>Estimated value</span><strong>{project.value}</strong></div><div><span>Project manager</span><strong>{project.lead}</strong></div><div><span>Tasks</span><strong>Not connected</strong></div><div><span>Files</span><strong>{project.driveFolderId ? "Drive ready" : "Folder pending"}</strong></div></div>
          <section className="client-account-notes"><h3>Live project workspace</h3><p>Meetings and Drive folder links are durable now. Tasks, dated shifts, file indexing, and project activity feeds will appear after their storage and APIs are implemented.</p></section>
        </> : tab === "Meetings" ? <ProjectMeetings project={project} notify={notify} /> : <EmptyProjectTab tab={tab} />}
      </div>
      <footer>
        <button className="soft-button" onClick={handleDrive} disabled={provisioning}><FolderOpen size={16} /> {provisioning ? "Creating folder…" : project.driveUrl ? "Open Drive folder" : "Create Drive folder"}</button>
        <button className="primary-button" onClick={() => notify("Project update composer opened")}><Send size={16} /> Send update</button>
      </footer>
    </aside>
  </div>;
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

function ProjectMeetings({ project, notify }: { project: Project; notify: (message: string) => void }) {
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
    notify(`${meeting.title} saved to ${project.number}`);
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

  return <div className="modal-backdrop meeting-modal-backdrop"><div className="modal meeting-modal"><header><div><p className="eyebrow">{project.number} · Project meeting</p><h2>Capture meeting notes</h2></div><button onClick={onClose} aria-label="Close meeting form" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}>
    <label>Meeting title<input name="title" required maxLength={160} placeholder="e.g. Client scope review" /></label>
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
  </form></div></div>;
}

function ClientDrawer({ client, projects, onClose, onNewProject, onProject }: { client: Client; projects: Project[]; onClose: () => void; onNewProject: () => void; onProject: (project: Project) => void }) { return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="project-drawer client-drawer"><header><button onClick={onClose} aria-label="Close client"><X size={20} /></button><Status text={client.status} /><span>{client.code}</span></header><div className="drawer-title"><p>Client account</p><h2>{client.name}</h2><div><span><ContactRound size={14} />{client.contact}</span><span><Mail size={14} />{client.email || "Contact email pending"}</span></div></div><div className="client-drawer-body"><section className="client-account-card"><div className="directory-badge"><FolderTree size={19} /></div><div><strong>Client account folder</strong><span>{client.driveUrl ? "Google Drive folder ready" : "Google Drive folder not created yet"}</span></div></section><div className="client-summary-grid"><div><span>Industry</span><strong>{client.industry}</strong></div><div><span>Independent projects</span><strong>{projects.length}</strong></div></div><section className="client-project-section"><header><h3>Projects for this client</h3><button onClick={onNewProject}><Plus size={14} /> New project</button></header>{projects.map((project) => <button type="button" className="client-project-link" key={project.id} onClick={() => onProject(project)}><div><Status text={project.status} /><strong>{project.name}</strong><span>{project.number} · {project.site}</span></div><ChevronRight size={16} /></button>)}{!projects.length && <p className="empty-client-projects">No projects yet. Create the first independent project for this client.</p>}</section><section className="client-account-notes"><h3>Account-level documents</h3><p>Store reusable client documents here. Project-specific documents stay inside their own project folders.</p></section></div></aside></div>; }

function EmptyProjectTab({ tab }: { tab: string }) {
  const Icon = tab === "Tasks" ? ListTodo : tab === "Files" ? FolderOpen : tab === "Schedule" ? CalendarDays : Activity;
  const description = tab === "Files" ? "The Drive folder link is live, but indexed file records are not implemented yet." : tab === "Tasks" ? "Durable project tasks and follow-ups are not implemented yet." : tab === "Schedule" ? "Durable shifts, crews, and assignments are not implemented yet." : "The project activity feed is not implemented yet.";
  return <div className="empty-tab"><div><Icon size={25} /></div><h3>{tab} not connected yet</h3><p>{description}</p></div>;
}

function Metric({ label, value, note, trend, icon: Icon, color }: { label: string; value: string; note: string; trend: string; icon: typeof Zap; color: string }) { return <article className="metric-card"><div className={`metric-icon ${color}`}><Icon size={19} /></div><div className="metric-top"><span>{label}</span><small>{trend}</small></div><strong>{value}</strong><p>{note}</p></article> }
function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) { return <header className="panel-header"><div><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}</div>{action && <button onClick={onAction}>{action}<ChevronRight size={15} /></button>}</header> }
function PageTitle({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div> }
function Avatar({ initials, color }: { initials: string; color: string }) { return <div className={`mini-avatar ${color}`}>{initials}</div> }
function Status({ text }: { text: string }) { return <span className={`status status-${text.toLowerCase().replaceAll(" ", "-")}`}>{text}</span> }
