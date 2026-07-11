"use client";

import { FormEvent, useState } from "react";
import {
  Activity, Bell, Bot, BriefcaseBusiness, Building2, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, CircleAlert, Clock3, FileText, FolderOpen, HardHat,
  Inbox, LayoutDashboard, ListTodo, Mail, MapPin, Menu, MessageSquareText, MoreHorizontal,
  Plus, Search, Send, Settings, Sparkles, Upload, Users, X, Zap,
} from "lucide-react";

type View = "Overview" | "Leads" | "Projects" | "Schedule" | "Inbox" | "AI Assistant" | "Reports" | "Settings";
type Lead = { id: string; company: string; contact: string; project: string; value: string; stage: string; source: string; next: string; initials: string; color: string };

const initialLeads: Lead[] = [
  { id: "L-1048", company: "Hudson Retail Group", contact: "Elena Park", project: "Ridgeway Flagship", value: "$86,500", stage: "New inquiry", source: "Website", next: "Call today", initials: "HR", color: "sage" },
  { id: "L-1046", company: "Northstar Contractors", contact: "Marcus Hill", project: "Harbor Point Offices", value: "$142,000", stage: "Site visit", source: "Referral", next: "Jul 14 · 9:30 AM", initials: "NC", color: "blue" },
  { id: "L-1044", company: "Mason & Reed", contact: "Priya Shah", project: "Fairfield Commons", value: "$64,800", stage: "Proposal", source: "Repeat client", next: "Follow up tomorrow", initials: "MR", color: "amber" },
  { id: "L-1041", company: "Crescent Builders", contact: "Tony Diaz", project: "Willow Creek School", value: "$218,400", stage: "Decision", source: "Bid invite", next: "Decision Jul 18", initials: "CB", color: "violet" },
];

const projects = [
  { number: "CF-2026-041", client: "Atlas Design Group", name: "Westport Medical Center", status: "Installation", progress: 68, value: "$184,250", site: "Westport, CT", lead: "Sarah Kim", date: "Jul 15 – Aug 2", accent: "green" },
  { number: "CF-2026-038", client: "Morgan Construction", name: "One Harbor Plaza", status: "Mobilizing", progress: 42, value: "$296,800", site: "Stamford, CT", lead: "Devin Ross", date: "Jul 22 – Sep 6", accent: "orange" },
  { number: "CF-2026-029", client: "Elm Street Hospitality", name: "The Foundry Hotel", status: "Closeout", progress: 91, value: "$128,600", site: "New Haven, CT", lead: "Sarah Kim", date: "Jun 3 – Jul 19", accent: "blue" },
];

const schedule = [
  { time: "8:30 AM", title: "Site walk · Westport Medical", meta: "Atlas Design Group · Sarah + Mike", type: "appointment", confirmed: "Both confirmed" },
  { time: "10:00 AM", title: "Moisture testing · Harbor Plaza", meta: "Crew Rivera · 3 installers", type: "field", confirmed: "Acknowledged" },
  { time: "1:30 PM", title: "Client scope review", meta: "Hudson Retail Group · Video call", type: "appointment", confirmed: "Client pending" },
  { time: "3:00 PM", title: "Material delivery · Foundry Hotel", meta: "Dock B · Luis Moreno", type: "delivery", confirmed: "Confirmed" },
];

const navItems: { label: View; icon: typeof LayoutDashboard; badge?: string }[] = [
  { label: "Overview", icon: LayoutDashboard }, { label: "Leads", icon: Zap, badge: "4" },
  { label: "Projects", icon: BriefcaseBusiness }, { label: "Schedule", icon: CalendarDays, badge: "2" },
  { label: "Inbox", icon: Inbox, badge: "6" }, { label: "AI Assistant", icon: Sparkles },
  { label: "Reports", icon: Activity }, { label: "Settings", icon: Settings },
];

