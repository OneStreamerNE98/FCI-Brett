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
type Project = { id: string; clientId: string; number: string; client: string; name: string; status: string; progress: number; value: string; site: string; lead: string; date: string; accent: string };

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
  const firstName = userName.includes("@") ? "there" : userName.split(" ")[0];

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/clients").then((r) => r.ok ? r.json() : null),
      fetch("/api/v1/projects").then((r) => r.ok ? r.json() : null),
      fetch("/api/v1/filing-rules").then((r) => r.ok ? r.json() : null),
    ]).then(([clientData, projectData, ruleData]) => {
      if (clientData?.clients?.length) setClients(clientData.clients.map((client: Record<string, unknown>) => ({ id: String(client.id), code: String(client.client_code), name: String(client.name), contact: "Primary contact", email: "", industry: String(client.industry ?? "Commercial"), status: String(client.status), initials: String(client.name).split(" ").map((x) => x[0]).slice(0, 2).join(""), color: "sage", googleStatus: "Setup pending" as const })));
      if (projectData?.projects?.length) setProjectItems(projectData.projects.map((project: Record<string, unknown>) => ({ id: String(project.id), clientId: String(project.client_id), number: String(project.project_number), client: String(project.client_name), name: String(project.name), status: String(project.status), progress: 0, value: project.estimated_value ? `$${Number(project.estimated_value).toLocaleString()}` : "TBD", site: String(project.site ?? "Site pending"), lead: String(project.project_manager ?? "Unassigned"), date: "Dates pending", accent: "sage" })));
      if (ruleData?.rules?.length) setFilingRules(ruleData.rules.map((rule: Record<string, unknown>) => ({ id: rule.id ? String(rule.id) : undefined, name: String(rule.name), enabled: Boolean(rule.enabled), priority: Number(rule.priority), matchSummary: String(rule.matchSummary ?? rule.match_summary), action: String(rule.action) as FilingRuleDraft["action"], targetCategory: String(rule.targetCategory ?? rule.target_category), approvalRequired: Boolean(rule.approvalRequired ?? rule.approval_required) })));
    }).catch(() => undefined);
  }, []);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function addLead(lead: Lead) {
    setLeads((current) => [lead, ...current]);
    setLeadModal(false);
    notify(`${lead.company} added to your pipeline`);
    try { await fetch("/api/v1/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "lead", status: "new", payload: lead }) }); } catch { /* local preview remains functional */ }
  }

  async function addClient(client: Client) {
    const replacingDemoDirectory = clients.every((current) => initialClients.some((demo) => demo.id === current.id));
    setClients((current) => replacingDemoDirectory ? [client] : [client, ...current]);
    if (replacingDemoDirectory) setProjectItems([]);
    setClientModal(false);
    notify(`${client.name} added to the Client Directory`);
    try { await fetch("/api/v1/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: client.name, industry: client.industry, status: client.status.toLowerCase(), primaryContact: { name: client.contact, email: client.email } }) }); } catch { /* local prototype remains usable */ }
  }

  async function addProject(project: Project) {
    setProjectItems((current) => [project, ...current]);
    setProjectModal(false);
    notify(`${project.name} is now an independent project for ${project.client}`);
    try { await fetch("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: project.clientId, name: project.name, status: project.status.toLowerCase(), site: project.site, projectManager: project.lead, estimatedValue: Number(project.value.replace(/[^0-9]/g, "")) || undefined }) }); } catch { /* local prototype remains usable */ }
  }

  async function addRule(rule: FilingRuleDraft) {
    setFilingRules((current) => [...current, rule].sort((a, b) => a.priority - b.priority));
    setRuleModal(false);
    notify(`Email rule “${rule.name}” added`);
    try { await fetch("/api/v1/filing-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule) }); } catch { /* local prototype remains usable */ }
  }

  const clientProjectCounts = useMemo(() => new Map(clients.map((client) => [client.id, projectItems.filter((project) => project.clientId === client.id).length])), [clients, projectItems]);

  function openRules() {
    setSettingsArea("Email & file rules");
    setView("Settings");
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark"><span /><span /><span /></div><div><strong>GROUNDWORK</strong><small>Commercial Operations</small></div></div>
        <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={20} /></button>
        <nav className="main-nav" aria-label="Main navigation">
          <p>Workspace</p>
          {navItems.slice(0, 7).map(({ label, icon: Icon, badge }) => <button key={label} className={view === label ? "active" : ""} onClick={() => { setView(label); setMobileNav(false); }}><Icon size={18} /><span>{label}</span>{badge && <b>{badge}</b>}</button>)}
          <p>Management</p>
          {navItems.slice(7).map(({ label, icon: Icon }) => <button key={label} className={view === label ? "active" : ""} onClick={() => { setView(label); setMobileNav(false); }}><Icon size={18} /><span>{label}</span></button>)}
        </nav>
        <div className="workspace-card"><div className="workspace-icon"><Building2 size={17} /></div><div><span>Workspace</span><strong>Grass Flooring Co.</strong></div><ChevronDown size={16} /></div>
        <div className="profile"><div className="avatar">JG</div><div><strong>{userName}</strong><span>Administrator</span></div><MoreHorizontal size={18} /></div>
      </aside>

      {mobileNav && <button className="sidebar-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="search"><Search size={18} /><input aria-label="Search workspace" placeholder="Search projects, clients, contacts…" /><kbd>⌘ K</kbd></div>
          <div className="top-actions"><button className="icon-button" aria-label="Notifications"><Bell size={19} /><i /></button><button className="primary-button" onClick={() => setLeadModal(true)}><Plus size={17} /> Add lead</button></div>
        </header>

        <div className="page-wrap">
          {view === "Overview" && <Overview firstName={firstName} leads={leads} projects={projectItems} onView={setView} onProject={(p) => { setSelectedProject(p); setProjectOpen(true); }} notify={notify} />}
          {view === "Leads" && <LeadsView leads={leads} onAdd={() => setLeadModal(true)} notify={notify} />}
          {view === "Clients" && <ClientsView clients={clients} projects={projectItems} projectCounts={clientProjectCounts} onAdd={() => setClientModal(true)} onClient={(client) => { setSelectedClient(client); setClientOpen(true); }} onNewProject={() => setProjectModal(true)} />}
          {view === "Projects" && <ProjectsView projects={projectItems} onNewProject={() => setProjectModal(true)} onProject={(p) => { setSelectedProject(p); setProjectOpen(true); }} />}
          {view === "Schedule" && <ScheduleView notify={notify} />}
          {view === "Inbox" && <InboxView notify={notify} onRules={openRules} />}
          {view === "AI Assistant" && <AssistantView />}
          {view === "Reports" && <ReportsView />}
          {view === "Settings" && <SettingsView notify={notify} section={settingsArea} onSection={setSettingsArea} rules={filingRules} onAddRule={() => setRuleModal(true)} />}
        </div>
      </main>
      {leadModal && <LeadModal onClose={() => setLeadModal(false)} onSave={addLead} />}
      {clientModal && <ClientModal onClose={() => setClientModal(false)} onSave={addClient} />}
      {projectModal && <NewProjectModal clients={clients} onClose={() => setProjectModal(false)} onSave={addProject} />}
      {ruleModal && <RuleModal onClose={() => setRuleModal(false)} onSave={addRule} />}
      {projectOpen && <ProjectDrawer project={selectedProject} onClose={() => setProjectOpen(false)} notify={notify} />}
      {clientOpen && <ClientDrawer client={selectedClient} projects={projectItems.filter((project) => project.clientId === selectedClient.id)} onClose={() => setClientOpen(false)} onNewProject={() => { setClientOpen(false); setProjectModal(true); }} />}
      {toast && <div className="toast"><CheckCircle2 size={18} />{toast}</div>}
    </div>
  );
}

function Overview({ firstName, leads, projects, onView, onProject, notify }: { firstName: string; leads: Lead[]; projects: Project[]; onView: (v: View) => void; onProject: (p: Project) => void; notify: (s: string) => void }) {
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
      <div className="panel inbox-panel"><PanelHeader title="Smart inbox" subtitle="6 unfiled" action="Review inbox" onAction={() => onView("Inbox")} /><div className="mail-list"><MailItem sender="Elena Park" subject="Ridgeway finish selections" project="Suggested: Hudson Retail" time="9:42 AM" /><MailItem sender="Carlos Rivera" subject="Photos from Harbor Plaza" project="Suggested: CF-2026-038" time="8:17 AM" /><MailItem sender="Morgan Construction" subject="Updated dock access plan" project="Suggested: One Harbor Plaza" time="Yesterday" /></div><button className="inbox-cta" onClick={() => notify("3 email suggestions approved and filed")}><Sparkles size={15} /> File 3 high-confidence matches</button></div>
    </section>
  </>;
}

function LeadsView({ leads, onAdd, notify }: { leads: Lead[]; onAdd: () => void; notify: (s: string) => void }) {
  const stages = ["New inquiry", "Site visit", "Proposal", "Decision"];
  return <><PageTitle eyebrow="Sales pipeline" title="Leads & opportunities" text={`${leads.length} open opportunities · $511,700 estimated value`} action={<button className="primary-button" onClick={onAdd}><Plus size={17} /> Add lead</button>} />
    <div className="board">{stages.map((stage) => <section className="board-column" key={stage}><header><span>{stage}</span><b>{leads.filter((l) => l.stage === stage).length}</b><MoreHorizontal size={17} /></header>{leads.filter((l) => l.stage === stage).map((lead) => <article className="lead-card" key={lead.id}><div className="lead-card-head"><Avatar initials={lead.initials} color={lead.color} /><span>{lead.id}</span></div><h3>{lead.company}</h3><p>{lead.project}</p><div className="lead-value">{lead.value}</div><div className="lead-contact"><Users size={14} />{lead.contact}</div><footer><span>{lead.source}</span><button onClick={() => notify(`${lead.company} moved to the next stage`)}><ChevronRight size={15} /></button></footer></article>)}<button className="add-card" onClick={onAdd}><Plus size={15} /> Add opportunity</button></section>)}</div>
  </>;
}

function ClientsView({ clients, projects, projectCounts, onAdd, onClient, onNewProject }: { clients: Client[]; projects: Project[]; projectCounts: Map<string, number>; onAdd: () => void; onClient: (client: Client) => void; onNewProject: () => void }) {
  return <><PageTitle eyebrow="Google Workspace directory" title="Clients" text="Each client can have multiple independent projects, contacts, and account-level documents" action={<div className="title-actions"><button className="soft-button" onClick={onNewProject}><BriefcaseBusiness size={16} /> New project</button><button className="primary-button" onClick={onAdd}><Plus size={17} /> Add client</button></div>} />
    <section className="client-directory-banner"><div className="directory-badge"><FolderTree size={20} /></div><div><strong>Client Directory mirrors to Google Sheets after Google Workspace setup</strong><span>The app manages project relationships; Google Drive holds account documents and independent project folders.</span></div><span className="directory-status"><CircleCheckBig size={14} />Ready to configure</span></section>
    <div className="client-directory panel"><div className="client-table-head"><span>Client</span><span>Primary contact</span><span>Independent projects</span><span>Google Workspace</span><span /></div>{clients.map((client) => { const projectCount = projectCounts.get(client.id) ?? 0; const clientProjects = projects.filter((project) => project.clientId === client.id); return <button className="client-table-row" key={client.id} onClick={() => onClient(client)}><div className="client-identity"><Avatar initials={client.initials} color={client.color} /><span><strong>{client.name}</strong><small>{client.code} · {client.industry}</small></span></div><span><strong>{client.contact}</strong><small>{client.email || "Email to add"}</small></span><span className="client-project-count"><b>{projectCount}</b><small>{projectCount === 1 ? "project" : "projects"}{clientProjects.length > 1 ? " · independently managed" : ""}</small></span><span className={client.googleStatus === "Ready" ? "google-ready" : "google-pending"}>{client.googleStatus === "Ready" ? <CircleCheckBig size={13} /> : <Clock3 size={13} />}{client.googleStatus}</span><ChevronRight size={17} /></button>})}</div>
  </>;
}

function ProjectsView({ projects, onProject, onNewProject }: { projects: Project[]; onProject: (p: Project) => void; onNewProject: () => void }) {
  return <><PageTitle eyebrow="Project delivery" title="Active projects" text="Every project is independent, even when a client has repeat work" action={<button className="primary-button" onClick={onNewProject}><Plus size={17} /> New project</button>} />
    <div className="filterbar"><div className="tabs"><button className="active">Active <b>8</b></button><button>Planning <b>3</b></button><button>Closeout <b>2</b></button><button>Archived</button></div><button className="soft-button"><ChevronDown size={15} /> All project managers</button></div>
    <div className="projects-table panel"><div className="projects-table-head"><span>Project</span><span>Phase</span><span>Progress</span><span>Schedule</span><span>Value</span><span /></div>{projects.map((p) => <button className="projects-table-row" key={p.id} onClick={() => onProject(p)}><div><Avatar initials={p.client.split(" ").map((s) => s[0]).slice(0,2).join("")} color={p.accent} /><span><strong>{p.name}</strong><small>{p.number} · {p.client}</small></span></div><Status text={p.status} /><div><div className="progress compact"><i style={{ width: `${p.progress}%` }} /></div><small>{p.progress}%</small></div><span><strong>{p.date}</strong><small><MapPin size={12} />{p.site}</small></span><strong>{p.value}</strong><ChevronRight size={17} /></button>)}</div>
  </>;
}

function ScheduleView({ notify }: { notify: (s: string) => void }) {
  const days = ["Mon 13", "Tue 14", "Wed 15", "Thu 16", "Fri 17"];
  return <><PageTitle eyebrow="Field operations" title="Schedule & crews" text="July 13–17 · 3 active crews" action={<button className="primary-button" onClick={() => notify("Draft shift created") }><Plus size={17} /> New shift</button>} />
    <section className="schedule-alert"><CircleAlert size={19} /><div><strong>Schedule conflict detected</strong><span>Mike Torres is assigned to two jobs Wednesday at 8:00 AM.</span></div><button onClick={() => notify("Conflict opened for review")}>Resolve</button></section>
    <div className="calendar-board panel"><div className="calendar-corner"><span>Crews</span></div>{days.map((d, i) => <div className={`calendar-day ${i === 2 ? "today" : ""}`} key={d}><span>{d.split(" ")[0]}</span><strong>{d.split(" ")[1]}</strong></div>)}
      {[{ crew: "Rivera Crew", people: "4 installers", color: "green" }, { crew: "Torres Crew", people: "3 installers", color: "orange" }, { crew: "Northstar Subs", people: "5 installers", color: "blue" }].map((crew, ci) => <div className="calendar-row" key={crew.crew}><div className="crew-label"><Avatar initials={crew.crew.split(" ")[0].slice(0,2).toUpperCase()} color={crew.color} /><div><strong>{crew.crew}</strong><span>{crew.people}</span></div></div>{days.map((d, di) => <div className="day-cell" key={d}>{(di + ci) % 3 !== 2 && <button className={`shift-block c${ci}`} onClick={() => notify(`${crew.crew} assignment opened`)}><strong>{di % 2 ? "Harbor Plaza" : "Westport Medical"}</strong><span>{di % 2 ? "7:00 AM – 3:30 PM" : "6:00 AM – 2:00 PM"}</span><small>{di === 1 ? "Pending" : "Acknowledged"}</small></button>}</div>)}</div>)}</div>
  </>;
}

function InboxView({ notify, onRules }: { notify: (s: string) => void; onRules: () => void }) {
  const messages = [
    ["Elena Park", "Ridgeway finish selections", "Attached are the updated LVT and base selections we reviewed…", "Hudson Retail Group", "98%"],
    ["Carlos Rivera", "Photos from Harbor Plaza", "Moisture test photos and readings from this morning are attached.", "CF-2026-038", "96%"],
    ["Morgan Construction", "Updated dock access plan", "Please use the revised loading dock sequence beginning Monday.", "One Harbor Plaza", "91%"],
    ["Priya Shah", "RE: Fairfield Commons proposal", "We have two questions about the alternates in section three…", "Mason & Reed", "84%"],
  ];
  return <><PageTitle eyebrow="Gmail intake" title="Smart inbox" text="Review suggestions before emails and attachments are filed" action={<button className="soft-button" onClick={onRules}><ListFilter size={15} /> Email & file rules</button>} />
    <section className="inbox-safety"><ShieldCheck size={18} /><div><strong>Safe routing is on</strong><span>A contact with multiple active projects is never auto-filed. Groundwork requires a project number, a specific rule, or your selection.</span></div><button onClick={onRules}>Manage rules</button></section>
    <div className="inbox-layout"><section className="panel message-list"><header className="list-toolbar"><label><input type="checkbox" /> Select all</label><button onClick={() => notify("High-confidence emails are queued for your approval") }><Sparkles size={15} /> Review high-confidence</button></header>{messages.map((m, i) => <article className="message-row" key={m[1]}><input type="checkbox" aria-label={`Select ${m[1]}`} /><div className={`sender-dot s${i}`}>{m[0].split(" ").map((s) => s[0]).join("")}</div><div className="message-copy"><strong>{m[0]} <span>{i < 2 && "NEW"}</span></strong><h3>{m[1]}</h3><p>{m[2]}</p><div><FolderOpen size={13} /> Suggested: {m[3]} <b>{m[4]} match</b></div></div><div className="message-actions"><span>{i < 3 ? "Today" : "Yesterday"}</span><button onClick={() => notify(`Ready for review: “${m[1]}”`)}><Check size={16} /> Review</button></div></article>)}</section><aside className="panel inbox-summary"><div className="summary-icon"><Sparkles size={20} /></div><h3>Inbox assistant</h3><p>Rules suggest a destination; you approve every email, file, and attachment before it moves.</p><div><span>High confidence</span><strong>3</strong></div><div><span>Needs project selection</span><strong>2</strong></div><div><span>Needs review</span><strong>1</strong></div><hr /><small>Gmail setup required</small><small>Drive archive setup required</small></aside></div>
  </>;
}

function AssistantView() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string; citations: string[] } | null>(null);
  async function ask(q?: string) { const prompt = q ?? question; if (!prompt.trim()) return; setQuestion(prompt); setLoading(true); try { const res = await fetch("/api/v1/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: prompt, context: "Atlas Design Group; Westport Medical Center; mobilization July 15; moisture testing complete; adhesive delivery pending; client site access confirmed after 6:00 AM." }) }); setAnswer(await res.json()); } finally { setLoading(false); } }
  return <><PageTitle eyebrow="Permission-aware AI" title="Ask Groundwork" text="Answers are grounded in the project records you’re allowed to see" />
    <div className="assistant-layout"><section className="assistant-main panel"><div className="assistant-hero"><div className="ai-orb"><Bot size={29} /></div><h2>What would you like to know?</h2><p>Search project notes, emails, files, meetings, schedules, and tasks.</p></div><div className="prompt-chips">{["What needs attention this week?", "Summarize Westport Medical", "Which clients need a follow-up?"].map((q) => <button key={q} onClick={() => ask(q)}>{q}<ChevronRight size={14} /></button>)}</div>{answer && <article className="ai-answer"><div><Sparkles size={18} /><strong>Groundwork answer</strong></div><p>{answer.answer}</p><h4>Sources</h4>{answer.citations.map((c, i) => <button key={c}><FileText size={14} /><span>[{i + 1}] {c}</span><ChevronRight size={14} /></button>)}</article>}<form className="ask-box" onSubmit={(e) => { e.preventDefault(); ask(); }}><select aria-label="Project context"><option>Atlas Design Group · Westport Medical</option><option>All authorized projects</option></select><div><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about a client, project, meeting, or schedule…" aria-label="Ask Groundwork" /><button disabled={loading || !question.trim()} aria-label="Send question">{loading ? <span className="spinner" /> : <Send size={18} />}</button></div><small><Sparkles size={12} /> Answers include source links. Verify important decisions.</small></form></section><aside className="panel recent-questions"><h3>Recent questions</h3>{["What changed in the Harbor Plaza scope?", "Summarize the last client meeting", "Who has not confirmed next week?", "List overdue closeout items"].map((q, i) => <button key={q} onClick={() => ask(q)}><MessageSquareText size={15} /><span>{q}<small>{i === 0 ? "12 min ago" : `${i + 1} days ago`}</small></span></button>)}<div className="privacy-note"><CheckCircle2 size={17} /><p><strong>Project permissions apply</strong><br />Answers never include records you cannot access.</p></div></aside></div>
  </>;
}

function ReportsView() { return <><PageTitle eyebrow="Business performance" title="Reports" text="A clear view of pipeline, delivery, and workload" /><section className="metrics-grid"><Metric label="Won revenue YTD" value="$1.28m" note="18 projects" trend="+24%" icon={BriefcaseBusiness} color="green" /><Metric label="Average sales cycle" value="31 days" note="Inquiry to award" trend="-4 days" icon={Clock3} color="blue" /><Metric label="Crew utilization" value="82%" note="Next 30 days" trend="Healthy" icon={Users} color="orange" /><Metric label="Closeout time" value="9 days" note="Average" trend="-2 days" icon={CheckCircle2} color="violet" /></section><div className="reports-grid"><section className="panel report-chart"><PanelHeader title="Pipeline by stage" subtitle="Estimated value" /><div className="bar-chart">{[["New inquiry", 45, "$86.5k"], ["Site visit", 72, "$142k"], ["Proposal", 34, "$64.8k"], ["Decision", 100, "$218.4k"]].map((b) => <div key={String(b[0])}><span>{b[0]}</span><div><i style={{ width: `${b[1]}%` }} /></div><strong>{b[2]}</strong></div>)}</div></section><section className="panel report-chart"><PanelHeader title="Project health" subtitle="8 active" /><div className="health-donut"><div><strong>75%</strong><span>On track</span></div></div><div className="legend"><span><i className="g" />On track <b>6</b></span><span><i className="a" />At risk <b>1</b></span><span><i className="r" />Blocked <b>1</b></span></div></section></div></> }

function SettingsView({ notify, section, onSection, rules, onAddRule }: { notify: (s: string) => void; section: string; onSection: (section: string) => void; rules: FilingRuleDraft[]; onAddRule: () => void }) {
  const options = ["Google Workspace", "Email & file rules", "Client Directory", "Pipeline stages", "Notifications", "People & roles", "Data & security"];
  return <><PageTitle eyebrow="Administration" title="Workspace settings" text="Set your Google structure, routing rules, and access controls in one place" />
    <div className="settings-layout"><aside className="settings-nav panel">{options.map((option) => <button className={section === option ? "active" : ""} key={option} onClick={() => onSection(option)}>{option}<ChevronRight size={15} /></button>)}</aside>
      {section === "Email & file rules" && <section className="panel rule-settings"><div className="settings-heading"><div><p className="eyebrow">Gmail intake rules</p><h2>Email & file rules</h2><p>Rules propose a destination; approval remains required before Groundwork labels, archives, or copies anything.</p></div><button className="primary-button" onClick={onAddRule}><Plus size={16} /> Add rule</button></div><div className="rule-callout"><ShieldCheck size={19} /><p><strong>Multi-project protection</strong><br />A contact match cannot auto-select a project if that client has multiple eligible projects.</p></div><div className="rules-table"><div className="rules-table-head"><span>Priority</span><span>Rule</span><span>When it matches</span><span>Action</span><span>Destination</span></div>{rules.map((rule) => <div className="rule-row" key={rule.id ?? rule.name}><span className="rule-priority">{rule.priority}</span><span><strong>{rule.name}</strong><small>{rule.enabled ? "Enabled" : "Disabled"} · approval required</small></span><span>{rule.matchSummary}</span><Status text={rule.action === "review" ? "Needs review" : rule.action === "ignore" ? "Ignored" : "Suggest"} /><span>{rule.targetCategory}</span></div>)}</div><div className="rule-footnote"><Mail size={15} /><span>Use only broad Gmail labels: <b>{DRIVE_BLUEPRINT.gmailLabels.join(", ")}</b>. Do not create a Gmail filter per project.</span></div></section>}
      {section === "Google Workspace" && <GoogleWorkspacePanel notify={notify} />}
      {section === "Client Directory" && <section className="panel client-directory-settings"><div className="settings-heading"><div><p className="eyebrow">Google Sheets mirror</p><h2>Client Directory</h2><p>Groundwork is the operational source of truth; a Google Sheet gives your team a familiar, always-current directory in the Shared Drive.</p></div><button className="soft-button" onClick={() => notify("Client Directory sheet setup opened")}>Configure sheet</button></div><div className="directory-layout"><div><h3>What syncs to the Google Sheet</h3><ul><li>Client code and legal/business name</li><li>Primary contact and email</li><li>Active-project count and project links</li><li>Client account folder and status</li></ul></div><div><h3>Why one-way at launch</h3><p>It keeps client records, projects, email rules, and the audit trail from becoming inconsistent. A controlled import tab can be added later for spreadsheet changes.</p></div></div></section>}
      {!(["Email & file rules", "Google Workspace", "Client Directory"] as string[]).includes(section) && <section className="panel integrations"><h2>{section}</h2><p>This administration area is ready for the next implementation step.</p><div className="settings-placeholder"><Settings size={22} /><span>Configure this area after the Google Workspace foundation is connected.</span></div></section>}
    </div></>;
}

function GoogleWorkspacePanel({ notify }: { notify: (s: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<"unknown" | "ready" | "setup">("unknown");
  async function checkSetup() { setChecking(true); try { const data = await fetch("/api/v1/google-workspace").then((r) => r.json()); setStatus(data.configured ? "ready" : "setup"); notify(data.configured ? "Google Workspace credentials are configured" : "Google Workspace still needs credentials and Shared Drive details"); } finally { setChecking(false); } }
  return <section className="panel workspace-settings"><div className="settings-heading"><div><p className="eyebrow">Google Workspace foundation</p><h2>Google Workspace</h2><p>One company-owned Shared Drive, two calendars, a mirrored Client Directory sheet, and a dedicated intake mailbox.</p></div><button className="primary-button" onClick={checkSetup} disabled={checking}>{checking ? "Checking…" : "Check setup"}</button></div><div className={`workspace-connection ${status === "ready" ? "ready" : ""}`}><div className="integration-logo google"><Mail size={20} /></div><div><strong>{status === "ready" ? "Google Workspace configured" : "Google Workspace setup required"}</strong><span>Gmail, Drive, Sheets, and Calendar are not connected until company credentials are added.</span></div><span>{status === "ready" ? "Ready" : "Not connected"}</span></div><div className="drive-blueprint"><div><h3>Shared Drive blueprint</h3><p>Groundwork Operations</p></div><ol>{DRIVE_BLUEPRINT.roots.map((item) => <li key={item}>{item}</li>)}</ol><div className="project-folder-list"><strong>Every independent project receives:</strong>{DRIVE_BLUEPRINT.projectFolders.map((item) => <span key={item}><FolderOpen size={13} />{item}</span>)}</div></div><div className="workspace-checklist"><h3>Before you connect</h3><label><input type="checkbox" /> Shared Drive created and owned by the company</label><label><input type="checkbox" /> Google Sheet named “Client Directory” created in that Shared Drive</label><label><input type="checkbox" /> Dedicated intake mailbox selected</label><label><input type="checkbox" /> Google Cloud OAuth app approved by Workspace admin</label><label><input type="checkbox" /> Client Appointments and Field Schedule calendars created</label></div></section>;
}

function LeadModal({ onClose, onSave }: { onClose: () => void; onSave: (l: Lead) => void }) { const [saving, setSaving] = useState(false); function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setSaving(true); const form = new FormData(e.currentTarget); const company = String(form.get("company")); onSave({ id: `L-${1050 + Math.floor(Math.random() * 30)}`, company, contact: String(form.get("contact")), project: String(form.get("project")), value: `$${Number(form.get("value") || 0).toLocaleString()}`, stage: "New inquiry", source: String(form.get("source")), next: "Follow up today", initials: company.split(" ").map((s) => s[0]).slice(0,2).join("").toUpperCase(), color: "sage" }); }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">New opportunity</p><h2>Add a lead</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client company<input name="company" required placeholder="e.g. Hudson Retail Group" /></label><div className="form-row"><label>Primary contact<input name="contact" required placeholder="Full name" /></label><label>Lead source<select name="source"><option>Website</option><option>Referral</option><option>Bid invite</option><option>Repeat client</option></select></label></div><label>Project / opportunity<input name="project" required placeholder="Project name" /></label><div className="form-row"><label>Estimated value<input name="value" type="number" min="0" placeholder="85000" /></label><label>Site city<input name="city" placeholder="City, State" /></label></div><label>Next action<textarea name="notes" placeholder="What needs to happen next?" /></label><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add to pipeline"}</button></footer></form></div></div>;
}

function ClientModal({ onClose, onSave }: { onClose: () => void; onSave: (client: Client) => void }) {
  const [saving, setSaving] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); const name = String(form.get("name")); onSave({ id: crypto.randomUUID(), code: `CL-${String(100 + Math.floor(Math.random() * 900))}`, name, contact: String(form.get("contact")), email: String(form.get("email")), industry: String(form.get("industry")), status: "Active", initials: name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase(), color: "sage", googleStatus: "Setup pending" }); }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Client Directory</p><h2>Add a client</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client business name<input name="name" required placeholder="e.g. Atlas Design Group" /></label><div className="form-row"><label>Primary contact<input name="contact" required placeholder="Full name" /></label><label>Work email<input name="email" type="email" required placeholder="name@company.com" /></label></div><div className="form-row"><label>Industry<select name="industry"><option>General contractor</option><option>Healthcare</option><option>Retail</option><option>Hospitality</option><option>Property management</option><option>Other commercial</option></select></label><label>Client status<select name="status"><option>Active</option><option>Prospect</option><option>Inactive</option></select></label></div><p className="form-help"><FolderTree size={14} /> After Google Workspace is connected, Groundwork will create the client account folder and Client Directory row.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add client"}</button></footer></form></div></div>;
}

function NewProjectModal({ clients, onClose, onSave }: { clients: Client[]; onClose: () => void; onSave: (project: Project) => void }) {
  const [saving, setSaving] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); const clientId = String(form.get("clientId")); const client = clients.find((item) => item.id === clientId); if (!client) return; const name = String(form.get("name")); onSave({ id: crypto.randomUUID(), clientId, number: `CF-2026-${String(50 + Math.floor(Math.random() * 900)).padStart(3, "0")}`, client: client.name, name, status: String(form.get("status")), progress: 0, value: form.get("value") ? `$${Number(form.get("value")).toLocaleString()}` : "TBD", site: String(form.get("site")), lead: String(form.get("manager")), date: "Dates pending", accent: client.color }); }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Independent project</p><h2>Create a project</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client<select name="clientId" required>{clients.map((client) => <option value={client.id} key={client.id}>{client.name} · {client.code}</option>)}</select></label><label>Project name<input name="name" required placeholder="e.g. Westport Medical Center" /></label><div className="form-row"><label>Site<input name="site" required placeholder="City, State" /></label><label>Project manager<input name="manager" required placeholder="Assigned manager" /></label></div><div className="form-row"><label>Status<select name="status"><option>Planning</option><option>Mobilizing</option><option>Installation</option><option>Closeout</option></select></label><label>Estimated value<input name="value" type="number" min="0" placeholder="125000" /></label></div><p className="form-help"><FolderTree size={14} /> This creates a separate project number, project folder tree, schedule, activity history, and email destination.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Creating…" : "Create project"}</button></footer></form></div></div>;
}

function RuleModal({ onClose, onSave }: { onClose: () => void; onSave: (rule: FilingRuleDraft) => void }) {
  const [saving, setSaving] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); onSave({ name: String(form.get("name")), enabled: true, priority: Number(form.get("priority")), matchSummary: String(form.get("matchSummary")), action: String(form.get("action")) as FilingRuleDraft["action"], targetCategory: String(form.get("targetCategory")), approvalRequired: true }); }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">Gmail intake</p><h2>Add an email filing rule</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Rule name<input name="name" required placeholder="e.g. Estimator bid invitations" /></label><div className="form-row"><label>Priority<input name="priority" type="number" min="1" defaultValue="10" required /></label><label>Action<select name="action"><option value="suggest">Suggest a project</option><option value="review">Send to review</option><option value="ignore">Ignore</option></select></label></div><label>When this matches<textarea name="matchSummary" required placeholder="Example: sender is estimator@builder.com and subject contains BID" /></label><label>Default Drive destination<input name="targetCategory" required defaultValue="05_Correspondence / Email Archive" /></label><p className="form-help"><ShieldCheck size={14} /> New rules always require review before Gmail labels, email archives, or attachments are changed.</p><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add rule"}</button></footer></form></div></div>;
}

function ProjectDrawer({ project, onClose, notify }: { project: Project; onClose: () => void; notify: (s: string) => void }) { const [tab, setTab] = useState("Overview"); return <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="project-drawer"><header><button onClick={onClose} aria-label="Close project"><X size={20} /></button><Status text={project.status} /><span>{project.number}</span></header><div className="drawer-title"><p>{project.client}</p><h2>{project.name}</h2><div><span><MapPin size={14} />{project.site}</span><span><CalendarDays size={14} />{project.date}</span></div></div><nav>{["Overview", "Tasks", "Files", "Schedule", "Activity"].map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}</nav><div className="drawer-body">{tab === "Overview" ? <><section className="project-health"><div><span>Overall progress</span><strong>{project.progress}%</strong></div><div className="progress"><i style={{ width: `${project.progress}%` }} /></div><p><CheckCircle2 size={15} /> Project is managed independently from other client work</p></section><div className="drawer-stats"><div><span>Contract value</span><strong>{project.value}</strong></div><div><span>Project manager</span><strong>{project.lead}</strong></div><div><span>Open tasks</span><strong>7</strong></div><div><span>Files</span><strong>38</strong></div></div><section className="next-actions"><h3>Next actions</h3>{["Confirm adhesive delivery", "Send floor prep photos", "Approve phase 2 crew schedule"].map((x, i) => <label key={x}><input type="checkbox" onChange={() => notify(`Completed: ${x}`)} /><span><strong>{x}</strong><small>{i === 0 ? "Due tomorrow" : `Due Jul ${14 + i}`}</small></span></label>)}</section><section className="recent-activity"><h3>Recent activity</h3><div><div className="event-icon"><Mail size={14} /></div><p><strong>Email filed to project</strong><span>Updated dock access plan · 38 min ago</span></p></div><div><div className="event-icon"><Upload size={14} /></div><p><strong>6 site photos uploaded</strong><span>By Carlos Rivera · 2 hours ago</span></p></div><div><div className="event-icon"><Check size={14} /></div><p><strong>Moisture testing completed</strong><span>By Mike Torres · Yesterday</span></p></div></section></> : <EmptyProjectTab tab={tab} notify={notify} />}</div><footer><button className="soft-button" onClick={() => notify("Google Drive folder will open after Workspace setup")}><FolderOpen size={16} /> Drive folder</button><button className="primary-button" onClick={() => notify("Project update composer opened")}><Send size={16} /> Send update</button></footer></aside></div> }

function ClientDrawer({ client, projects, onClose, onNewProject }: { client: Client; projects: Project[]; onClose: () => void; onNewProject: () => void }) { return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="project-drawer client-drawer"><header><button onClick={onClose} aria-label="Close client"><X size={20} /></button><Status text={client.status} /><span>{client.code}</span></header><div className="drawer-title"><p>Client account</p><h2>{client.name}</h2><div><span><ContactRound size={14} />{client.contact}</span><span><Mail size={14} />{client.email || "Contact email pending"}</span></div></div><div className="client-drawer-body"><section className="client-account-card"><div className="directory-badge"><FolderTree size={19} /></div><div><strong>Client account folder</strong><span>Google Shared Drive setup pending</span></div></section><div className="client-summary-grid"><div><span>Industry</span><strong>{client.industry}</strong></div><div><span>Independent projects</span><strong>{projects.length}</strong></div></div><section className="client-project-section"><header><h3>Projects for this client</h3><button onClick={onNewProject}><Plus size={14} /> New project</button></header>{projects.map((project) => <div className="client-project-link" key={project.id}><div><Status text={project.status} /><strong>{project.name}</strong><span>{project.number} · {project.site}</span></div><ChevronRight size={16} /></div>)}{!projects.length && <p className="empty-client-projects">No projects yet. Create the first independent project for this client.</p>}</section><section className="client-account-notes"><h3>Account-level documents</h3><p>Store reusable client documents here: insurance, master service agreements, tax information, and ongoing contacts. Project-specific documents stay inside their own project folders.</p></section></div></aside></div>; }

function EmptyProjectTab({ tab, notify }: { tab: string; notify: (s: string) => void }) { const Icon = tab === "Tasks" ? ListTodo : tab === "Files" ? FolderOpen : tab === "Schedule" ? CalendarDays : Activity; return <div className="empty-tab"><div><Icon size={25} /></div><h3>{tab}</h3><p>{tab === "Files" ? "Project files are synchronized with Google Drive." : `All project ${tab.toLowerCase()} will appear here.`}</p><button className="primary-button" onClick={() => notify(`New ${tab.toLowerCase()} item created`)}><Plus size={16} /> Add {tab === "Activity" ? "note" : tab.slice(0,-1).toLowerCase()}</button></div> }

function Metric({ label, value, note, trend, icon: Icon, color }: { label: string; value: string; note: string; trend: string; icon: typeof Zap; color: string }) { return <article className="metric-card"><div className={`metric-icon ${color}`}><Icon size={19} /></div><div className="metric-top"><span>{label}</span><small>{trend}</small></div><strong>{value}</strong><p>{note}</p></article> }
function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) { return <header className="panel-header"><div><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}</div>{action && <button onClick={onAction}>{action}<ChevronRight size={15} /></button>}</header> }
function PageTitle({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div> }
function Avatar({ initials, color }: { initials: string; color: string }) { return <div className={`mini-avatar ${color}`}>{initials}</div> }
function Status({ text }: { text: string }) { return <span className={`status status-${text.toLowerCase().replaceAll(" ", "-")}`}>{text}</span> }
function MailItem({ sender, subject, project, time }: { sender: string; subject: string; project: string; time: string }) { return <div className="mail-item"><div className="mail-avatar">{sender.split(" ").map(s => s[0]).join("")}</div><div><strong>{sender}</strong><span>{subject}</span><small><FolderOpen size={12} />{project}</small></div><time>{time}</time></div> }
