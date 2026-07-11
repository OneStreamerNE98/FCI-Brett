"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity, Bell, Bot, BriefcaseBusiness, Building2, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, CircleAlert, CircleCheckBig, Clock3, ContactRound, FileText, FolderOpen, FolderTree, HardHat,
  Inbox, LayoutDashboard, ListTodo, Mail, MapPin, Menu, MessageSquareText, MoreHorizontal,
  ListFilter, Plus, Search, Send, Settings, ShieldCheck, Sparkles, Upload, Users, X, Zap,
} from "lucide-react";
import { DEFAULT_FILING_RULES, DRIVE_BLUEPRINT, type FilingRuleDraft } from "./lib/google-workspace";

type View = "Overview" | "Leads" | "Clients" | "Projects" | "Schedule" | "Inbox" | "AI Assistant" | "Reports" | "Settings";
type Lead = { id: string; company: string; contact: string; project: string; value: string; stage: string; source: string; next: string; initials: string; color: string };
type Client = { id: string; code: string; name: string; contact: string; email: string; industry: string; status: string; initials: string; color: string; googleStatus: "Ready" | "Setup pending" };
type Project = { id: string; clientId: string; number: string; client: string; name: string; status: string; progress: number; value: string; site: string; lead: string; date: string; accent: string; driveFolderId?: string; driveUrl?: string };
type ProjectUpdateDraft = { project: Project; subject: string; message: string };
type ShiftAssignment = { id: string; crew: string; site: string; day: string; time: string; status: "Pending" | "Acknowledged" };
type InboxMessage = { id: string; sender: string; subject: string; preview: string; suggestedProject: string; confidence: number };

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
  { label: "Inbox", icon: Inbox, badge: "6" }, { label: "AI Assistant", icon: Sparkles },
  { label: "Reports", icon: Activity }, { label: "Settings", icon: Settings },
];