export function FloorOpsApp({ userName }: { userName: string }) {
  const [view, setView] = useState<View>("Overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [leadModal, setLeadModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState(projects[0]);
  const [projectOpen, setProjectOpen] = useState(false);
  const [leads, setLeads] = useState(initialLeads);
  const [toast, setToast] = useState("");
  const firstName = userName.includes("@") ? "there" : userName.split(" ")[0];

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

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark"><span /><span /><span /></div><div><strong>GROUNDWORK</strong><small>Commercial Operations</small></div></div>
        <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={20} /></button>
        <nav className="main-nav" aria-label="Main navigation">
          <p>Workspace</p>
          {navItems.slice(0, 6).map(({ label, icon: Icon, badge }) => <button key={label} className={view === label ? "active" : ""} onClick={() => { setView(label); setMobileNav(false); }}><Icon size={18} /><span>{label}</span>{badge && <b>{badge}</b>}</button>)}
          <p>Management</p>
          {navItems.slice(6).map(({ label, icon: Icon }) => <button key={label} className={view === label ? "active" : ""} onClick={() => { setView(label); setMobileNav(false); }}><Icon size={18} /><span>{label}</span></button>)}
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
          {view === "Overview" && <Overview firstName={firstName} leads={leads} onView={setView} onProject={(p) => { setSelectedProject(p); setProjectOpen(true); }} notify={notify} />}
          {view === "Leads" && <LeadsView leads={leads} onAdd={() => setLeadModal(true)} notify={notify} />}
          {view === "Projects" && <ProjectsView onProject={(p) => { setSelectedProject(p); setProjectOpen(true); }} />}
          {view === "Schedule" && <ScheduleView notify={notify} />}
          {view === "Inbox" && <InboxView notify={notify} />}
          {view === "AI Assistant" && <AssistantView />}
          {view === "Reports" && <ReportsView />}
          {view === "Settings" && <SettingsView notify={notify} />}
        </div>
      </main>
      {leadModal && <LeadModal onClose={() => setLeadModal(false)} onSave={addLead} />}
      {projectOpen && <ProjectDrawer project={selectedProject} onClose={() => setProjectOpen(false)} notify={notify} />}
      {toast && <div className="toast"><CheckCircle2 size={18} />{toast}</div>}
    </div>
  );
}

