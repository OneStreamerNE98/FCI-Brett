"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Bell, Bot, BriefcaseBusiness, Building2, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CircleAlert, CircleCheckBig, Clipboard, Clock3, ContactRound, FileText, FolderOpen, FolderTree, HardHat,
  Inbox, LayoutDashboard, ListTodo, Mail, MapPin, Menu, MessageSquareText, MoreHorizontal,
  ListFilter, LogOut, Plus, RefreshCw, Reply, Search, Send, Settings, ShieldCheck, Sparkles, Trash2, Upload, Users, X, Zap,
} from "lucide-react";
import { DEFAULT_FILING_RULES, DRIVE_BLUEPRINT, evaluateInboxFilingRules, type FilingRuleDraft } from "./lib/google-workspace";
import { PhoneInstallPanel } from "./PhoneInstallPanel";

type View = "Overview" | "Leads" | "Clients" | "Projects" | "Schedule" | "Inbox" | "AI Assistant" | "Reports" | "Settings";
type Lead = { id: string; company: string; contact: string; project: string; value: string; stage: string; source: string; next: string; initials: string; color: string };
type Client = { id: string; code: string; name: string; contact: string; email: string; industry: string; status: string; initials: string; color: string; googleStatus: "Ready" | "Setup pending" };
type Project = { id: string; clientId: string; number: string; client: string; name: string; status: string; progress: number; value: string; site: string; lead: string; date: string; accent: string; driveFolderId?: string; driveUrl?: string };
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
type ShiftAssignment = { id: string; crew: string; site: string; day: string; time: string; status: "Pending" | "Acknowledged" };
type WorkspaceSearchResult = { kind: "client" | "project" | "contact"; id: string; title: string; subtitle: string; clientId?: string; projectId?: string };

const leadStages = ["New inquiry", "Site visit", "Proposal", "Decision"];

const initialLeads: Lead[] = [
  { id: "L-1048", company: "Hudson Retail Group", contact: "Elena Park", project: "Ridgeway Flagship", value: "$86,500", stage: "New inquiry", source: "Website", next: "Call today", initials: "HR", color: "sage" },
  { id: "L-1046", company: "Northstar Contractors", contact: "Marcus Hill", project: "Harbor Point Offices", value: "$142,000", stage: "Site visit", source: "Referral", next: "Jul 14 · 9:30 AM", initials: "NC", color: "blue" },
  { id: "L-1044", company: "Mason & Reed", contact: "Priya Shah", project: "Fairfield Commons", value: "$64,800", stage: "Proposal", source: "Repeat client", next: "Follow up tomorrow", initials: "MR", color: "amber" },
  { id: "L-1041", company: "Crescent Builders", contact: "Tony Diaz", project: "Willow Creek School", value: "$218,400", stage: "Decision", source: "Bid invite", next: "Decision Jul 18", initials: "CB", color: "violet" },
];

const initialClients: Client[] = [
  { id: "client-atlas", code: "CL-0001", name: "Atlas Design Group", contact: "Sarah Kim", email: "sarah.kim@atlas.example", industry: "Healthcare", status: "Active", initials: "AD", color: "green", googleStatus: "Setup pending" },
  { id: "client-morgan", code: "CL-0002", name: "Morgan Construction", contact: "Devin Ross", email: "devin.ross@morgan.example", industry: "General contractor", status: "Active", initials: "MC", color: "orange", googleStatus: "Setup pending" },
  { id: "client-hudson", code: "CL-0003", name: "Hudson Retail Group", contact: "Elena Park", email: "elena.park@hudson.example", industry: "Retail", status: "Prospect", initials: "HR", color: "sage", googleStatus: "Setup pending" },
  { id: "client-elm", code: "CL-0004", name: "Elm Street Hospitality", contact: "Nora Reed", email: "nora.reed@elm.example", industry: "Hospitality", status: "Active", initials: "EH", color: "blue", googleStatus: "Setup pending" },
];

const initialProjects: Project[] = [
  { id: "project-westport", clientId: "client-atlas", number: "CF-2026-041", client: "Atlas Design Group", name: "Westport Medical Center", status: "Installation", progress: 68, value: "$184,250", site: "Westport, CT", lead: "Sarah Kim", date: "Jul 15 – Aug 2", accent: "green" },
  { id: "project-northpoint", clientId: "client-atlas", number: "CF-2026-047", client: "Atlas Design Group", name: "Northpoint Imaging Suite", status: "Planning", progress: 12, value: "$74,900", site: "Norwalk, CT", lead: "Sarah Kim", date: "Aug 19 – Aug 30", accent: "green" },
  { id: "project-harbor", clientId: "client-morgan", number: "CF-2026-038", client: "Morgan Construction", name: "One Harbor Plaza", status: "Mobilizing", progress: 42, value: "$296,800", site: "Stamford, CT", lead: "Devin Ross", date: "Jul 22 – Sep 6", accent: "orange" },
  { id: "project-foundry", clientId: "client-elm", number: "CF-2026-029", client: "Elm Street Hospitality", name: "The Foundry Hotel", status: "Closeout", progress: 91, value: "$128,600", site: "New Haven, CT", lead: "Sarah Kim", date: "Jun 3 – Jul 19", accent: "blue" },
];

const schedule = [
  { time: "8:30 AM", title: "Site walk · Westport Medical", meta: "Atlas Design Group · Sarah + Mike", type: "appointment", confirmed: "Both confirmed" },
  { time: "10:00 AM", title: "Moisture testing · Harbor Plaza", meta: "Crew Rivera · 3 installers", type: "field", confirmed: "Acknowledged" },
  { time: "1:30 PM", title: "Client scope review", meta: "Hudson Retail Group · Video call", type: "appointment", confirmed: "Client pending" },
  { time: "3:00 PM", title: "Material delivery · Foundry Hotel", meta: "Dock B · Luis Moreno", type: "delivery", confirmed: "Confirmed" },
];