export function FloorOpsApp({ userName }: { userName: string }) {
  const [view, setView] = useState<View>("Overview");
  const [mobileNav, setMobileNav] = useState(false);
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
  const [settingsArea, setSettingsArea] = useState("Email & file rules");
  const [toast, setToast] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [projectUpdate, setProjectUpdate] = useState<Project | null>(null);
  const firstName = userName.includes("@") ? "there" : userName.split(" ")[0];

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/clients").then((r) => r.ok ? r.json() : null),
      fetch("/api/v1/projects").then((r) => r.ok ? r.json() : null),
      fetch("/api/v1/filing-rules").then((r) => r.ok ? r.json() : null),
    ]).then(([clientData, projectData, ruleData]) => {
      if (clientData?.clients?.length) setClients(clientData.clients.map((client: Record<string, unknown>) => ({ id: String(client.id), code: String(client.client_code), name: String(client.name), contact: String(client.primary_contact_name ?? "Primary contact"), email: String(client.primary_contact_email ?? ""), industry: String(client.industry ?? "Commercial"), status: String(client.status), initials: String(client.name).split(" ").map((x) => x[0]).slice(0, 2).join(""), color: "sage", googleStatus: "Setup pending" as const })));
      if (projectData?.projects?.length) setProjectItems(projectData.projects.map((project: Record<string, unknown>) => ({ id: String(project.id), clientId: String(project.client_id), number: String(project.project_number), client: String(project.client_name), name: String(project.name), status: String(project.status), progress: 0, value: project.estimated_value ? `$${Number(project.estimated_value).toLocaleString()}` : "TBD", site: String(project.site ?? "Site pending"), lead: String(project.project_manager ?? "Unassigned"), date: "Dates pending", accent: "sage", driveFolderId: project.drive_folder_id ? String(project.drive_folder_id) : undefined, driveUrl: project.drive_url ? String(project.drive_url) : undefined })));
      if (ruleData?.rules?.length) setFilingRules(ruleData.rules.map((rule: Record<string, unknown>) => ({ id: rule.id ? String(rule.id) : undefined, name: String(rule.name), enabled: Boolean(rule.enabled), priority: Number(rule.priority), matchSummary: String(rule.matchSummary ?? rule.match_summary), action: String(rule.action) as FilingRuleDraft["action"], targetCategory: String(rule.targetCategory ?? rule.target_category), approvalRequired: Boolean(rule.approvalRequired ?? rule.approval_required) })));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
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
      const data = await response.json() as { id: string; clientCode: string };
      savedClient = { ...client, id: data.id, code: data.clientCode };
      savedRemotely = true;
    } catch { /* The local prototype remains usable while a data service is unavailable. */ }
    const replacingDemoDirectory = clients.every((current) => initialClients.some((demo) => demo.id === current.id));
    setClients((current) => replacingDemoDirectory ? [savedClient] : [savedClient, ...current]);
    if (replacingDemoDirectory) setProjectItems([]);
    setClientModal(false);
    notify(savedRemotely ? `${client.name} added to the Client Directory` : `${client.name} added locally; retry sync when the data service is available`);
  }

  async function addProject(project: Project) {
    let savedProject = project;
    let savedRemotely = false;
    try {
      const response = await fetch("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: project.clientId, name: project.name, status: project.status.toLowerCase(), site: project.site, projectManager: project.lead, estimatedValue: Number(project.value.replace(/[^0-9]/g, "")) || undefined }) });
      if (!response.ok) throw new Error("Project could not be saved");
      const data = await response.json() as { id: string; projectNumber: string };
      savedProject = { ...project, id: data.id, number: data.projectNumber };
      savedRemotely = true;
    } catch { /* The local prototype remains usable while a data service is unavailable. */ }
    setProjectItems((current) => [savedProject, ...current]);
    setProjectModal(false);
    notify(savedRemotely ? `${project.name} is now an independent project for ${project.client}` : `${project.name} created locally; retry sync when the data service is available`);
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

  const clientProjectCounts = useMemo(() => new Map(clients.map((client) => [client.id, projectItems.filter((project) => project.clientId === client.id).length])), [clients, projectItems]);

  function openRules() {
    setSettingsArea("Email & file rules");
    setView("Settings");
  }

  function openGoogleWorkspace() {
    setProjectOpen(false);
    setClientOpen(false);
    setSettingsArea("Google Workspace");
    setView("Settings");
    notify("Google Workspace setup opened");
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

  function searchWorkspace() {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      notify("Enter a client, project, project number, or contact to search");
      return;
    }
    const project = projectItems.find((item) => [item.name, item.number, item.client, item.site, item.lead].some((value) => value.toLowerCase().includes(query)));
    if (project) {
      openProject(project);
      notify(`Opened ${project.number}`);
      return;
    }
    const client = clients.find((item) => [item.name, item.code, item.contact, item.email].some((value) => value.toLowerCase().includes(query)));
    if (client) {
      openClient(client);
      notify(`Opened ${client.name}`);
      return;
    }
    notify(`No client or project matched “${searchTerm}”`);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- The supplied local brand mark does not need optimizer handling. */}
            <img src="/floor-coverings-international-logo.png" alt="Floor Coverings International" />
          </div>
        <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={20} /></button>
        <nav className="main-nav" aria-label="Main navigation">
          <p>Workspace</p>
          {navItems.slice(0, 7).map(({ label, icon: Icon, badge }) => <button key={label} className={view === label ? "active" : ""} onClick={() => { setView(label); setMobileNav(false); }}><Icon size={18} /><span>{label}</span>{badge && <b>{badge}</b>}</button>)}
          <p>Management</p>
          {navItems.slice(7).map(({ label, icon: Icon }) => <button key={label} className={view === label ? "active" : ""} onClick={() => { setView(label); setMobileNav(false); }}><Icon size={18} /><span>{label}</span></button>)}
        </nav>
        <div className="workspace-card"><div className="workspace-icon"><Building2 size={17} /></div><div><span>Workspace</span><strong>Floor Coverings International</strong></div><ChevronDown size={16} /></div>
        <div className="profile"><div className="avatar">JG</div><div><strong>{userName}</strong><span>Administrator</span></div><MoreHorizontal size={18} /></div>
      </aside>

      {mobileNav && <button className="sidebar-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <form className="search" onSubmit={(event) => { event.preventDefault(); searchWorkspace(); }}><Search size={18} /><input id="workspace-search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} aria-label="Search workspace" placeholder="Search projects, clients, contacts…" /><button className="search-shortcut" type="button" onClick={() => document.getElementById("workspace-search")?.focus()} aria-label="Focus workspace search">⌘ K</button></form>
          <div className="top-actions"><div className="notification-wrap"><button className="icon-button" onClick={() => setNotificationsOpen((current) => !current)} aria-label="Notifications" aria-expanded={notificationsOpen}><Bell size={19} /><i /></button>{notificationsOpen && <div className="notification-menu" role="status"><strong>Needs attention</strong><button onClick={() => { setView("Schedule"); setNotificationsOpen(false); }}>2 schedule confirmations pending</button><button onClick={() => { setView("Inbox"); setNotificationsOpen(false); }}>3 email matches ready for review</button><button onClick={() => { setView("Projects"); setNotificationsOpen(false); }}>1 closeout follow-up overdue</button></div>}</div><button className="primary-button" onClick={() => setLeadModal(true)}><Plus size={17} /> Add lead</button></div>
        </header>

        <div className="page-wrap">
          {view === "Overview" && <Overview firstName={firstName} leads={leads} projects={projectItems} onView={setView} onProject={openProject} />}
          {view === "Leads" && <LeadsView leads={leads} onAdd={() => setLeadModal(true)} onAdvance={advanceLead} />}
          {view === "Clients" && <ClientsView clients={clients} projects={projectItems} projectCounts={clientProjectCounts} onAdd={() => setClientModal(true)} onClient={openClient} onNewProject={() => setProjectModal(true)} />}
          {view === "Projects" && <ProjectsView projects={projectItems} onNewProject={() => setProjectModal(true)} onProject={openProject} />}
          {view === "Schedule" && <ScheduleView notify={notify} />}
          {view === "Inbox" && <InboxView notify={notify} onRules={openRules} />}
          {view === "AI Assistant" && <AssistantView />}
          {view === "Reports" && <ReportsView />}
          {view === "Settings" && <SettingsView notify={notify} section={settingsArea} onSection={setSettingsArea} rules={filingRules} projects={projectItems} onAddRule={() => setRuleModal(true)} />}
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
      <div className="panel inbox-panel"><PanelHeader title="Smart inbox" subtitle="6 unfiled" action="Review inbox" onAction={() => onView("Inbox")} /><div className="mail-list"><MailItem sender="Elena Park" subject="Ridgeway finish selections" project="Suggested: Hudson Retail" time="9:42 AM" /><MailItem sender="Carlos Rivera" subject="Photos from Harbor Plaza" project="Suggested: CF-2026-038" time="8:17 AM" /><MailItem sender="Morgan Construction" subject="Updated dock access plan" project="Suggested: One Harbor Plaza" time="Yesterday" /></div><button className="inbox-cta" onClick={() => onView("Inbox")}><Sparkles size={15} /> Review 3 high-confidence matches</button></div>
    </section>
  </>;
}

function LeadsView({ leads, onAdd, onAdvance }: { leads: Lead[]; onAdd: () => void; onAdvance: (id: string) => void }) {
  const stages = leadStages;
  return <><PageTitle eyebrow="Sales pipeline" title="Leads & opportunities" text={`${leads.length} open opportunities · $511,700 estimated value`} action={<button className="primary-button" onClick={onAdd}><Plus size={17} /> Add lead</button>} />
    <div className="board">{stages.map((stage) => <section className="board-column" key={stage}><header><span>{stage}</span><b>{leads.filter((l) => l.stage === stage).length}</b><MoreHorizontal size={17} /></header>{leads.filter((l) => l.stage === stage).map((lead) => <article className="lead-card" key={lead.id}><div className="lead-card-head"><Avatar initials={lead.initials} color={lead.color} /><span>{lead.id}</span></div><h3>{lead.company}</h3><p>{lead.project}</p><div className="lead-value">{lead.value}</div><div className="lead-contact"><Users size={14} />{lead.contact}</div><footer><span>{lead.source}</span><button onClick={() => onAdvance(lead.id)} aria-label={`Advance ${lead.company} to the next pipeline stage`}><ChevronRight size={15} /></button></footer></article>)}<button className="add-card" onClick={onAdd}><Plus size={15} /> Add opportunity</button></section>)}</div>
  </>;
}

function ClientsView({ clients, projects, projectCounts, onAdd, onClient, onNewProject }: { clients: Client[]; projects: Project[]; projectCounts: Map<string, number>; onAdd: () => void; onClient: (client: Client) => void; onNewProject: () => void }) {
  return <><PageTitle eyebrow="Google Workspace directory" title="Clients" text="Each client can have multiple independent projects, contacts, and account-level documents" action={<div className="title-actions"><button className="soft-button" onClick={onNewProject}><BriefcaseBusiness size={16} /> New project</button><button className="primary-button" onClick={onAdd}><Plus size={17} /> Add client</button></div>} />
    <section className="client-directory-banner"><div className="directory-badge"><FolderTree size={20} /></div><div><strong>Client Directory mirrors to Google Sheets after Google Workspace setup</strong><span>The app manages project relationships; Google Drive holds account documents and independent project folders.</span></div><span className="directory-status"><CircleCheckBig size={14} />Ready to configure</span></section>
    <div className="client-directory panel"><div className="client-table-head"><span>Client</span><span>Primary contact</span><span>Independent projects</span><span>Google Workspace</span><span /></div>{clients.map((client) => { const projectCount = projectCounts.get(client.id) ?? 0; const clientProjects = projects.filter((project) => project.clientId === client.id); return <button className="client-table-row" key={client.id} onClick={() => onClient(client)}><div className="client-identity"><Avatar initials={client.initials} color={client.color} /><span><strong>{client.name}</strong><small>{client.code} · {client.industry}</small></span></div><span><strong>{client.contact}</strong><small>{client.email || "Email to add"}</small></span><span className="client-project-count"><b>{projectCount}</b><small>{projectCount === 1 ? "project" : "projects"}{clientProjects.length > 1 ? " · independently managed" : ""}</small></span><span className={client.googleStatus === "Ready" ? "google-ready" : "google-pending"}>{client.googleStatus === "Ready" ? <CircleCheckBig size={13} /> : <Clock3 size={13} />}{client.googleStatus}</span><ChevronRight size={17} /></button>})}</div>
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

function InboxView({ notify, onRules }: { notify: (s: string) => void; onRules: () => void }) {
  const messages: InboxMessage[] = [
    { id: "mail-ridgeway", sender: "Elena Park", subject: "Ridgeway finish selections", preview: "Attached are the updated LVT and base selections we reviewed…", suggestedProject: "Hudson Retail Group", confidence: 98 },
    { id: "mail-harbor", sender: "Carlos Rivera", subject: "Photos from Harbor Plaza", preview: "Moisture test photos and readings from this morning are attached.", suggestedProject: "CF-2026-038", confidence: 96 },
    { id: "mail-dock", sender: "Morgan Construction", subject: "Updated dock access plan", preview: "Please use the revised loading dock sequence beginning Monday.", suggestedProject: "One Harbor Plaza", confidence: 91 },
    { id: "mail-fairfield", sender: "Priya Shah", subject: "RE: Fairfield Commons proposal", preview: "We have two questions about the alternates in section three…", suggestedProject: "Mason & Reed", confidence: 84 },
  ];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reviewItems, setReviewItems] = useState<InboxMessage[]>([]);
  const [reviewed, setReviewed] = useState<Record<string, string>>({});
  const allSelected = selectedIds.length === messages.length;
  function toggleMessage(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  function openReview(items: InboxMessage[]) {
    if (!items.length) {
      notify("Select a message or choose the high-confidence suggestions to review");
      return;
    }
    setReviewItems(items);
  }
  return <><PageTitle eyebrow="Gmail intake" title="Smart inbox" text="Review suggestions before emails and attachments are filed" action={<button className="soft-button" onClick={onRules}><ListFilter size={15} /> Email & file rules</button>} />
    <section className="inbox-safety"><ShieldCheck size={18} /><div><strong>Safe routing is on</strong><span>A contact with multiple active projects is never auto-filed. FCI Operations requires a project number, a specific rule, or your selection.</span></div><button onClick={onRules}>Manage rules</button></section>
    <div className="inbox-layout"><section className="panel message-list"><header className="list-toolbar"><label><input type="checkbox" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? messages.map((message) => message.id) : [])} /> Select all</label><button onClick={() => openReview(selectedIds.length ? messages.filter((message) => selectedIds.includes(message.id)) : messages.filter((message) => message.confidence >= 90))}><Sparkles size={15} /> {selectedIds.length ? `Review ${selectedIds.length} selected` : "Review high-confidence"}</button></header>{messages.map((message, index) => <article className="message-row" key={message.id}><input type="checkbox" checked={selectedIds.includes(message.id)} onChange={() => toggleMessage(message.id)} aria-label={`Select ${message.subject}`} /><div className={`sender-dot s${index}`}>{message.sender.split(" ").map((part) => part[0]).join("")}</div><div className="message-copy"><strong>{message.sender} <span>{index < 2 && "NEW"}</span></strong><h3>{message.subject}</h3><p>{message.preview}</p><div><FolderOpen size={13} /> Suggested: {message.suggestedProject} <b>{message.confidence}% match</b></div></div><div className="message-actions"><span>{index < 3 ? "Today" : "Yesterday"}</span>{reviewed[message.id] && <small>{reviewed[message.id]}</small>}<button onClick={() => openReview([message])}><Check size={16} /> {reviewed[message.id] ? "Review again" : "Review"}</button></div></article>)}</section><aside className="panel inbox-summary"><div className="summary-icon"><Sparkles size={20} /></div><h3>Inbox assistant</h3><p>Rules suggest a destination; you approve every email, file, and attachment before it moves.</p><div><span>High confidence</span><strong>3</strong></div><div><span>Needs project selection</span><strong>2</strong></div><div><span>Needs review</span><strong>1</strong></div><hr /><small>Gmail setup required</small><small>Drive archive setup required</small></aside></div>
    {reviewItems.length > 0 && <InboxReviewModal messages={reviewItems} onClose={() => setReviewItems([])} onApprove={() => { setReviewed((current) => ({ ...current, ...Object.fromEntries(reviewItems.map((item) => [item.id, "Approved—waiting for Gmail"] as const)) })); setSelectedIds((current) => current.filter((id) => !reviewItems.some((item) => item.id === id))); notify(`${reviewItems.length} email ${reviewItems.length === 1 ? "decision" : "decisions"} recorded. Gmail will not be changed until it is connected.`); setReviewItems([]); }} onNeedsReview={() => { setReviewed((current) => ({ ...current, ...Object.fromEntries(reviewItems.map((item) => [item.id, "Needs project selection"] as const)) })); notify(`${reviewItems.length} email ${reviewItems.length === 1 ? "was" : "were"} sent to the review queue`); setReviewItems([]); }} />}
  </>;
}