function Overview({ firstName, leads, onView, onProject, notify }: { firstName: string; leads: Lead[]; onView: (v: View) => void; onProject: (p: typeof projects[0]) => void; notify: (s: string) => void }) {
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

function ProjectsView({ onProject }: { onProject: (p: typeof projects[0]) => void }) {
  return <><PageTitle eyebrow="Project delivery" title="Active projects" text="Track every project from award through closeout" action={<button className="primary-button"><Plus size={17} /> New project</button>} />
    <div className="filterbar"><div className="tabs"><button className="active">Active <b>8</b></button><button>Planning <b>3</b></button><button>Closeout <b>2</b></button><button>Archived</button></div><button className="soft-button"><ChevronDown size={15} /> All project managers</button></div>
    <div className="projects-table panel"><div className="projects-table-head"><span>Project</span><span>Phase</span><span>Progress</span><span>Schedule</span><span>Value</span><span /></div>{projects.concat([{ ...projects[0], number: "CF-2026-044", name: "Ridgeway Flagship", client: "Hudson Retail Group", status: "Planning", progress: 18, value: "$86,500", site: "White Plains, NY", date: "Aug 8 – Aug 28" }]).map((p) => <button className="projects-table-row" key={p.number} onClick={() => onProject(p)}><div><Avatar initials={p.client.split(" ").map((s) => s[0]).slice(0,2).join("")} color={p.accent} /><span><strong>{p.name}</strong><small>{p.number} · {p.client}</small></span></div><Status text={p.status} /><div><div className="progress compact"><i style={{ width: `${p.progress}%` }} /></div><small>{p.progress}%</small></div><span><strong>{p.date}</strong><small><MapPin size={12} />{p.site}</small></span><strong>{p.value}</strong><ChevronRight size={17} /></button>)}</div>
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

function InboxView({ notify }: { notify: (s: string) => void }) {
  const messages = [
    ["Elena Park", "Ridgeway finish selections", "Attached are the updated LVT and base selections we reviewed…", "Hudson Retail Group", "98%"],
    ["Carlos Rivera", "Photos from Harbor Plaza", "Moisture test photos and readings from this morning are attached.", "CF-2026-038", "96%"],
    ["Morgan Construction", "Updated dock access plan", "Please use the revised loading dock sequence beginning Monday.", "One Harbor Plaza", "91%"],
    ["Priya Shah", "RE: Fairfield Commons proposal", "We have two questions about the alternates in section three…", "Mason & Reed", "84%"],
  ];
  return <><PageTitle eyebrow="Connected Gmail" title="Smart inbox" text="Review suggestions before emails and attachments are filed" action={<button className="soft-button"><Settings size={15} /> Matching rules</button>} />
    <div className="inbox-layout"><section className="panel message-list"><header className="list-toolbar"><label><input type="checkbox" /> Select all</label><button onClick={() => notify("High-confidence emails filed to their project folders")}><Sparkles size={15} /> File high-confidence</button></header>{messages.map((m, i) => <article className="message-row" key={m[1]}><input type="checkbox" aria-label={`Select ${m[1]}`} /><div className={`sender-dot s${i}`}>{m[0].split(" ").map((s) => s[0]).join("")}</div><div className="message-copy"><strong>{m[0]} <span>{i < 2 && "NEW"}</span></strong><h3>{m[1]}</h3><p>{m[2]}</p><div><FolderOpen size={13} /> Suggested: {m[3]} <b>{m[4]} match</b></div></div><div className="message-actions"><span>{i < 3 ? "Today" : "Yesterday"}</span><button onClick={() => notify(`Filed “${m[1]}”`)}><Check size={16} /> Approve</button></div></article>)}</section><aside className="panel inbox-summary"><div className="summary-icon"><Sparkles size={20} /></div><h3>Inbox assistant</h3><p>Groundwork suggests matches. Nothing moves until you approve it.</p><div><span>High confidence</span><strong>3</strong></div><div><span>Needs review</span><strong>3</strong></div><div><span>Filed this week</span><strong>24</strong></div><hr /><small>Gmail connected</small><small>Drive archive connected</small></aside></div>
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

function SettingsView({ notify }: { notify: (s: string) => void }) { const integrations = [["Google Workspace", "Gmail, Calendar & Drive", true], ["Twilio", "SMS & field notifications", false], ["OpenAI", "Project assistant", false]]; return <><PageTitle eyebrow="Administration" title="Workspace settings" text="Manage workflows, integrations, people, and notification rules" /><div className="settings-layout"><aside className="settings-nav panel">{["Company", "People & roles", "Pipeline stages", "Notifications", "Integrations", "Data & security"].map((x, i) => <button className={i === 4 ? "active" : ""} key={x}>{x}<ChevronRight size={15} /></button>)}</aside><section className="panel integrations"><h2>Integrations</h2><p>Connect the services Groundwork uses to organize and communicate.</p>{integrations.map((x) => <div className="integration-row" key={String(x[0])}><div className={`integration-logo ${String(x[0]).split(" ")[0].toLowerCase()}`}>{x[0] === "Google Workspace" ? <Mail size={20} /> : x[0] === "Twilio" ? <MessageSquareText size={20} /> : <Sparkles size={20} />}</div><div><strong>{x[0]}</strong><span>{x[1]}</span></div><span className={x[2] ? "connected" : "not-connected"}>{x[2] ? "Connected" : "Not connected"}</span><button onClick={() => notify(`${x[0]} setup opened`)}>{x[2] ? "Manage" : "Connect"}</button></div>)}</section></div></> }

function LeadModal({ onClose, onSave }: { onClose: () => void; onSave: (l: Lead) => void }) { const [saving, setSaving] = useState(false); function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setSaving(true); const form = new FormData(e.currentTarget); const company = String(form.get("company")); onSave({ id: `L-${1050 + Math.floor(Math.random() * 30)}`, company, contact: String(form.get("contact")), project: String(form.get("project")), value: `$${Number(form.get("value") || 0).toLocaleString()}`, stage: "New inquiry", source: String(form.get("source")), next: "Follow up today", initials: company.split(" ").map((s) => s[0]).slice(0,2).join("").toUpperCase(), color: "sage" }); }
  return <div className="modal-backdrop"><div className="modal"><header><div><p className="eyebrow">New opportunity</p><h2>Add a lead</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><form onSubmit={submit}><label>Client company<input name="company" required placeholder="e.g. Hudson Retail Group" /></label><div className="form-row"><label>Primary contact<input name="contact" required placeholder="Full name" /></label><label>Lead source<select name="source"><option>Website</option><option>Referral</option><option>Bid invite</option><option>Repeat client</option></select></label></div><label>Project / opportunity<input name="project" required placeholder="Project name" /></label><div className="form-row"><label>Estimated value<input name="value" type="number" min="0" placeholder="85000" /></label><label>Site city<input name="city" placeholder="City, State" /></label></div><label>Next action<textarea name="notes" placeholder="What needs to happen next?" /></label><footer><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add to pipeline"}</button></footer></form></div></div>;
}

function ProjectDrawer({ project, onClose, notify }: { project: typeof projects[0]; onClose: () => void; notify: (s: string) => void }) { const [tab, setTab] = useState("Overview"); return <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="project-drawer"><header><button onClick={onClose} aria-label="Close project"><X size={20} /></button><Status text={project.status} /><span>{project.number}</span></header><div className="drawer-title"><p>{project.client}</p><h2>{project.name}</h2><div><span><MapPin size={14} />{project.site}</span><span><CalendarDays size={14} />{project.date}</span></div></div><nav>{["Overview", "Tasks", "Files", "Schedule", "Activity"].map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}</nav><div className="drawer-body">{tab === "Overview" ? <><section className="project-health"><div><span>Overall progress</span><strong>{project.progress}%</strong></div><div className="progress"><i style={{ width: `${project.progress}%` }} /></div><p><CheckCircle2 size={15} /> Project is on track for scheduled completion</p></section><div className="drawer-stats"><div><span>Contract value</span><strong>{project.value}</strong></div><div><span>Project manager</span><strong>{project.lead}</strong></div><div><span>Open tasks</span><strong>7</strong></div><div><span>Files</span><strong>38</strong></div></div><section className="next-actions"><h3>Next actions</h3>{["Confirm adhesive delivery", "Send floor prep photos", "Approve phase 2 crew schedule"].map((x, i) => <label key={x}><input type="checkbox" onChange={() => notify(`Completed: ${x}`)} /><span><strong>{x}</strong><small>{i === 0 ? "Due tomorrow" : `Due Jul ${14 + i}`}</small></span></label>)}</section><section className="recent-activity"><h3>Recent activity</h3><div><div className="event-icon"><Mail size={14} /></div><p><strong>Email filed to project</strong><span>Updated dock access plan · 38 min ago</span></p></div><div><div className="event-icon"><Upload size={14} /></div><p><strong>6 site photos uploaded</strong><span>By Carlos Rivera · 2 hours ago</span></p></div><div><div className="event-icon"><Check size={14} /></div><p><strong>Moisture testing completed</strong><span>By Mike Torres · Yesterday</span></p></div></section></> : <EmptyProjectTab tab={tab} notify={notify} />}</div><footer><button className="soft-button" onClick={() => notify("Google Drive project folder opened")}><FolderOpen size={16} /> Open Drive folder</button><button className="primary-button" onClick={() => notify("Project update composer opened")}><Send size={16} /> Send update</button></footer></aside></div> }

function EmptyProjectTab({ tab, notify }: { tab: string; notify: (s: string) => void }) { const Icon = tab === "Tasks" ? ListTodo : tab === "Files" ? FolderOpen : tab === "Schedule" ? CalendarDays : Activity; return <div className="empty-tab"><div><Icon size={25} /></div><h3>{tab}</h3><p>{tab === "Files" ? "Project files are synchronized with Google Drive." : `All project ${tab.toLowerCase()} will appear here.`}</p><button className="primary-button" onClick={() => notify(`New ${tab.toLowerCase()} item created`)}><Plus size={16} /> Add {tab === "Activity" ? "note" : tab.slice(0,-1).toLowerCase()}</button></div> }

function Metric({ label, value, note, trend, icon: Icon, color }: { label: string; value: string; note: string; trend: string; icon: typeof Zap; color: string }) { return <article className="metric-card"><div className={`metric-icon ${color}`}><Icon size={19} /></div><div className="metric-top"><span>{label}</span><small>{trend}</small></div><strong>{value}</strong><p>{note}</p></article> }
function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) { return <header className="panel-header"><div><h2>{title}</h2>{subtitle && <span>{subtitle}</span>}</div>{action && <button onClick={onAction}>{action}<ChevronRight size={15} /></button>}</header> }
function PageTitle({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div> }
function Avatar({ initials, color }: { initials: string; color: string }) { return <div className={`mini-avatar ${color}`}>{initials}</div> }
function Status({ text }: { text: string }) { return <span className={`status status-${text.toLowerCase().replaceAll(" ", "-")}`}>{text}</span> }
function MailItem({ sender, subject, project, time }: { sender: string; subject: string; project: string; time: string }) { return <div className="mail-item"><div className="mail-avatar">{sender.split(" ").map(s => s[0]).join("")}</div><div><strong>{sender}</strong><span>{subject}</span><small><FolderOpen size={12} />{project}</small></div><time>{time}</time></div> }