const navItems: { label: View; icon: typeof LayoutDashboard; badge?: string }[] = [
  { label: "Overview", icon: LayoutDashboard }, { label: "Leads", icon: Zap, badge: "4" },
  { label: "Clients", icon: ContactRound }, { label: "Projects", icon: BriefcaseBusiness }, { label: "Schedule", icon: CalendarDays, badge: "2" },
  { label: "Inbox", icon: Inbox }, { label: "AI Assistant", icon: Sparkles },
  { label: "Reports", icon: Activity }, { label: "Settings", icon: Settings },
];

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
  const [selectedProject, setSelectedProject] = useState<Project>(initialProjects[0]);
  const [selectedClient, setSelectedClient] = useState<Client>(initialClients[0]);
  const [projectOpen, setProjectOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [leads, setLeads] = useState(initialLeads);
  const [clients, setClients] = useState(initialClients);
  const [projectItems, setProjectItems] = useState(initialProjects);
  const [filingRules, setFilingRules] = useState<FilingRuleDraft[]>(DEFAULT_FILING_RULES);
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

  async function refreshDirectoryData() {
    try {
      const [clientData, projectData, ruleData, mirrorData] = await Promise.all([
        fetch("/api/v1/clients").then((r) => r.ok ? r.json() : null),
        fetch("/api/v1/projects").then((r) => r.ok ? r.json() : null),
        fetch("/api/v1/filing-rules").then((r) => r.ok ? r.json() : null),
        fetch("/api/v1/integrations/google/sheets/status").then((r) => r.ok ? r.json() : null),
      ]);
      if (clientData?.clients?.length) setClients(clientData.clients.map((client: Record<string, unknown>) => ({ id: String(client.id), code: String(client.client_code), name: String(client.name), contact: String(client.primary_contact_name ?? "Primary contact"), email: String(client.primary_contact_email ?? ""), industry: String(client.industry ?? "Commercial"), status: String(client.status), initials: String(client.name).split(" ").map((x) => x[0]).slice(0, 2).join(""), color: "sage", googleStatus: "Setup pending" as const })));
      if (projectData?.projects?.length) setProjectItems(projectData.projects.map((project: Record<string, unknown>) => ({ id: String(project.id), clientId: String(project.client_id), number: String(project.project_number), client: String(project.client_name), name: String(project.name), status: String(project.status), progress: 0, value: project.estimated_value ? `$${Number(project.estimated_value).toLocaleString()}` : "TBD", site: String(project.site ?? "Site pending"), lead: String(project.project_manager ?? "Unassigned"), date: "Dates pending", accent: "sage", driveFolderId: project.drive_folder_id ? String(project.drive_folder_id) : undefined, driveUrl: project.drive_url ? String(project.drive_url) : undefined })));
      if (ruleData?.rules?.length) setFilingRules(ruleData.rules.map((rule: Record<string, unknown>) => ({ id: rule.id ? String(rule.id) : undefined, name: String(rule.name), enabled: Boolean(rule.enabled), priority: Number(rule.priority), matchSummary: String(rule.matchSummary ?? rule.match_summary), action: String(rule.action) as FilingRuleDraft["action"], targetCategory: String(rule.targetCategory ?? rule.target_category), approvalRequired: Boolean(rule.approvalRequired ?? rule.approval_required) })));
      if (mirrorData?.mirror) setSheetMirror(mirrorData.mirror as SheetMirrorStatus);
    } catch { /* Keep the local prototype usable while the service starts. */ }
  }

  useEffect(() => {
    const refresh = window.setTimeout(() => { void refreshDirectoryData(); }, 0);
    return () => window.clearTimeout(refresh);
  }, []);

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
      setProjectUpdate(selectedProject);
      return;
    }
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function addLead(lead: Lead) {
    let savedRemotely = false;
    try {
      const response = await fetch("/api/v1/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "lead", status: "new", payload: lead }) });
      savedRemotely = response.ok;
    } catch { /* The prototype still keeps the user's entry locally. */ }
    setLeads((current) => [lead, ...current]);
    setLeadModal(false);
    notify(savedRemotely ? `${lead.company} added to your pipeline` : `${lead.company} added locally; retry sync when the data service is available`);
  }

  async function addClient(client: Client) {
    let savedClient = client;
    let savedRemotely = false;
    try {
      const response = await fetch("/api/v1/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: client.name, industry: client.industry, status: client.status.toLowerCase(), primaryContact: { name: client.contact, email: client.email } }) });
      if (!response.ok) throw new Error("Client could not be saved");
      const data = await response.json() as { id: string; clientCode: string; sheetSync?: { status?: string; message?: string } };
      savedClient = { ...client, id: data.id, code: data.clientCode };
      savedRemotely = true;
      if (data.sheetSync?.status === "synced") await refreshDirectoryData();
      notify(data.sheetSync?.message ?? `${client.name} saved in FCI Operations`);
    } catch { /* The local prototype remains usable while a data service is unavailable. */ }
    const replacingDemoDirectory = clients.every((current) => initialClients.some((demo) => demo.id === current.id));
    setClients((current) => replacingDemoDirectory ? [savedClient] : [savedClient, ...current]);
    if (replacingDemoDirectory) setProjectItems([]);
    setClientModal(false);
    if (!savedRemotely) notify(`${client.name} added locally; retry sync when the data service is available`);
  }

  async function addProject(project: Project) {
    let savedProject = project;
    let savedRemotely = false;
    try {
      const response = await fetch("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: project.clientId, name: project.name, status: project.status.toLowerCase(), site: project.site, projectManager: project.lead, estimatedValue: Number(project.value.replace(/[^0-9]/g, "")) || undefined }) });
      if (!response.ok) throw new Error("Project could not be saved");
      const data = await response.json() as { id: string; projectNumber: string; sheetSync?: { status?: string; message?: string } };
      savedProject = { ...project, id: data.id, number: data.projectNumber };
      savedRemotely = true;
      if (data.sheetSync?.status === "synced") await refreshDirectoryData();
      notify(data.sheetSync?.message ?? `${project.name} saved in FCI Operations`);
    } catch { /* The local prototype remains usable while a data service is unavailable. */ }
    setProjectItems((current) => [savedProject, ...current]);
    setProjectModal(false);
    if (!savedRemotely) notify(`${project.name} created locally; retry sync when the data service is available`);
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
      setSelectedProject((current) => current.id === project.id ? updated : current);
      notify(data.created ? `${project.name} now has a ${data.environment ?? "test"} Drive workspace` : `${project.name} already has a Drive workspace`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The project Drive workspace could not be created.");
    }
  }

  async function addRule(rule: FilingRuleDraft) {
    let savedRule = rule;
    let savedRemotely = false;
    try {
      const response = await fetch("/api/v1/filing-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule) });
      if (!response.ok) throw new Error("Rule could not be saved");
      const data = await response.json() as { id: string };
      savedRule = { ...rule, id: data.id };
      savedRemotely = true;
    } catch { /* The local prototype remains usable while a data service is unavailable. */ }
    setFilingRules((current) => [...current, savedRule].sort((a, b) => a.priority - b.priority));
    setRuleModal(false);
    notify(savedRemotely ? `Email rule “${rule.name}” added` : `Email rule “${rule.name}” saved locally; retry sync when the data service is available`);
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

  function advanceLead(id: string) {
    const currentLead = leads.find((lead) => lead.id === id);
    if (!currentLead) return;
    const currentIndex = leadStages.indexOf(currentLead.stage);
    const nextStage = leadStages[Math.min(currentIndex + 1, leadStages.length - 1)];
    if (nextStage === currentLead.stage) {
      notify(`${currentLead.company} is already at the final pipeline stage`);
      return;
    }
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, stage: nextStage, next: "Review this stage" } : lead));
    notify(`${currentLead.company} moved to ${nextStage}`);
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
          {navItems.slice(0, 7).map(({ label, icon: Icon, badge }) => <button key={label} className={view === label ? "active" : ""} onClick={() => { setView(label); setMobileNav(false); setWorkspaceMenuOpen(false); setProfileMenuOpen(false); }} aria-label={label} title={label}><Icon size={18} /><span>{label}</span>{badge && <b>{badge}</b>}</button>)}
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
          <div className="top-actions"><div className="notification-wrap"><button className="icon-button" onClick={() => setNotificationsOpen((current) => !current)} aria-label="Notifications" aria-expanded={notificationsOpen}><Bell size={19} /><i /></button>{notificationsOpen && <div className="notification-menu" role="status"><strong>Needs attention</strong><button onClick={() => { setView("Schedule"); setNotificationsOpen(false); }}>2 schedule confirmations pending</button><button onClick={() => { setView("Inbox"); setNotificationsOpen(false); }}>Open your connected Gmail inbox</button><button onClick={() => { setView("Projects"); setNotificationsOpen(false); }}>1 closeout follow-up overdue</button></div>}</div><button className="primary-button" onClick={() => setLeadModal(true)}><Plus size={17} /> Add lead</button></div>
        </header>

        <div className="page-wrap">
          {view === "Overview" && <Overview firstName={firstName} leads={leads} projects={projectItems} onView={setView} onProject={openProject} />}
          {view === "Leads" && <LeadsView leads={leads} onAdd={() => setLeadModal(true)} onAdvance={advanceLead} />}
          {view === "Clients" && <ClientsView clients={clients} projects={projectItems} projectCounts={clientProjectCounts} onAdd={() => setClientModal(true)} onClient={openClient} onNewProject={() => setProjectModal(true)} sheetMirror={sheetMirror} onSyncGoogleSheet={syncGoogleSheet} syncingSheet={sheetSyncing} />}
          {view === "Projects" && <ProjectsView projects={projectItems} onNewProject={() => setProjectModal(true)} onProject={openProject} />}
          {view === "Schedule" && <ScheduleView notify={notify} />}
          {view === "Inbox" && <InboxView notify={notify} onRules={openRules} projects={projectItems} clients={clients} rules={filingRules} onGoogleSetup={openGoogleWorkspace} />}
          {view === "AI Assistant" && <AssistantView projects={projectItems} />}
          {view === "Reports" && <ReportsView />}
          {view === "Settings" && <SettingsView notify={notify} section={settingsArea} onSection={setSettingsArea} rules={filingRules} projects={projectItems} userName={userName} userEmail={userEmail} onGoogleSetup={openGoogleWorkspace} onAddRule={() => setRuleModal(true)} onUpdateRule={updateRule} onDeleteRule={deleteRule} sheetMirror={sheetMirror} onSyncGoogleSheet={syncGoogleSheet} syncingSheet={sheetSyncing} />}
        </div>
      </main>
      {leadModal && <LeadModal onClose={() => setLeadModal(false)} onSave={addLead} />}
      {clientModal && <ClientModal onClose={() => setClientModal(false)} onSave={addClient} />}
      {projectModal && <NewProjectModal clients={clients} onClose={() => setProjectModal(false)} onSave={addProject} />}
      {ruleModal && <RuleModal onClose={() => setRuleModal(false)} onSave={addRule} />}
      {projectOpen && <ProjectDrawer project={selectedProject} onClose={() => setProjectOpen(false)} notify={notify} onProvisionDrive={provisionProjectDrive} />}
      {clientOpen && <ClientDrawer client={selectedClient} projects={projectItems.filter((project) => project.clientId === selectedClient.id)} onClose={() => setClientOpen(false)} onNewProject={() => { setClientOpen(false); setProjectModal(true); }} />}
      {projectUpdate && <ProjectUpdateModal project={projectUpdate} onClose={() => setProjectUpdate(null)} onSave={(draft) => { setProjectUpdate(null); notify(`Update for ${draft.project.name} prepared. Connect Gmail before sending.`); }} />}
      {toast && <div className="toast"><CheckCircle2 size={18} />{toast}</div>}
    </div>
  );
}

function Overview({ firstName, leads, projects, onView, onProject }: { firstName: string; leads: Lead[]; projects: Project[]; onView: (v: View) => void; onProject: (p: Project) => void }) {
  return <>
    <div className="page-heading"><div><p className="eyebrow">Saturday, July 11</p><h1>Good morning, {firstName}.</h1><p>Here’s what needs your attention today.</p></div><button className="soft-button" onClick={() => onView("Schedule")}><CalendarDays size={16} /> View calendar</button></div>
    <section className="attention-strip"><div className="pulse-icon"><Zap size={19} /></div><div><strong>5 items need attention</strong><span>2 confirmations, 2 overdue tasks, 1 schedule conflict</span></div><button onClick={() => onView("Schedule")}>Review now <ChevronRight size={15} /></button></section>
    <section className="metrics-grid">
      <Metric label="Active pipeline" value="$511.7k" note="12 open opportunities" trend="+18%" icon={Zap} color="orange" />
      <Metric label="Projects in progress" value="8" note="3 crews in the field" trend="On track" icon={HardHat} color="green" />
      <Metric label="Upcoming appointments" value="6" note="Next 7 days" trend="2 pending" icon={CalendarDays} color="blue" />
      <Metric label="Open follow-ups" value="11" note="2 overdue" trend="Review" icon={ListTodo} color="violet" />
    </section>
    <section className="dashboard-grid">
      <div className="panel pipeline-panel">
        <PanelHeader title="Lead pipeline" subtitle="This month" action="View all" onAction={() => onView("Leads")} />
        <div className="pipeline-head"><span>Client / opportunity</span><span>Stage</span><span>Est. value</span><span>Next action</span></div>
        {leads.slice(0, 4).map((lead) => <div className="pipeline-row" key={lead.id}><div className="client-cell"><Avatar initials={lead.initials} color={lead.color} /><div><strong>{lead.company}</strong><span>{lead.project}</span></div></div><div><Status text={lead.stage} /></div><strong className="value-cell">{lead.value}</strong><div className="next-cell"><Clock3 size={14} />{lead.next}</div></div>)}
      </div>
      <div className="panel schedule-panel">
        <PanelHeader title="Today’s schedule" subtitle="4 events" action="Open calendar" onAction={() => onView("Schedule")} />
        <div className="timeline">{schedule.map((item, i) => <div className="timeline-item" key={item.time}><div className="timeline-time">{item.time}</div><div className={`timeline-dot ${item.type}`} />{i < schedule.length - 1 && <div className="timeline-line" />}<div className="timeline-content"><strong>{item.title}</strong><span>{item.meta}</span><small className={item.confirmed.includes("pending") ? "pending" : ""}><Check size={12} />{item.confirmed}</small></div></div>)}</div>
      </div>
    </section>
    <section className="dashboard-grid lower-grid">
      <div className="panel projects-panel"><PanelHeader title="Active projects" subtitle="8 total" action="View projects" onAction={() => onView("Projects")} /><div className="project-cards">{projects.map((project) => <button className="project-card" key={project.number} onClick={() => onProject(project)}><div className="project-card-top"><Status text={project.status} /><MoreHorizontal size={17} /></div><span className="project-number">{project.number}</span><h3>{project.name}</h3><p>{project.client}</p><div className="progress-row"><span>Progress</span><b>{project.progress}%</b></div><div className="progress"><i style={{ width: `${project.progress}%` }} /></div><div className="project-meta"><span><MapPin size={13} />{project.site}</span><span>{project.value}</span></div></button>)}</div></div>
      <div className="panel inbox-panel"><PanelHeader title="Connected inbox" subtitle="Explicit Gmail access" action="Open inbox" onAction={() => onView("Inbox")} /><div className="dashboard-inbox-empty"><Mail size={20} /><div><strong>Your Gmail stays in your control</strong><p>Open the Inbox to load up to 20 message summaries from the approved test account. Filing always requires your project selection and confirmation.</p></div></div><button className="inbox-cta" onClick={() => onView("Inbox")}><Mail size={15} /> Open connected inbox</button></div>
    </section>
  </>;
}

function LeadsView({ leads, onAdd, onAdvance }: { leads: Lead[]; onAdd: () => void; onAdvance: (id: string) => void }) {
  const stages = leadStages;
  return <><PageTitle eyebrow="Sales pipeline" title="Leads & opportunities" text={`${leads.length} open opportunities · $511,700 estimated value`} action={<button className="primary-button" onClick={onAdd}><Plus size={17} /> Add lead</button>} />
    <div className="board">{stages.map((stage) => <section className="board-column" key={stage}><header><span>{stage}</span><b>{leads.filter((l) => l.stage === stage).length}</b><MoreHorizontal size={17} /></header>{leads.filter((l) => l.stage === stage).map((lead) => <article className="lead-card" key={lead.id}><div className="lead-card-head"><Avatar initials={lead.initials} color={lead.color} /><span>{lead.id}</span></div><h3>{lead.company}</h3><p>{lead.project}</p><div className="lead-value">{lead.value}</div><div className="lead-contact"><Users size={14} />{lead.contact}</div><footer><span>{lead.source}</span><button onClick={() => onAdvance(lead.id)} aria-label={`Advance ${lead.company} to the next pipeline stage`}><ChevronRight size={15} /></button></footer></article>)}<button className="add-card" onClick={onAdd}><Plus size={15} /> Add opportunity</button></section>)}</div>
  </>;
}

function sheetStateLabel(mirror: SheetMirrorStatus | null) {
  if (!mirror) return "Checking sync";
  if (mirror.clients.status === "syncing" || mirror.projects.status === "syncing") return "Syncing";
  if (mirror.reason || mirror.clients.status === "failed" || mirror.projects.status === "failed") return "Needs attention";
  if (mirror.clients.status === "synced" && mirror.projects.status === "synced") return "Synced";
  return "Not synced";
}

function ClientsView({ clients, projects, projectCounts, onAdd, onClient, onNewProject, sheetMirror, onSyncGoogleSheet, syncingSheet }: { clients: Client[]; projects: Project[]; projectCounts: Map<string, number>; onAdd: () => void; onClient: (client: Client) => void; onNewProject: () => void; sheetMirror: SheetMirrorStatus | null; onSyncGoogleSheet: () => Promise<void>; syncingSheet: boolean }) {
  const syncLabel = sheetStateLabel(sheetMirror);
  const synced = syncLabel === "Synced";
  const needsAttention = syncLabel === "Needs attention";
  return <><PageTitle eyebrow="Google Workspace directory" title="Clients" text="Each client can have multiple independent projects, contacts, and account-level documents" action={<div className="title-actions"><button className="soft-button" onClick={onNewProject}><BriefcaseBusiness size={16} /> New project</button><button className="primary-button" onClick={onAdd}><Plus size={17} /> Add client</button></div>} />
    <section className="client-directory-banner"><div className="directory-badge"><FolderTree size={20} /></div><div><strong>FCI Operations is the source of truth; Google Sheets is a live directory mirror</strong><span>{sheetMirror?.reason ?? "The Client Directory preserves account notes, while Project Register is generated from the app."}</span></div><div className="directory-sync-actions"><span className={`directory-status ${needsAttention ? "needs-attention" : ""}`}>{synced ? <CircleCheckBig size={14} /> : <Clock3 size={14} />}{syncLabel}</span><button className="soft-button" onClick={() => void onSyncGoogleSheet()} disabled={syncingSheet}>{syncingSheet ? "Syncing…" : "Sync Google Sheet"}</button></div></section>
    <div className="client-directory panel"><div className="client-table-head"><span>Client</span><span>Primary contact</span><span>Independent projects</span><span>Google Sheet</span><span /></div>{clients.map((client) => { const projectCount = projectCounts.get(client.id) ?? 0; const clientProjects = projects.filter((project) => project.clientId === client.id); return <button className="client-table-row" key={client.id} onClick={() => onClient(client)}><div className="client-identity"><Avatar initials={client.initials} color={client.color} /><span><strong>{client.name}</strong><small>{client.code} · {client.industry}</small></span></div><span><strong>{client.contact}</strong><small>{client.email || "Email to add"}</small></span><span className="client-project-count"><b>{projectCount}</b><small>{projectCount === 1 ? "project" : "projects"}{clientProjects.length > 1 ? " · independently managed" : ""}</small></span><span className={synced ? "google-ready" : "google-pending"}>{synced ? <CircleCheckBig size={13} /> : <Clock3 size={13} />}{syncLabel}</span><ChevronRight size={17} /></button>})}</div>
  </>;
}

function ProjectsView({ projects, onProject, onNewProject }: { projects: Project[]; onProject: (p: Project) => void; onNewProject: () => void }) {
  const [filter, setFilter] = useState("Active");
  const [managerOnly, setManagerOnly] = useState(false);
  const filteredProjects = projects.filter((project) => {
    const matchesStage = filter === "Active" ? project.status !== "Closeout" : filter === "Archived" ? false : project.status === filter;
    return matchesStage && (!managerOnly || project.lead === "Sarah Kim");
  });
  const filterCount = (stage: string) => stage === "Active" ? projects.filter((project) => project.status !== "Closeout").length : stage === "Archived" ? 0 : projects.filter((project) => project.status === stage).length;
  return <><PageTitle eyebrow="Project delivery" title="Active projects" text="Every project is independent, even when a client has repeat work" action={<button className="primary-button" onClick={onNewProject}><Plus size={17} /> New project</button>} />
    <div className="filterbar"><div className="tabs">{["Active", "Planning", "Closeout", "Archived"].map((stage) => <button className={filter === stage ? "active" : ""} key={stage} onClick={() => setFilter(stage)}>{stage}{stage !== "Archived" && <b>{filterCount(stage)}</b>}</button>)}</div><button className="soft-button" onClick={() => setManagerOnly((current) => !current)}><ChevronDown size={15} /> {managerOnly ? "Sarah Kim only" : "All project managers"}</button></div>
    <div className="projects-table panel"><div className="projects-table-head"><span>Project</span><span>Phase</span><span>Progress</span><span>Schedule</span><span>Value</span><span /></div>{filteredProjects.map((p) => <button className="projects-table-row" key={p.id} onClick={() => onProject(p)}><div><Avatar initials={p.client.split(" ").map((s) => s[0]).slice(0,2).join("")} color={p.accent} /><span><strong>{p.name}</strong><small>{p.number} · {p.client}</small></span></div><Status text={p.status} /><div><div className="progress compact"><i style={{ width: `${p.progress}%` }} /></div><small>{p.progress}%</small></div><span><strong>{p.date}</strong><small><MapPin size={12} />{p.site}</small></span><strong>{p.value}</strong><ChevronRight size={17} /></button>)}{!filteredProjects.length && <div className="empty-table">No {filter.toLowerCase()} projects match this view.</div>}</div>
  </>;
}

function ScheduleView({ notify }: { notify: (s: string) => void }) {
  const days = ["Mon 13", "Tue 14", "Wed 15", "Thu 16", "Fri 17"];
  const crews = [{ crew: "Rivera Crew", people: "4 installers", color: "green" }, { crew: "Torres Crew", people: "3 installers", color: "orange" }, { crew: "Northstar Subs", people: "5 installers", color: "blue" }];
  const [conflictResolved, setConflictResolved] = useState(false);
  const [drafts, setDrafts] = useState<ShiftAssignment[]>([]);
  const [selectedShift, setSelectedShift] = useState<ShiftAssignment | null>(null);
  const [newShiftOpen, setNewShiftOpen] = useState(false);
  const [acknowledgedIds, setAcknowledgedIds] = useState<string[]>([]);
  function acknowledgeShift(shift: ShiftAssignment) {
    setAcknowledgedIds((current) => current.includes(shift.id) ? current : [...current, shift.id]);
    setDrafts((current) => current.map((item) => item.id === shift.id ? { ...item, status: "Acknowledged" } : item));
    setSelectedShift({ ...shift, status: "Acknowledged" });
    notify(`${shift.crew} acknowledged the ${shift.day} assignment`);
  }
  return <><PageTitle eyebrow="Field operations" title="Schedule & crews" text="July 13–17 · 3 active crews" action={<button className="primary-button" onClick={() => setNewShiftOpen(true)}><Plus size={17} /> New shift</button>} />
    {!conflictResolved && <section className="schedule-alert"><CircleAlert size={19} /><div><strong>Schedule conflict detected</strong><span>Mike Torres is assigned to two jobs Wednesday at 8:00 AM.</span></div><button onClick={() => { setConflictResolved(true); notify("Conflict marked resolved; review the updated draft before publishing"); }}>Resolve</button></section>}
    <div className="calendar-board panel"><div className="calendar-corner"><span>Crews</span></div>{days.map((d, i) => <div className={`calendar-day ${i === 2 ? "today" : ""}`} key={d}><span>{d.split(" ")[0]}</span><strong>{d.split(" ")[1]}</strong></div>)}
      {crews.map((crew, ci) => <div className="calendar-row" key={crew.crew}><div className="crew-label"><Avatar initials={crew.crew.split(" ")[0].slice(0,2).toUpperCase()} color={crew.color} /><div><strong>{crew.crew}</strong><span>{crew.people}</span></div></div>{days.map((day, di) => {
        if ((di + ci) % 3 === 2) return <div className="day-cell" key={day} />;
        const id = `assignment-${ci}-${di}`;
        const assignment: ShiftAssignment = { id, crew: crew.crew, site: di % 2 ? "Harbor Plaza" : "Westport Medical", day, time: di % 2 ? "7:00 AM – 3:30 PM" : "6:00 AM – 2:00 PM", status: acknowledgedIds.includes(id) || di !== 1 ? "Acknowledged" : "Pending" };
        return <div className="day-cell" key={day}><button className={`shift-block c${ci}`} onClick={() => setSelectedShift(assignment)}><strong>{assignment.site}</strong><span>{assignment.time}</span><small>{assignment.status}</small></button></div>;
      })}</div>)}</div>
    {drafts.length > 0 && <section className="panel draft-shifts"><PanelHeader title="Draft shifts" subtitle={`${drafts.length} not yet published`} />{drafts.map((shift) => <button key={shift.id} className="draft-shift-row" onClick={() => setSelectedShift(shift)}><span><strong>{shift.site}</strong><small>{shift.crew} · {shift.day} · {shift.time}</small></span><Status text={shift.status} /><ChevronRight size={16} /></button>)}</section>}
    {newShiftOpen && <ShiftModal crews={crews.map((crew) => crew.crew)} onClose={() => setNewShiftOpen(false)} onSave={(draft) => { const shift = { ...draft, id: crypto.randomUUID(), status: "Pending" as const }; setDrafts((current) => [...current, shift]); setNewShiftOpen(false); notify(`${shift.site} added as a draft shift`); }} />}
    {selectedShift && <ShiftDetailModal shift={selectedShift} onClose={() => setSelectedShift(null)} onAcknowledge={() => acknowledgeShift(selectedShift)} />}
  </>;
}

type InboxBucket = "inbox" | "intake" | "needs-review" | "filed";
type GmailWorkspaceStatus = {
  connectionStatus?: string;
  connectionAccount?: string | null;
  gmailConnected?: boolean;
  gmailEnabled?: boolean;
  requiresReauthorization?: boolean;
  environment?: "test" | "production";
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

function inboxProjectSuggestion(message: GmailTestMessage, projects: Project[], clients: Client[], rules: FilingRuleDraft[]): InboxProjectSuggestion {
  const decision = evaluateInboxFilingRules({ message, projects, clients, rules });
  if (decision.kind === "project" && decision.project) return { kind: "project", text: `Suggested by ${decision.ruleName}: ${decision.project.number} — review before filing`, reason: decision.reason };
  if (decision.kind === "needs-review") return { kind: "needs-review", text: `Needs review${decision.ruleName ? ` by ${decision.ruleName}` : ""}: choose the exact independent project`, reason: decision.reason };
  if (decision.kind === "ignored") return { kind: "ignored", text: `No routing by ${decision.ruleName}: Gmail stays unchanged`, reason: decision.reason };
  return { kind: "intake", text: "FCI Intake: no enabled built-in rule matched; choose a project before filing", reason: decision.reason };
}

function InboxView({ notify, onRules, projects, clients, rules, onGoogleSetup }: { notify: (s: string) => void; onRules: () => void; projects: Project[]; clients: Client[]; rules: FilingRuleDraft[]; onGoogleSetup: () => void }) {
  const [workspace, setWorkspace] = useState<GmailWorkspaceStatus | null>(null);
  const [messages, setMessages] = useState<GmailTestMessage[]>([]);
  const [bucket, setBucket] = useState<InboxBucket>("inbox");
  const [search, setSearch] = useState("");
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [labelReady, setLabelReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filingMessage, setFilingMessage] = useState<GmailTestMessage | null>(null);
  const [filingProjectId, setFilingProjectId] = useState("");
  const [filingPreview, setFilingPreview] = useState<GmailFilingPreview | null>(null);
  const [filingLoading, setFilingLoading] = useState(false);
  const [filingSubmitting, setFilingSubmitting] = useState(false);
  const [replyMessage, setReplyMessage] = useState<GmailTestMessage | null>(null);
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
      const data = await response.json().catch(() => ({})) as { messages?: GmailTestMessage[]; labelReady?: boolean; error?: string };
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

  function openFilingReview(message: GmailTestMessage) {
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

  function openReplyComposer(message: GmailTestMessage) {
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

  const connectionText = gmailReady ? `Connected Gmail: ${workspace?.connectionAccount ?? "approved test account"}` : workspace?.requiresReauthorization ? "Google needs to be reconnected to approve Gmail access." : "Connect the approved personal Google test account to load messages.";
  return <>
    <PageTitle eyebrow="Gmail intake" title="Connected inbox" text="Search the approved Gmail test account, link each message to one independent project, and keep Gmail organized without creating a folder for every job." action={<div className="title-actions"><button className="soft-button" onClick={onRules}><ListFilter size={15} /> Inbox & file rules</button>{gmailReady ? <button className="primary-button" onClick={() => void loadMessages()} disabled={loading}>{loading ? "Loading…" : <><RefreshCw size={15} /> Refresh inbox</>}</button> : <button className="primary-button" onClick={onGoogleSetup}><Building2 size={15} /> Google setup</button>}</div>} />
    <section className={`inbox-connection ${gmailReady ? "ready" : ""}`}><Mail size={18} /><div><strong>{gmailReady ? connectionText : "Gmail connection required"}</strong><span>{gmailReady ? "This is the approved Google account for the personal test profile. Loading messages never changes Gmail." : connectionText}</span></div><button className="soft-button" onClick={() => void checkGmailConnection()} disabled={checking}>{checking ? "Checking…" : "Check connection"}</button></section>
    <section className="inbox-safety"><ShieldCheck size={18} /><div><strong>Safe filing is on</strong><span>{rules.filter((rule) => rule.enabled).length} enabled rules are applied in priority order. Paused rules do not influence suggestions, and every message still needs your exact project selection before filing.</span></div><button onClick={onRules}>Manage rules</button></section>
    {error && <p className="workspace-missing">{error}</p>}
    <div className="inbox-layout">
      <section className="panel message-list">
        <header className="live-inbox-toolbar"><div><label>Mailbox<select value={bucket} onChange={(event) => { setBucket(event.target.value as InboxBucket); setMessages([]); setLabelReady(null); }} disabled={loading}><option value="inbox">Inbox</option><option value="intake">FCI Intake</option><option value="needs-review">FCI Needs Review</option><option value="filed">FCI Filed</option></select></label><label>Search this Gmail mailbox<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. from:vendor@example.com" disabled={loading} /></label><small className="gmail-search-help">Use Gmail search terms such as <b>from:</b>, <b>subject:</b>, or a project number.</small></div><div className="workspace-actions">{labelReady === false && bucket !== "inbox" && <button className="soft-button" onClick={() => void prepareLabels()} disabled={loading}>Prepare FCI labels</button>}<button className="primary-button" onClick={() => void loadMessages()} disabled={!gmailReady || loading}>{loading ? "Loading…" : "Load messages"}</button></div></header>
        {!gmailReady ? <div className="inbox-empty"><Mail size={25} /><h3>Connect Gmail to see your inbox</h3><p>This page reads only the approved personal test account after you click Load messages. It does not assume your ChatGPT sign-in and Google account are the same.</p><button className="primary-button" onClick={onGoogleSetup}>Open Google Workspace setup</button></div> : messages.length === 0 ? <div className="inbox-empty"><Inbox size={25} /><h3>{loading ? "Loading your inbox…" : "No messages loaded yet"}</h3><p>Choose a mailbox, optionally enter a Gmail search, and select Load messages. The view is limited to 20 message summaries.</p><button className="primary-button" onClick={() => void loadMessages()} disabled={loading}>Load {inboxBucketLabels[bucket]}</button></div> : messages.map((message, index) => {
          const suggestion = inboxProjectSuggestion(message, projects, clients, rules);
          return <article className="message-row live-message-row" key={message.id}><div className={`sender-dot s${index % 4}`}>{(message.from ?? "?").split(/[\s@<]+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div><div className="message-copy"><strong>{message.from ?? "Unknown sender"}</strong><h3>{message.subject ?? "(No subject)"}</h3><p>{message.snippet || "No preview available."}</p><div className={`inbox-project-suggestion ${suggestion.kind}`} title={suggestion.reason} aria-label={`${suggestion.text}. ${suggestion.reason}`}><ShieldCheck size={13} /> {suggestion.text}</div></div><div className="message-actions"><span>{inboxDate(message.date)}</span><small>{message.to ? `To: ${message.to}` : "Approved test mailbox"}</small><button className="primary-button" onClick={() => openFilingReview(message)}><FolderOpen size={14} /> File to project</button><button className="soft-button" onClick={() => openReplyComposer(message)}><Reply size={14} /> Reply</button></div></article>;
        })}
      </section>
      <aside className="panel inbox-summary"><div className="summary-icon"><Mail size={20} /></div><h3>Inbox status</h3><p>{gmailReady ? `Showing ${messages.length} loaded message${messages.length === 1 ? "" : "s"} from ${inboxBucketLabels[bucket]}.` : "Gmail is not connected yet."}</p><div><span>Connected account</span><strong>{workspace?.connectionAccount ?? "Not connected"}</strong></div><div><span>Message limit</span><strong>20 summaries</strong></div><div><span>Filing protection</span><strong>Exact project required</strong></div><hr /><h4>Keep it organized</h4><ul className="inbox-organization"><li>Use only FCI Intake, Needs Review, and Filed labels.</li><li>Use project numbers for the safest match.</li><li>Store the permanent email and attachments in that project’s Drive folder.</li></ul><small>{workspace?.environment === "test" ? "Personal test mode" : "Google setup required"}</small><small>Inbox is retained after filing</small></aside>
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
  return <><PageTitle eyebrow="Project-record assistant" title="Ask FCI Assistant" text="Start with saved project, client, contact, activity, and approved email-archive facts. Files and meeting notes will join after approved indexing is added." />
    <div className="assistant-layout"><section className="assistant-main panel"><div className="assistant-hero"><div className="ai-orb"><Bot size={29} /></div><h2>What would you like to know?</h2><p>Choose one project so every answer has a clear, reviewable evidence boundary.</p></div><div className="prompt-chips">{["What facts are saved for this project?", "Summarize the current project record", "What evidence is still missing?"].map((q) => <button key={q} onClick={() => void ask(q)} disabled={!activeProjectId}>{q}<ChevronRight size={14} /></button>)}</div>{answer && <article className="ai-answer"><div><Sparkles size={18} /><strong>{answer.mode === "ai-grounded" ? "AI-grounded answer" : "Project-record summary"}</strong><span className="assistant-mode">{answer.mode === "ai-grounded" ? "OpenAI enabled" : "OpenAI not configured or unavailable"}</span></div><p>{answer.answer}</p><p className="assistant-missing"><CircleAlert size={14} /> {answer.missingEvidence}</p><h4>Sources</h4>{answer.citations.length ? answer.citations.map((citation, index) => <button key={citation.id} onClick={() => setSourceDetail(citation)}><FileText size={14} /><span>[{index + 1}] {citation.label}</span><ChevronRight size={14} /></button>) : <p className="source-empty">No verified sources were returned for this answer.</p>}</article>}<form className="ask-box" onSubmit={(event) => { event.preventDefault(); void ask(); }}><select value={activeProjectId} onChange={(event) => { setProjectId(event.target.value); setAnswer(null); }} aria-label="Project context" disabled={!projects.length}><option value="">Choose a project…</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.number} — {project.name}</option>)}</select><div><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about the selected project record…" aria-label="Ask FCI Assistant" /><button disabled={loading || !question.trim() || !activeProjectId} aria-label="Send question">{loading ? <span className="spinner" /> : <Send size={18} />}</button></div><small><Sparkles size={12} /> Every answer is read-only and cites only server-selected project evidence.</small></form></section><aside className="panel recent-questions"><h3>Suggested questions</h3>{["What is the current project status?", "Who is the primary contact?", "How many email archives are linked?", "What evidence has not been captured yet?"].map((q) => <button key={q} onClick={() => void ask(q)} disabled={!activeProjectId}><MessageSquareText size={15} /><span>{q}<small>Selected project only</small></span></button>)}<div className="privacy-note"><CheckCircle2 size={17} /><p><strong>Office-record scope</strong><br />This first version uses the operational records available to approved office users. Project-specific permissions are the next access-control layer.</p></div></aside></div>
    {sourceDetail && <SourceDetailModal citation={sourceDetail} onClose={() => setSourceDetail(null)} />}
  </>;
}

function ReportsView() { return <><PageTitle eyebrow="Business performance" title="Reports" text="A clear view of pipeline, delivery, and workload" /><section className="metrics-grid"><Metric label="Won revenue YTD" value="$1.28m" note="18 projects" trend="+24%" icon={BriefcaseBusiness} color="green" /><Metric label="Average sales cycle" value="31 days" note="Inquiry to award" trend="-4 days" icon={Clock3} color="blue" /><Metric label="Crew utilization" value="82%" note="Next 30 days" trend="Healthy" icon={Users} color="orange" /><Metric label="Closeout time" value="9 days" note="Average" trend="-2 days" icon={CheckCircle2} color="violet" /></section><div className="reports-grid"><section className="panel report-chart"><PanelHeader title="Pipeline by stage" subtitle="Estimated value" /><div className="bar-chart">{[["New inquiry", 45, "$86.5k"], ["Site visit", 72, "$142k"], ["Proposal", 34, "$64.8k"], ["Decision", 100, "$218.4k"]].map((b) => <div key={String(b[0])}><span>{b[0]}</span><div><i style={{ width: `${b[1]}%` }} /></div><strong>{b[2]}</strong></div>)}</div></section><section className="panel report-chart"><PanelHeader title="Project health" subtitle="8 active" /><div className="health-donut"><div><strong>75%</strong><span>On track</span></div></div><div className="legend"><span><i className="g" />On track <b>6</b></span><span><i className="a" />At risk <b>1</b></span><span><i className="r" />Blocked <b>1</b></span></div></section></div></> }

function SettingsView({ notify, section, onSection, rules, projects, userName, userEmail, onGoogleSetup, onAddRule, onUpdateRule, onDeleteRule, sheetMirror, onSyncGoogleSheet, syncingSheet }: { notify: (s: string) => void; section: string; onSection: (section: string) => void; rules: FilingRuleDraft[]; projects: Project[]; userName: string; userEmail: string; onGoogleSetup: () => void; onAddRule: () => void; onUpdateRule: (rule: FilingRuleDraft, patch: Partial<Pick<FilingRuleDraft, "enabled" | "priority">>) => Promise<void>; onDeleteRule: (rule: FilingRuleDraft) => Promise<void>; sheetMirror: SheetMirrorStatus | null; onSyncGoogleSheet: () => Promise<void>; syncingSheet: boolean }) {
  const options = ["My account", "Google Workspace", "Calendar & appointments", "Inbox & file rules", "Client Directory", "Workflow & notifications", "Data & security", "Testing & launch"];
  return <><PageTitle eyebrow="Control center" title="Settings" text="Keep personal preferences, Google connections, inbox rules, calendar defaults, and workspace safeguards in one simple place." />
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

type UserAccountPreferences = { displayTimezone: string; replySignature: string; personalCalendarDisplay: boolean };
type WorkspacePreferenceValues = {
  timezone: string;
  appointmentCalendarName: string;
  fieldCalendarName: string;
  calendarSetupMode: "create-shared" | "use-existing";
  appointmentCalendarId: string;
  fieldCalendarId: string;
  personalAvailabilityPolicy: "free-busy" | "off";
  calendarEditPolicy: "app-authoritative";
  appointmentReminderHours: number;
  crewReminderHours: number;
  inboxReviewMode: "review-first";
  officeNotificationEmail: string;
};

const defaultUserAccountPreferences: UserAccountPreferences = { displayTimezone: "America/New_York", replySignature: "", personalCalendarDisplay: true };
const defaultWorkspacePreferences: WorkspacePreferenceValues = {
  timezone: "America/New_York",
  appointmentCalendarName: "FCI • Client Appointments",
  fieldCalendarName: "FCI • Field Schedule",
  calendarSetupMode: "create-shared",
  appointmentCalendarId: "",
  fieldCalendarId: "",
  personalAvailabilityPolicy: "free-busy",
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
  return <section className="panel settings-form-panel"><div className="settings-heading"><div><p className="eyebrow">Signed-in account</p><h2>My account</h2><p>Your timezone, reply signature, and calendar display preference are saved to this FCI account and follow you between browsers.</p></div></div><div className="account-identity"><div className="avatar">{userName.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "FC"}</div><div><strong>{userName}</strong><span>{userEmail}</span></div></div><form onSubmit={save}><div className="form-row"><label>My display timezone<select value={preferences.displayTimezone} onChange={(event) => setPreferences((current) => ({ ...current, displayTimezone: event.target.value }))} disabled={loading || saving}><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option></select></label><label>Shared Google test account<input value={connectionAccount ?? "Not connected"} readOnly /></label></div><label>Default reply signature<textarea value={preferences.replySignature} onChange={(event) => setPreferences((current) => ({ ...current, replySignature: event.target.value }))} placeholder="Name, title, phone, and company" maxLength={2000} disabled={loading || saving} /></label><label className="settings-checkbox"><input type="checkbox" checked={preferences.personalCalendarDisplay} onChange={(event) => setPreferences((current) => ({ ...current, personalCalendarDisplay: event.target.checked }))} disabled={loading || saving} /><span><strong>Show my published FCI shifts on my personal calendar when I link it</strong><small>This is your saved preference. It takes effect only after individual Google account connections are added.</small></span></label><p className="form-help"><Reply size={14} /> Your FCI sign-in and Google account are separate by design. The current prototype has one administrator-managed personal test connection; it never assumes that it belongs to this signed-in user.</p><footer><button type="button" className="soft-button" onClick={onGoogleSetup}><Building2 size={15} /> Manage shared Google test</button><button type="submit" className="primary-button" disabled={loading || saving}>{saving ? "Saving…" : <><Check size={15} /> Save my preferences</>}</button></footer></form></section>;
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
          <p>Keep company work in two shared FCI calendars. Personal calendars are optional availability sources, never the source of truth for client appointments or field work.</p>
        </div>
        <button className="soft-button" type="button" onClick={onGoogleSetup}><Building2 size={15} /> Google connection</button>
      </div>
      <div className={`settings-connection ${calendarConnected ? "ready" : ""}`}>
        <CalendarDays size={18} />
        <div>
          <strong>{calendarConnected ? "Personal test calendar connected" : "Calendar connection required"}</strong>
          <span>{calendarConnected ? `${calendarAccount ?? "Approved test account"} is connected for private test holds only.` : "Reconnect Google and approve Calendar before testing private calendar holds."}</span>
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
          <label>Personal availability policy<select value={settings.personalAvailabilityPolicy} onChange={(event) => setSettings((current) => ({ ...current, personalAvailabilityPolicy: event.target.value as WorkspacePreferenceValues["personalAvailabilityPolicy"] }))}><option value="free-busy">Use linked users’ free/busy time only</option><option value="off">Do not use personal calendars</option></select></label>
        </div>
        <div className="settings-static-row">
          <ShieldCheck size={16} />
          <div><strong>Sync & conflict policy</strong><span>FCI Operations will remain authoritative. A later edit to an app-created Google event will be flagged for review instead of silently overwriting the project schedule.</span></div>
        </div>
        <div className="settings-static-row">
          <Mail size={16} />
          <div><strong>Gmail relationship</strong><span>Gmail and Calendar are separate. When a message becomes an appointment, the app will link the thread to the appointment; Gmail-generated travel or reservation events are never imported into the company schedule automatically.</span></div>
        </div>
        <p className="form-help"><CalendarDays size={14} /> These settings are saved now. The personal test adapter still uses only the test account’s primary calendar; company calendar creation, picker, event links, and two-way sync are the next integration step.</p>
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
  return <section className="panel settings-form-panel"><div className="settings-heading"><div><p className="eyebrow">Safety & access</p><h2>Data & security</h2><p>These safeguards are already active in the prototype and identify what must be completed before staff-wide use.</p></div></div><div className="settings-security-list"><div><ShieldCheck size={18} /><span><strong>Review-first email filing</strong><small>Messages retain Inbox; project copies and FCI/Filed occur only after a direct approval.</small></span></div><div><Users size={18} /><span><strong>FCI account and Google account stay distinct</strong><small>Account preferences are tied to the signed-in FCI user. Individual Google connections will be explicitly authorized later; the current test connection is shared and administrator-managed.</small></span></div><div><Building2 size={18} /><span><strong>Separate personal test and company production profiles</strong><small>Personal Google credentials and folders are never promoted to company production.</small></span></div><div><Settings size={18} /><span><strong>Installable web app</strong><small>This site now includes a web-app manifest. In Chrome or Edge, use the browser’s Install app command to add FCI Operations as its own app window. The Google app launcher cannot add an arbitrary personal URL; a true Gmail sidebar requires a separate Workspace Add-on deployment.</small></span></div></div><PhoneInstallPanel /></section>;
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

type GmailTestMessage = { id: string; threadId?: string | null; from: string | null; to?: string | null; subject: string | null; date: string | null; snippet: string; labelIds?: string[] };
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
    mode?: "shared-drive" | "my-drive";
    storageLabel?: string;
    storageName?: string;
    temporary?: boolean;
    storageConfigured?: boolean;
    environment?: "test" | "production";
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
  const [gmailMessages, setGmailMessages] = useState<GmailTestMessage[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<Array<{ id: string; title: string; start: string; end: string; url?: string }>>([]);
  const [gmailWorking, setGmailWorking] = useState(false);
  const [calendarWorking, setCalendarWorking] = useState(false);
  const [gmailLabelsReady, setGmailLabelsReady] = useState(false);
  const [filingMessage, setFilingMessage] = useState<GmailTestMessage | null>(null);
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
          mode?: "shared-drive" | "my-drive";
          storageLabel?: string;
          storageName?: string;
          temporary?: boolean;
          storageConfigured?: boolean;
          environment?: "test" | "production";
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
      notify(data.credentialsPresent ? "Configuration is present. Finish OAuth authorization before Google data can be accessed." : `Workspace setup still needs ${Math.max(1, data.missing?.length ?? 0)} item(s)`);
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
    if (!response.ok) throw new Error(data.error ?? "The Google test action could not be completed.");
    return data;
  }

  async function prepareTestGmailLabels() {
    setGmailWorking(true);
    try {
      await readApi<{ prepared: boolean }>("/api/v1/integrations/google/gmail/labels/prepare", { method: "POST" });
      setGmailLabelsReady(true);
      notify("FCI test Gmail labels are ready. No messages were moved or archived.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gmail labels could not be prepared.");
    } finally {
      setGmailWorking(false);
    }
  }

  async function refreshTestGmail() {
    setGmailWorking(true);
    try {
      const data = await readApi<{ messages?: GmailTestMessage[]; labelReady?: boolean }>("/api/v1/integrations/google/gmail/messages?label=inbox");
      setGmailMessages(data.messages ?? []);
      setGmailLabelsReady((current) => current || Boolean(data.labelReady));
      notify(`Loaded ${data.messages?.length ?? 0} personal test inbox message(s).`);
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
      notify("A test email was sent only to the approved personal test address.");
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

  function openFilingReview(message: GmailTestMessage) {
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
      notify(`Loaded ${data.events?.length ?? 0} upcoming personal Calendar event(s).`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The personal test calendar could not be loaded.");
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
      notify("A private 30-minute test hold was created with no attendees or notifications.");
      await refreshTestCalendar();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The test calendar hold could not be created.");
    } finally {
      setCalendarWorking(false);
    }
  }

  const configured = status === "credentials";
  const temporary = workspace?.temporary === true;
  const testProfile = (workspace?.environment ?? "test") === "test";
  const connected = workspace?.connectionStatus === "connected";
  const gmailReady = testProfile && connected && workspace?.gmailEnabled === true && workspace?.gmailConnected === true;
  const calendarReady = testProfile && connected && workspace?.calendarEnabled === true && workspace?.calendarConnected === true;
  const sheetsReady = connected && workspace?.sheetsEnabled === true && workspace?.sheetsConnected === true && workspace?.clientDirectorySheetConfigured === true;
  const reconnectRequired = workspace?.requiresReauthorization === true;
  const selectedServices = workspace?.enabledServices?.join(", ") ?? "drive";
  const storageName = workspace?.storageName ?? "FCI Operations";
  const personalCredentialsMissing = testProfile && missing.some((item) => item === "Google OAuth client ID" || item === "Google OAuth client secret");
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
      <div>
        <p className="eyebrow">Google account connection</p>
        <h2>Google connections</h2>
        <p>{testProfile ? "Personal Gmail is the active test profile. It will connect your approved personal Gmail, dedicated Drive folder, Calendar, and Sheets together after its Google OAuth credentials are available." : "This production profile is reserved for the company Google account and company-owned workspace."}</p>
      </div>
      <button className="primary-button" onClick={checkSetup} disabled={checking}>{checking ? "Checking…" : "Check readiness"}</button>
    </div>
    <div className="google-profile-status" aria-label="Google connection profiles">
      <div className={testProfile ? "active" : ""}><Mail size={16} /><span><strong>Personal Gmail test</strong><small>{testProfile ? "Active profile · Gmail, Drive, Calendar, and Sheets use your dedicated personal test setup." : "Available only when the personal test profile is selected by an administrator."}</small></span></div>
      <div className={!testProfile ? "active" : ""}><Building2 size={16} /><span><strong>Company Workspace</strong><small>{!testProfile ? "Active company profile." : "Separate future profile · keep it isolated from personal testing."}</small></span></div>
    </div>
    <div className={`workspace-connection ${connected ? "ready" : ""}`}>
      <div className="integration-logo google"><Mail size={20} /></div>
      <div>
        <strong>{connected ? `${testProfile ? "Personal test" : "Production"} Google services connected` : reconnectRequired ? "Google permission update required" : configured ? `Ready to connect ${testProfile ? "personal test" : "production"} Google services` : temporary && workspace?.storageConfigured ? "Temporary Drive folder configured" : "Google Workspace setup required"}</strong>
        <span>{connected ? `${workspace?.connectionAccount ?? "Approved account"} is connected with ${selectedServices}.` : reconnectRequired ? "Reconnect and approve every selected service before Sheets, Gmail, or Calendar controls can be used." : configured ? `The active profile will request ${selectedServices}.` : temporary && workspace?.storageConfigured ? "The Drive root is set, but OAuth and admin safety settings still need to be configured." : "Google is not connected until the active profile configuration is complete."}</span>
      </div>
      <span>{connected ? "Connected" : reconnectRequired ? "Reconnect" : configured ? "Authorize next" : temporary && workspace?.storageConfigured ? "Storage ready" : "Not connected"}</span>
    </div>
    {personalCredentialsMissing && <div className="workspace-missing personal-profile-block"><CircleAlert size={16} /><span><strong>Personal Gmail is already selected.</strong> The test Drive folder and approved Gmail address are configured, but this hosted app is missing the personal Google OAuth client ID and client secret. Add those two values to the site’s secure settings, then return here and select <b>Connect personal test Google</b>. Switching to Workspace will not fix this specific error.</span></div>}
    {testProfile && <p className="workspace-warning"><CircleAlert size={15} /><span><strong>Personal test mode:</strong> use only self-sent test messages and sample documents. Gmail labels, self-test email, and Calendar holds require your direct click; the app never automatically archives email, removes Inbox, invites guests, or alters existing events.</span></p>}
    {workspace?.sheetsEnabled && <p className="workspace-warning"><FileText size={15} /><span><strong>Google Sheets:</strong> {sheetsReady ? "the Client Directory and Project Register mirror are ready. Use Settings → Client Directory to sync them." : workspace.clientDirectorySheetConfigured ? "reconnect Google to approve Sheets, then use Settings → Client Directory to run the first sync." : "add the Client Directory spreadsheet ID to the active Google profile before syncing."}</span></p>}
    {oauthMessage && <p className={oauthResult === "connected" ? "workspace-warning" : "workspace-missing"}>{oauthMessage}</p>}
    {temporary && !testProfile && <p className="workspace-warning"><CircleAlert size={15} /><span>This folder is a temporary My Drive workspace owned by its creator. Move the workspace to a company Shared Drive before wider staff use.</span></p>}
    {missing.length > 0 && <p className="workspace-missing"><strong>Still needed:</strong> {missing.join(", ")}</p>}
    <div className="workspace-actions">
      {!connected && <button className="primary-button" onClick={connectGoogleDrive} disabled={!configured || working}>{working ? "Preparing…" : reconnectRequired ? "Reconnect personal Google test" : `Connect ${testProfile ? "personal test" : "production"} Google`}</button>}
      {connected && <button className="primary-button" onClick={verifyGoogleDrive} disabled={working}>{working ? "Verifying…" : "Verify workspace folder"}</button>}
      {connected && <button className="soft-button" onClick={disconnectGoogleDrive} disabled={working}>Disconnect active profile</button>}
    </div>
    {connected && !workspace?.provisioningEnabled && <p className="workspace-missing"><strong>Folder creation remains off:</strong> enable the active profile’s Drive provisioning flag only after you verify the test workspace. This prevents accidental folder creation while you are testing.</p>}
    {testProfile && <section className="test-google-services" aria-label="Personal Google test controls">
      <header><div><p className="eyebrow">Personal account testing</p><h3>Gmail & Calendar test controls</h3><p>These are limited to the approved personal test account. Nothing runs automatically.</p></div></header>
      <div className="test-service-grid">
        <section className="test-service-card">
          <div className="test-service-heading"><Mail size={17} /><div><strong>Personal Gmail</strong><span>{gmailReady ? "Connected for explicit test actions" : workspace?.gmailEnabled ? "Reconnect Google to approve Gmail" : "Enable Gmail in the test profile first"}</span></div></div>
          <p>Prepare FCI labels, view up to 20 inbox message summaries, send only to your approved test address, or review-copy one message into a selected project Drive workspace. Gmail is labeled only after the Drive copy succeeds; Inbox stays intact.</p>
          <div className="workspace-actions">
            <button className="soft-button" onClick={prepareTestGmailLabels} disabled={!gmailReady || gmailWorking}>{gmailWorking ? "Working…" : gmailLabelsReady ? "Refresh FCI labels" : "Prepare FCI labels"}</button>
            <button className="soft-button" onClick={refreshTestGmail} disabled={!gmailReady || gmailWorking}>{gmailWorking ? "Loading…" : "View test inbox"}</button>
            <button className="primary-button" onClick={sendSelfTestEmail} disabled={!gmailReady || gmailWorking}>{gmailWorking ? "Sending…" : "Send self-test email"}</button>
          </div>
          {gmailMessages.length > 0 && <div className="test-service-list">{gmailMessages.map((message) => <article key={message.id}><div><strong>{message.subject || "(No subject)"}</strong><span>{message.from || "Unknown sender"}{message.date ? ` · ${new Date(message.date).toLocaleString()}` : ""}</span><p>{message.snippet}</p></div><div className="gmail-message-actions"><button className="primary-button" onClick={() => openFilingReview(message)} disabled={gmailWorking}>File to project</button><button className="soft-button" onClick={() => labelTestMessageFiled(message.id)} disabled={gmailWorking}>Label only</button></div></article>)}</div>}
        </section>
        <section className="test-service-card">
          <div className="test-service-heading"><CalendarDays size={17} /><div><strong>Personal Calendar</strong><span>{calendarReady ? "Connected for safe test holds" : workspace?.calendarEnabled ? "Reconnect Google to approve Calendar" : "Enable Calendar in the test profile first"}</span></div></div>
          <p>View a seven-day window of your primary calendar or create one private 30-minute FCI test hold. It has no guests and sends no notifications.</p>
          <div className="workspace-actions">
            <button className="soft-button" onClick={refreshTestCalendar} disabled={!calendarReady || calendarWorking}>{calendarWorking ? "Loading…" : "View upcoming events"}</button>
            <button className="primary-button" onClick={createTestCalendarHold} disabled={!calendarReady || calendarWorking}>{calendarWorking ? "Creating…" : "Create test hold"}</button>
          </div>
          {calendarEvents.length > 0 && <div className="test-service-list">{calendarEvents.map((event) => <article key={event.id}><div><strong>{event.title}</strong><span>{new Date(event.start).toLocaleString()} – {new Date(event.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>{event.url && <button className="soft-button" onClick={() => window.open(event.url, "_blank", "noopener,noreferrer")}>Open</button>}</article>)}</div>}
        </section>
      </div>
    </section>}
    <div className="drive-blueprint">
      <div><h3>{temporary ? "Temporary My Drive blueprint" : "Shared Drive blueprint"}</h3><p>{storageName}</p></div>
      <ol>{DRIVE_BLUEPRINT.roots.map((item) => <li key={item}>{item}</li>)}</ol>
      <div className="project-folder-list"><strong>Every independent project receives:</strong>{DRIVE_BLUEPRINT.projectFolders.map((item) => <span key={item}><FolderOpen size={13} />{item}</span>)}</div>
    </div>
    <div className="workspace-checklist">
      <h3>{testProfile ? "Personal test safeguards" : "Production safeguards"}</h3>
      <label><input type="checkbox" /> {testProfile ? "Use only a dedicated personal test folder and sample messages" : "Use a company-owned Shared Drive and company sender mailbox"}</label>
      <label><input type="checkbox" /> Authorize only the approved Google account for this profile</label>
      <label><input type="checkbox" /> Verify the workspace folder before enabling project-folder creation</label>
      <label><input type="checkbox" /> {testProfile ? "Use Gmail labels and Calendar holds only after a direct test action" : "Keep Gmail and Calendar production actions disabled until their separate review workflow is built"}</label>
      <label><input type="checkbox" /> Before launch, create a separate production connection; do not promote personal test credentials</label>
    </div>
    {filingMessage && <GmailFilingModal message={filingMessage} projects={projects} projectId={filingProjectId} preview={filingPreview} loading={filingLoading} submitting={filingSubmitting} onProject={(projectId) => { setFilingProjectId(projectId); setFilingPreview(null); }} onPreview={previewGmailFiling} onConfirm={confirmGmailFiling} onClose={closeFilingReview} />}
  </section>;
}

function GmailFilingModal({ message, projects, projectId, preview, loading, submitting, onProject, onPreview, onConfirm, onClose }: {
  message: GmailTestMessage;
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

function GmailReplyModal({ message, body, saving, onBody, onSave, onClose }: { message: GmailTestMessage; body: string; saving: boolean; onBody: (value: string) => void; onSave: () => void; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation"><div className="modal gmail-reply-modal" role="dialog" aria-modal="true" aria-labelledby="gmail-reply-title"><header><div><p className="eyebrow">Personal Gmail test</p><h2 id="gmail-reply-title">Save a reply draft</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={(event) => { event.preventDefault(); onSave(); }}><div className="modal-detail"><div className="filing-message-summary"><Mail size={17} /><div><strong>{message.subject || "(No subject)"}</strong><span>Reply target: {message.from || "original sender"}</span></div></div><label>Reply message<textarea value={body} onChange={(event) => onBody(event.target.value)} placeholder="Write your reply…" maxLength={6000} required disabled={saving} /></label><p className="form-help"><ShieldCheck size={14} /> The app saves an unsent draft in the original Gmail thread. In personal test mode, Gmail verifies the recipient is your approved test account. Sending remains a separate action in Gmail.</p></div><footer className="modal-footer"><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !body.trim()}>{saving ? "Saving…" : <><Reply size={16} /> Save Gmail draft</>}</button></footer></form></div></div>;
}

function TestingLaunchPanel({ onGoogleSetup }: { onGoogleSetup: () => void }) {
  return <section className="panel test-launch"><div className="settings-heading"><div><p className="eyebrow">Prototype verification</p><h2>Test & launch checklist</h2><p>Use the safe prototype controls first, then connect Google Workspace only after the data and permission checks are complete.</p></div><button className="primary-button" onClick={onGoogleSetup}>Open Workspace check</button></div><ol className="test-checklist"><li><strong>Clients and projects:</strong> add a client, create two independent projects, refresh, and verify their codes and project numbers remain consistent.</li><li><strong>Workflow controls:</strong> advance a lead, filter projects, add a draft shift, resolve a schedule conflict, and review an inbox suggestion.</li><li><strong>AI:</strong> ask a question, switch project context, and open every source reference. Do not rely on responses for decisions until the OpenAI key and retrieval indexes are configured.</li><li><strong>Personal Google test:</strong> connect the dedicated Drive folder and approved personal account, verify the root, then prepare Gmail labels, send yourself a test email, and create a private Calendar hold.</li><li><strong>Company production later:</strong> create a separate company OAuth client, Shared Drive, mailbox, Sheet, and calendars; never reuse the personal test credentials or folders.</li><li><strong>Before live staff use:</strong> run permission tests and complete the full lead-to-closeout lifecycle with non-production records.</li></ol></section>;
}

function ShiftModal({ crews, onClose, onSave }: { crews: string[]; onClose: () => void; onSave: (shift: Omit<ShiftAssignment, "id" | "status">) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({ crew: String(form.get("crew")), site: String(form.get("site")), day: String(form.get("day")), time: String(form.get("time")) });
  }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Field operations</p><h2>Create a draft shift</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Crew<select name="crew">{crews.map((crew) => <option key={crew}>{crew}</option>)}</select></label><label>Project / site<input name="site" required placeholder="e.g. Westport Medical Center" /></label><div className="form-row"><label>Day<select name="day"><option>Mon 13</option><option>Tue 14</option><option>Wed 15</option><option>Thu 16</option><option>Fri 17</option></select></label><label>Shift time<input name="time" required defaultValue="7:00 AM – 3:30 PM" /></label></div><p className="form-help"><CalendarDays size={14} /> This is a local draft. Publishing to employees and Google Calendar remains unavailable until Workspace is connected.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Add draft</button></footer></form></div></div>;
}

function ShiftDetailModal({ shift, onClose, onAcknowledge }: { shift: ShiftAssignment; onClose: () => void; onAcknowledge: () => void }) {
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Shift assignment</p><h2>{shift.site}</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="modal-detail"><dl><div><dt>Crew</dt><dd>{shift.crew}</dd></div><div><dt>When</dt><dd>{shift.day} · {shift.time}</dd></div><div><dt>Current status</dt><dd><Status text={shift.status} /></dd></div></dl><p>Use acknowledgement only for this prototype view. Published employee messages and calendar synchronization require the Google Workspace connection.</p></div><footer className="modal-footer"><button className="soft-button" onClick={onClose}>Close</button>{shift.status === "Pending" && <button className="primary-button" onClick={onAcknowledge}><Check size={16} /> Acknowledge</button>}</footer></div></div>;
}

function SourceDetailModal({ citation, onClose }: { citation: AssistantCitation; onClose: () => void }) {
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Assistant source</p><h2>Evidence reference</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="modal-detail"><strong>{citation.label}</strong><p>{citation.detail}</p><p>This is a server-selected project record reference. Raw Gmail content, Drive files, notes, and transcripts are not returned by this first assistant release.</p></div><footer className="modal-footer"><button className="primary-button" onClick={onClose}>Done</button></footer></div></div>;
}

function ProjectUpdateModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (draft: ProjectUpdateDraft) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({ project, subject: String(form.get("subject")), message: String(form.get("message")) });
  }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Project communication</p><h2>Prepare update</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>To<input value={`${project.client} contacts`} readOnly aria-label="Recipients" /></label><label>Subject<input name="subject" required defaultValue={`${project.number} — project update`} /></label><label>Message<textarea name="message" required defaultValue={`Status update for ${project.name}:`} /></label><p className="form-help"><Mail size={14} /> This creates a draft only. Gmail sending will be enabled after OAuth and consent controls are in place.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button"><Send size={16} /> Prepare update</button></footer></form></div></div>;
}

function LeadModal({ onClose, onSave }: { onClose: () => void; onSave: (l: Lead) => Promise<void> }) { const [saving, setSaving] = useState(false); async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setSaving(true); const form = new FormData(e.currentTarget); const company = String(form.get("company")); try { await onSave({ id: `L-${1050 + Math.floor(Math.random() * 30)}`, company, contact: String(form.get("contact")), project: String(form.get("project")), value: `$${Number(form.get("value") || 0).toLocaleString()}`, stage: "New inquiry", source: String(form.get("source")), next: "Follow up today", initials: company.split(" ").map((s) => s[0]).slice(0,2).join("").toUpperCase(), color: "sage" }); } finally { setSaving(false); } }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">New opportunity</p><h2>Add a lead</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client company<input name="company" required placeholder="e.g. Hudson Retail Group" /></label><div className="form-row"><label>Primary contact<input name="contact" required placeholder="Full name" /></label><label>Lead source<select name="source"><option>Website</option><option>Referral</option><option>Bid invite</option><option>Repeat client</option></select></label></div><label>Project / opportunity<input name="project" required placeholder="Project name" /></label><div className="form-row"><label>Estimated value<input name="value" type="number" min="0" placeholder="85000" /></label><label>Site city<input name="city" placeholder="City, State" /></label></div><label>Next action<textarea name="notes" placeholder="What needs to happen next?" /></label><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add to pipeline"}</button></footer></form></div></div>;
}

function ClientModal({ onClose, onSave }: { onClose: () => void; onSave: (client: Client) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); const name = String(form.get("name")); try { await onSave({ id: crypto.randomUUID(), code: `CL-${String(100 + Math.floor(Math.random() * 900))}`, name, contact: String(form.get("contact")), email: String(form.get("email")), industry: String(form.get("industry")), status: String(form.get("status")), initials: name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase(), color: "sage", googleStatus: "Setup pending" }); } finally { setSaving(false); } }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Client Directory</p><h2>Add a client</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client business name<input name="name" required placeholder="e.g. Atlas Design Group" /></label><div className="form-row"><label>Primary contact<input name="contact" required placeholder="Full name" /></label><label>Work email<input name="email" type="email" required placeholder="name@company.com" /></label></div><div className="form-row"><label>Industry<select name="industry"><option>General contractor</option><option>Healthcare</option><option>Retail</option><option>Hospitality</option><option>Property management</option><option>Other commercial</option></select></label><label>Client status<select name="status"><option>Active</option><option>Prospect</option><option>Inactive</option></select></label></div><p className="form-help"><FolderTree size={14} /> The app saves the client first, then syncs the Client Directory when Google Sheets is connected. The account folder is created with the first project workspace.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add client"}</button></footer></form></div></div>;
}

function NewProjectModal({ clients, onClose, onSave }: { clients: Client[]; onClose: () => void; onSave: (project: Project) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); const clientId = String(form.get("clientId")); const client = clients.find((item) => item.id === clientId); if (!client) { setSaving(false); return; } const name = String(form.get("name")); try { await onSave({ id: crypto.randomUUID(), clientId, number: `CF-2026-${String(50 + Math.floor(Math.random() * 900)).padStart(3, "0")}`, client: client.name, name, status: String(form.get("status")), progress: 0, value: form.get("value") ? `$${Number(form.get("value")).toLocaleString()}` : "TBD", site: String(form.get("site")), lead: String(form.get("manager")), date: "Dates pending", accent: client.color }); } finally { setSaving(false); } }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Independent project</p><h2>Create a project</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client<select name="clientId" required>{clients.map((client) => <option value={client.id} key={client.id}>{client.name} · {client.code}</option>)}</select></label><label>Project name<input name="name" required placeholder="e.g. Westport Medical Center" /></label><div className="form-row"><label>Site<input name="site" required placeholder="City, State" /></label><label>Project manager<input name="manager" required placeholder="Assigned manager" /></label></div><div className="form-row"><label>Status<select name="status"><option>Planning</option><option>Mobilizing</option><option>Installation</option><option>Closeout</option></select></label><label>Estimated value<input name="value" type="number" min="0" placeholder="125000" /></label></div><p className="form-help"><FolderTree size={14} /> This creates an independent project number and Project Register row. Create its Drive folder from the project after saving.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Creating…" : "Create project"}</button></footer></form></div></div>;
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
      <nav>{["Overview", "Tasks", "Files", "Schedule", "Activity"].map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
      <div className="drawer-body">
        {tab === "Overview" ? <>
          <section className="project-health"><div><span>Overall progress</span><strong>{project.progress}%</strong></div><div className="progress"><i style={{ width: `${project.progress}%` }} /></div><p><CheckCircle2 size={15} /> Project is managed independently from other client work</p></section>
          <div className="drawer-stats"><div><span>Contract value</span><strong>{project.value}</strong></div><div><span>Project manager</span><strong>{project.lead}</strong></div><div><span>Open tasks</span><strong>7</strong></div><div><span>Files</span><strong>38</strong></div></div>
          <section className="next-actions"><h3>Next actions</h3>{["Confirm adhesive delivery", "Send floor prep photos", "Approve phase 2 crew schedule"].map((item, index) => <label key={item}><input type="checkbox" onChange={() => notify(`Completed: ${item}`)} /><span><strong>{item}</strong><small>{index === 0 ? "Due tomorrow" : `Due Jul ${14 + index}`}</small></span></label>)}</section>
          <section className="recent-activity"><h3>Recent activity</h3><div><div className="event-icon"><Mail size={14} /></div><p><strong>Email filed to project</strong><span>Updated dock access plan · 38 min ago</span></p></div><div><div className="event-icon"><Upload size={14} /></div><p><strong>6 site photos uploaded</strong><span>By Carlos Rivera · 2 hours ago</span></p></div><div><div className="event-icon"><Check size={14} /></div><p><strong>Moisture testing completed</strong><span>By Mike Torres · Yesterday</span></p></div></section>
        </> : <EmptyProjectTab tab={tab} notify={notify} />}
      </div>
      <footer>
        <button className="soft-button" onClick={handleDrive} disabled={provisioning}><FolderOpen size={16} /> {provisioning ? "Creating folder…" : project.driveUrl ? "Open Drive folder" : "Create Drive folder"}</button>
        <button className="primary-button" onClick={() => notify("Project update composer opened")}><Send size={16} /> Send update</button>
      </footer>
    </aside>
  </div>;
}

function ClientDrawer({ client, projects, onClose, onNewProject }: { client: Client; projects: Project[]; onClose: () => void; onNewProject: () => void }) { return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="project-drawer client-drawer"><header><button onClick={onClose} aria-label="Close client"><X size={20} /></button><Status text={client.status} /><span>{client.code}</span></header><div className="drawer-title"><p>Client account</p><h2>{client.name}</h2><div><span><ContactRound size={14} />{client.contact}</span><span><Mail size={14} />{client.email || "Contact email pending"}</span></div></div><div className="client-drawer-body"><section className="client-account-card"><div className="directory-badge"><FolderTree size={19} /></div><div><strong>Client account folder</strong><span>Google Shared Drive setup pending</span></div></section><div className="client-summary-grid"><div><span>Industry</span><strong>{client.industry}</strong></div><div><span>Independent projects</span><strong>{projects.length}</strong></div></div><section className="client-project-section"><header><h3>Projects for this client</h3><button onClick={onNewProject}><Plus size={14} /> New project</button></header>{projects.map((project) => <div className="client-project-link" key={project.id}><div><Status text={project.status} /><strong>{project.name}</strong><span>{project.number} · {project.site}</span></div><ChevronRight size={16} /></div>)}{!projects.length && <p className="empty-client-projects">No projects yet. Create the first independent project for this client.</p>}</section><section className="client-account-notes"><h3>Account-level documents</h3><p>Store reusable client documents here: insurance, master service agreements, tax information, and ongoing contacts. Project-specific documents stay inside their own project folders.</p></section></div></aside></div>; }

function EmptyProjectTab({ tab, notify }: { tab: string; notify: (s: string) => void }) {
  const Icon = tab === "Tasks" ? ListTodo : tab === "Files" ? FolderOpen : tab === "Schedule" ? CalendarDays : Activity;
  const [items, setItems] = useState<string[]>([]);
  const itemLabel = tab === "Activity" ? "note" : tab.slice(0, -1).toLowerCase();
  function addItem() {
    setItems((current) => [...current, `New ${itemLabel} ${current.length + 1}`]);
    notify(`New ${itemLabel} added to this project view`);
  }
  return <div className="empty-tab"><div><Icon size={25} /></div><h3>{tab}</h3><p>{tab === "Files" ? "Project files will be synchronized with Google Drive after Workspace setup." : `All project ${tab.toLowerCase()} will appear here.`}</p>{items.map((item) => <div className="empty-tab-item" key={item}><Check size={14} />{item}</div>)}<button className="primary-button" onClick={addItem}><Plus size={16} /> Add {itemLabel}</button></div>;
}

function Metric({ label, value, note, trend, icon: Icon, color }: { label: string; value: string; note: string; trend: string; icon: typeof Zap; color: string }) { return <article className="metric-card"><div className={`metric-icon ${color}`}><Icon size={19} /></div><div className="metric-top"><span>{label}</span><small>{trend}</small></div><strong>{value}</strong><p>{note}</p></article> }
function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) { return <header className="panel-header"><div><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}</div>{action && <button onClick={onAction}>{action}<ChevronRight size={15} /></button>}</header> }
function PageTitle({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div> }
function Avatar({ initials, color }: { initials: string; color: string }) { return <div className={`mini-avatar ${color}`}>{initials}</div> }
function Status({ text }: { text: string }) { return <span className={`status status-${text.toLowerCase().replaceAll(" ", "-")}`}>{text}</span> }