function AssistantView() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string; citations: string[] } | null>(null);
  const [context, setContext] = useState("Atlas Design Group · Westport Medical");
  const [sourceDetail, setSourceDetail] = useState<string | null>(null);
  const contextText = context === "All authorized projects" ? "Authorized projects include Westport Medical, Northpoint Imaging Suite, One Harbor Plaza, and The Foundry Hotel. Use only the supplied project records and say when evidence is missing." : "Atlas Design Group; Westport Medical Center; mobilization July 15; moisture testing complete; adhesive delivery pending; client site access confirmed after 6:00 AM.";
  async function ask(q?: string) {
    const prompt = q ?? question;
    if (!prompt.trim()) return;
    setQuestion(prompt);
    setLoading(true);
    try {
      const response = await fetch("/api/v1/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: prompt, context: contextText }) });
      if (!response.ok) throw new Error("Assistant request failed");
      const data = await response.json() as { answer?: string; citations?: string[] };
      if (!data.answer || !data.citations) throw new Error("Assistant response was incomplete");
      setAnswer({ answer: data.answer, citations: data.citations });
    } catch {
      setAnswer({ answer: "The assistant could not reach its service. You can keep testing the workflow, but connect the OpenAI key before relying on answers for project decisions.", citations: [] });
    } finally {
      setLoading(false);
    }
  }
  return <><PageTitle eyebrow="Permission-aware AI" title="Ask FCI Assistant" text="Answers are grounded in the project records you’re allowed to see" />
    <div className="assistant-layout"><section className="assistant-main panel"><div className="assistant-hero"><div className="ai-orb"><Bot size={29} /></div><h2>What would you like to know?</h2><p>Search project notes, emails, files, meetings, schedules, and tasks.</p></div><div className="prompt-chips">{["What needs attention this week?", "Summarize Westport Medical", "Which clients need a follow-up?"].map((q) => <button key={q} onClick={() => ask(q)}>{q}<ChevronRight size={14} /></button>)}</div>{answer && <article className="ai-answer"><div><Sparkles size={18} /><strong>FCI Assistant answer</strong></div><p>{answer.answer}</p><h4>Sources</h4>{answer.citations.length ? answer.citations.map((citation, index) => <button key={citation} onClick={() => setSourceDetail(citation)}><FileText size={14} /><span>[{index + 1}] {citation}</span><ChevronRight size={14} /></button>) : <p className="source-empty">No verified source links are available for this response.</p>}</article>}<form className="ask-box" onSubmit={(event) => { event.preventDefault(); ask(); }}><select value={context} onChange={(event) => setContext(event.target.value)} aria-label="Project context"><option>Atlas Design Group · Westport Medical</option><option>All authorized projects</option></select><div><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about a client, project, meeting, or schedule…" aria-label="Ask FCI Assistant" /><button disabled={loading || !question.trim()} aria-label="Send question">{loading ? <span className="spinner" /> : <Send size={18} />}</button></div><small><Sparkles size={12} /> Answers include source links. Verify important decisions.</small></form></section><aside className="panel recent-questions"><h3>Recent questions</h3>{["What changed in the Harbor Plaza scope?", "Summarize the last client meeting", "Who has not confirmed next week?", "List overdue closeout items"].map((q, index) => <button key={q} onClick={() => ask(q)}><MessageSquareText size={15} /><span>{q}<small>{index === 0 ? "12 min ago" : `${index + 1} days ago`}</small></span></button>)}<div className="privacy-note"><CheckCircle2 size={17} /><p><strong>Project permissions apply</strong><br />Answers never include records you cannot access.</p></div></aside></div>
    {sourceDetail && <SourceDetailModal citation={sourceDetail} onClose={() => setSourceDetail(null)} />}
  </>;
}

function ReportsView() { return <><PageTitle eyebrow="Business performance" title="Reports" text="A clear view of pipeline, delivery, and workload" /><section className="metrics-grid"><Metric label="Won revenue YTD" value="$1.28m" note="18 projects" trend="+24%" icon={BriefcaseBusiness} color="green" /><Metric label="Average sales cycle" value="31 days" note="Inquiry to award" trend="-4 days" icon={Clock3} color="blue" /><Metric label="Crew utilization" value="82%" note="Next 30 days" trend="Healthy" icon={Users} color="orange" /><Metric label="Closeout time" value="9 days" note="Average" trend="-2 days" icon={CheckCircle2} color="violet" /></section><div className="reports-grid"><section className="panel report-chart"><PanelHeader title="Pipeline by stage" subtitle="Estimated value" /><div className="bar-chart">{[["New inquiry", 45, "$86.5k"], ["Site visit", 72, "$142k"], ["Proposal", 34, "$64.8k"], ["Decision", 100, "$218.4k"]].map((b) => <div key={String(b[0])}><span>{b[0]}</span><div><i style={{ width: `${b[1]}%` }} /></div><strong>{b[2]}</strong></div>)}</div></section><section className="panel report-chart"><PanelHeader title="Project health" subtitle="8 active" /><div className="health-donut"><div><strong>75%</strong><span>On track</span></div></div><div className="legend"><span><i className="g" />On track <b>6</b></span><span><i className="a" />At risk <b>1</b></span><span><i className="r" />Blocked <b>1</b></span></div></section></div></> }

function SettingsView({ notify, section, onSection, rules, projects, onAddRule }: { notify: (s: string) => void; section: string; onSection: (section: string) => void; rules: FilingRuleDraft[]; projects: Project[]; onAddRule: () => void }) {
  const options = ["Google Workspace", "Email & file rules", "Client Directory", "Testing & launch", "Pipeline stages", "Notifications", "People & roles", "Data & security"];
  return <><PageTitle eyebrow="Administration" title="Workspace settings" text="Set your Google structure, routing rules, and access controls in one place" />
    <div className="settings-layout"><aside className="settings-nav panel">{options.map((option) => <button className={section === option ? "active" : ""} key={option} onClick={() => onSection(option)}>{option}<ChevronRight size={15} /></button>)}</aside>
      {section === "Email & file rules" && <section className="panel rule-settings"><div className="settings-heading"><div><p className="eyebrow">Gmail intake rules</p><h2>Email & file rules</h2><p>Rules propose a destination; approval remains required before FCI Operations labels, archives, or copies anything.</p></div><button className="primary-button" onClick={onAddRule}><Plus size={16} /> Add rule</button></div><div className="rule-callout"><ShieldCheck size={19} /><p><strong>Multi-project protection</strong><br />A contact match cannot auto-select a project if that client has multiple eligible projects.</p></div><div className="rules-table"><div className="rules-table-head"><span>Priority</span><span>Rule</span><span>When it matches</span><span>Action</span><span>Destination</span></div>{rules.map((rule) => <div className="rule-row" key={rule.id ?? rule.name}><span className="rule-priority">{rule.priority}</span><span><strong>{rule.name}</strong><small>{rule.enabled ? "Enabled" : "Disabled"} · approval required</small></span><span>{rule.matchSummary}</span><Status text={rule.action === "review" ? "Needs review" : rule.action === "ignore" ? "Ignored" : "Suggest"} /><span>{rule.targetCategory}</span></div>)}</div><div className="rule-footnote"><Mail size={15} /><span>Use only broad Gmail labels: <b>{DRIVE_BLUEPRINT.gmailLabels.join(", ")}</b>. Do not create a Gmail filter per project.</span></div></section>}
      {section === "Google Workspace" && <GoogleWorkspacePanel notify={notify} projects={projects} />}
      {section === "Client Directory" && <section className="panel client-directory-settings"><div className="settings-heading"><div><p className="eyebrow">Google Sheets mirror</p><h2>Client Directory</h2><p>FCI Operations is the operational source of truth; a Google Sheet gives your team a familiar, always-current directory in the Shared Drive.</p></div><button className="soft-button" onClick={() => { onSection("Google Workspace"); notify("Open the Workspace checklist to configure the Client Directory sheet"); }}>Configure sheet</button></div><div className="directory-layout"><div><h3>What syncs to the Google Sheet</h3><ul><li>Client code and legal/business name</li><li>Primary contact and email</li><li>Active-project count and project links</li><li>Client account folder and status</li></ul></div><div><h3>Why one-way at launch</h3><p>It keeps client records, projects, email rules, and the audit trail from becoming inconsistent. A controlled import tab can be added later for spreadsheet changes.</p></div></div></section>}
      {section === "Testing & launch" && <TestingLaunchPanel onGoogleSetup={() => onSection("Google Workspace")} />}
      {!(["Email & file rules", "Google Workspace", "Client Directory", "Testing & launch"] as string[]).includes(section) && <section className="panel integrations"><h2>{section}</h2><p>This administration area is ready for the next implementation step.</p><div className="settings-placeholder"><Settings size={22} /><span>Configure this area after the Google Workspace foundation is connected.</span></div></section>}
    </div></>;
}

type GmailTestMessage = { id: string; from: string | null; subject: string | null; date: string | null; snippet: string };
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
    requiresReauthorization?: boolean;
    provisioningEnabled?: boolean;
    gmailEnabled?: boolean;
    calendarEnabled?: boolean;
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

  async function checkSetup() {
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
          requiresReauthorization?: boolean;
          provisioningEnabled?: boolean;
          gmailEnabled?: boolean;
          calendarEnabled?: boolean;
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
  }

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
      <div>
        <p className="eyebrow">Google Workspace foundation</p>
        <h2>Google Workspace</h2>
        <p>{testProfile ? "Personal Google testing stays in a separate test profile. Later, production will require a new company Google connection and a company-owned workspace." : "This production profile is reserved for the company Google account and company-owned workspace."}</p>
      </div>
      <button className="primary-button" onClick={checkSetup} disabled={checking}>{checking ? "Checking…" : "Check readiness"}</button>
    </div>
    <div className={`workspace-connection ${connected ? "ready" : ""}`}>
      <div className="integration-logo google"><Mail size={20} /></div>
      <div>
        <strong>{connected ? `${testProfile ? "Personal test" : "Production"} Google services connected` : reconnectRequired ? "Google permission update required" : configured ? `Ready to connect ${testProfile ? "personal test" : "production"} Google services` : temporary && workspace?.storageConfigured ? "Temporary Drive folder configured" : "Google Workspace setup required"}</strong>
        <span>{connected ? `${workspace?.connectionAccount ?? "Approved account"} is connected with ${selectedServices}.` : reconnectRequired ? "Reconnect and approve every selected service before Gmail or Calendar test controls can be used." : configured ? `The active profile will request ${selectedServices}.` : temporary && workspace?.storageConfigured ? "The Drive root is set, but OAuth and admin safety settings still need to be configured." : "Google is not connected until the active profile configuration is complete."}</span>
      </div>
      <span>{connected ? "Connected" : reconnectRequired ? "Reconnect" : configured ? "Authorize next" : temporary && workspace?.storageConfigured ? "Storage ready" : "Not connected"}</span>
    </div>
    {testProfile && <p className="workspace-warning"><CircleAlert size={15} /><span><strong>Personal test mode:</strong> use only self-sent test messages and sample documents. Gmail labels, self-test email, and Calendar holds require your direct click; the app never automatically archives email, removes Inbox, invites guests, or alters existing events.</span></p>}
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

function InboxReviewModal({ messages, onClose, onApprove, onNeedsReview }: { messages: InboxMessage[]; onClose: () => void; onApprove: () => void; onNeedsReview: () => void }) {
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Review-first email filing</p><h2>{messages.length} suggested {messages.length === 1 ? "message" : "messages"}</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="modal-detail"><p>These decisions only update the safe prototype queue. No Gmail label, archive, email copy, attachment, or Drive file will change until OAuth and the review-to-file workflow are connected.</p>{messages.map((message) => <div className="review-message" key={message.id}><strong>{message.subject}</strong><span>{message.sender} · {message.confidence}% match · Suggested: {message.suggestedProject}</span></div>)}</div><footer className="modal-footer"><button className="soft-button" onClick={onNeedsReview}>Needs project selection</button><button className="primary-button" onClick={onApprove}><Check size={16} /> Record approval</button></footer></div></div>;
}

function SourceDetailModal({ citation, onClose }: { citation: string; onClose: () => void }) {
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Assistant source</p><h2>Evidence reference</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="modal-detail"><strong>{citation}</strong><p>This source is available in the prototype evidence list. Once Drive and the permission-aware index are connected, this control will open the exact permitted project record or archived document.</p></div><footer className="modal-footer"><button className="primary-button" onClick={onClose}>Done</button></footer></div></div>;
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
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Client Directory</p><h2>Add a client</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client business name<input name="name" required placeholder="e.g. Atlas Design Group" /></label><div className="form-row"><label>Primary contact<input name="contact" required placeholder="Full name" /></label><label>Work email<input name="email" type="email" required placeholder="name@company.com" /></label></div><div className="form-row"><label>Industry<select name="industry"><option>General contractor</option><option>Healthcare</option><option>Retail</option><option>Hospitality</option><option>Property management</option><option>Other commercial</option></select></label><label>Client status<select name="status"><option>Active</option><option>Prospect</option><option>Inactive</option></select></label></div><p className="form-help"><FolderTree size={14} /> After Google Workspace is connected, FCI Operations will create the client account folder and Client Directory row.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add client"}</button></footer></form></div></div>;
}

function NewProjectModal({ clients, onClose, onSave }: { clients: Client[]; onClose: () => void; onSave: (project: Project) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); const clientId = String(form.get("clientId")); const client = clients.find((item) => item.id === clientId); if (!client) { setSaving(false); return; } const name = String(form.get("name")); try { await onSave({ id: crypto.randomUUID(), clientId, number: `CF-2026-${String(50 + Math.floor(Math.random() * 900)).padStart(3, "0")}`, client: client.name, name, status: String(form.get("status")), progress: 0, value: form.get("value") ? `$${Number(form.get("value")).toLocaleString()}` : "TBD", site: String(form.get("site")), lead: String(form.get("manager")), date: "Dates pending", accent: client.color }); } finally { setSaving(false); } }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Independent project</p><h2>Create a project</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client<select name="clientId" required>{clients.map((client) => <option value={client.id} key={client.id}>{client.name} · {client.code}</option>)}</select></label><label>Project name<input name="name" required placeholder="e.g. Westport Medical Center" /></label><div className="form-row"><label>Site<input name="site" required placeholder="City, State" /></label><label>Project manager<input name="manager" required placeholder="Assigned manager" /></label></div><div className="form-row"><label>Status<select name="status"><option>Planning</option><option>Mobilizing</option><option>Installation</option><option>Closeout</option></select></label><label>Estimated value<input name="value" type="number" min="0" placeholder="125000" /></label></div><p className="form-help"><FolderTree size={14} /> This creates a separate project number, project folder tree, schedule, activity history, and email destination.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Creating…" : "Create project"}</button></footer></form></div></div>;
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
function MailItem({ sender, subject, project, time }: { sender: string; subject: string; project: string; time: string }) { return <div className="mail-item"><div className="mail-avatar">{sender.split(" ").map(s => s[0]).join("")}</div><div><strong>{sender}</strong><span>{subject}</span><small><FolderOpen size={12} />{project}</small></div><time>{time}</time></div> }
