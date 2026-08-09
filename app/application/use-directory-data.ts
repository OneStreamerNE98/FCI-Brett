"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { optionalFlooringCategory, projectManagerLabel } from "../projects/components/ProjectModals";
import { cachedGetJson, invalidateCachedGet, isTerminalCachedGetError } from "../lib/client-get-cache";
import { useCachedGetSubscription } from "../lib/client-get-hooks";
import { displayStatus, money, recordInitials } from "../lib/record-display";
import { normalizeJobSiteLocation } from "../features/maps/job-site-map";
import { normalizeRecordVersion } from "../domain/record-version";
import { resolveProjectSegment } from "../domain/project-segment";
import { localDayRolloverDelay } from "./today-project-meetings";
import type { FilingRuleDraft } from "../lib/google-workspace";
import type { SheetMirrorStatus } from "../lib/sheet-mirror-status";
import type { Client, DashboardSummary, Lead, LiveDataState, Project } from "../lib/record-types";

const DIRECTORY_GET_URLS = [
  "/api/v1/filing-rules",
  "/api/v1/integrations/google/sheets/status",
  "/api/v1/leads",
  "/api/v1/clients",
  "/api/v1/projects",
  "/api/v1/dashboard",
] as const;

export function optionalRecordNumber(value: unknown) {
  const number = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalRecordText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mapLeadRecord(record: Record<string, unknown>): Lead {
  const estimatedValue = Number(record.estimatedValue ?? 0);
  const company = String(record.company ?? "");
  return {
    id: String(record.id), number: String(record.leadNumber ?? "Lead"), company,
    contact: String(record.contactName ?? ""), contactEmail: optionalRecordText(record.contactEmail),
    contactPhone: optionalRecordText(record.contactPhone), project: String(record.projectName ?? ""),
    value: money(estimatedValue), estimatedValue, stage: String(record.stage ?? ""), source: String(record.source ?? ""),
    next: String(record.nextAction ?? ""), nextActionAt: optionalRecordText(record.nextActionAt),
    ownerEmail: optionalRecordText(record.ownerEmail), site: String(record.site ?? ""),
    status: String(record.status ?? "active"), initials: recordInitials(company), color: "sage",
    createdAt: optionalRecordNumber(record.createdAt), updatedAt: optionalRecordNumber(record.updatedAt),
    version: normalizeRecordVersion(record.version) ?? undefined,
  };
}

function mapClientRecord(record: Record<string, unknown>): Client {
  const name = String(record.name ?? "");
  const industryRaw = optionalRecordText(record.industry);
  const contactId = optionalRecordText(record.primary_contact_id);
  return {
    id: String(record.id), code: String(record.client_code), name,
    contact: String(record.primary_contact_name ?? "Primary contact pending"), contactId: contactId ?? undefined,
    contactPhone: optionalRecordText(record.primary_contact_phone), contactRole: String(record.primary_contact_role ?? "Primary contact"),
    contactVersion: normalizeRecordVersion(record.primary_contact_version) ?? undefined,
    email: String(record.primary_contact_email ?? ""), industry: industryRaw ?? "Commercial", industryRaw,
    status: displayStatus(record.status, "Active"), initials: recordInitials(name), color: "sage",
    googleStatus: record.drive_folder_id ? "Ready" : "Setup pending",
    jobSite: normalizeJobSiteLocation({ address: record.site_address ?? record.address, latitude: record.latitude, longitude: record.longitude }),
    version: normalizeRecordVersion(record.version) ?? undefined,
    driveFolderId: record.drive_folder_id ? String(record.drive_folder_id) : undefined,
    driveUrl: record.drive_url ? String(record.drive_url) : undefined,
  };
}

export function optionalProjectTimestamp(value: unknown) {
  const timestamp = optionalRecordNumber(value);
  return timestamp !== null && Number.isSafeInteger(timestamp) && timestamp >= 0 && !Number.isNaN(new Date(timestamp).getTime()) ? timestamp : null;
}

export function invalidateDirectoryGets() {
  for (const url of DIRECTORY_GET_URLS) invalidateCachedGet(url);
}

export function useDirectoryData({ displayTimezone, userEmail, userName, onTerminalFailure }: { displayTimezone: string; userEmail: string; userName: string; onTerminalFailure: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projectItems, setProjectItems] = useState<Project[]>([]);
  const [filingRules, setFilingRules] = useState<FilingRuleDraft[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [liveDataState, setLiveDataState] = useState<LiveDataState>("loading");
  const [liveDataError, setLiveDataError] = useState("");
  const [sheetMirror, setSheetMirror] = useState<SheetMirrorStatus | null>(null);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const directoryLoadIdRef = useRef(0);
  const directoryVisibleLoadsInFlightRef = useRef(0);
  const dashboardRefreshLoadIdRef = useRef(0);
  const dashboardAppliedLoadIdRef = useRef(0);
  const dashboardTimezoneRef = useRef(displayTimezone);

  const refreshDirectoryData = useCallback((silent = false, force = false) => {
    if (silent && directoryVisibleLoadsInFlightRef.current > 0) return Promise.resolve();
    if (!silent) directoryVisibleLoadsInFlightRef.current += 1;
    const directoryLoadId = ++directoryLoadIdRef.current;
    const dashboardLoadId = ++dashboardRefreshLoadIdRef.current;
    const getJson = (path: string) => cachedGetJson<Record<string, unknown>>(path, { force });
    const optionalRequests = Promise.allSettled([getJson("/api/v1/filing-rules"), getJson("/api/v1/integrations/google/sheets/status")]);
    const directoryRequests = Promise.all([getJson("/api/v1/leads"), getJson("/api/v1/clients"), getJson("/api/v1/projects"), getJson("/api/v1/dashboard")]);
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
      const nextProjects = projectRows.map((project): Project => {
        const managerId = typeof project.project_manager_id === "string" && project.project_manager_id.trim() ? project.project_manager_id.trim().toLowerCase() : null;
        const estimatedValue = optionalRecordNumber(project.estimated_value);
        const squareFeet = optionalRecordNumber(project.square_feet);
        const contractValue = optionalRecordNumber(project.contract_value);
        const jobSite = normalizeJobSiteLocation({ address: project.site, latitude: project.latitude, longitude: project.longitude });
        return {
          id: String(project.id), clientId: String(project.client_id), number: String(project.project_number), client: String(project.client_name),
          name: String(project.name), status: displayStatus(project.status, "Planning"), progress: 0,
          value: estimatedValue === null ? "TBD" : money(estimatedValue), estimatedValue,
          flooringCategory: optionalFlooringCategory(project.flooring_category),
          squareFeet: squareFeet !== null && Number.isSafeInteger(squareFeet) && squareFeet > 0 ? squareFeet : null,
          contractValue: contractValue !== null && Number.isSafeInteger(contractValue) && contractValue >= 0 ? contractValue : null,
          segment: resolveProjectSegment(project.segment), installationStartedAt: optionalProjectTimestamp(project.installation_started_at),
          installationCompletedAt: optionalProjectTimestamp(project.installation_completed_at),
          hadCallback: project.had_callback === true || project.had_callback === 1,
          callbackNote: typeof project.callback_note === "string" && project.callback_note.trim() ? project.callback_note.trim() : null,
          site: jobSite?.address ?? "Site pending", jobSite, managerId, lead: projectManagerLabel(managerId, userEmail, userName),
          date: "Not scheduled", accent: "sage", createdAt: optionalRecordNumber(project.created_at), updatedAt: optionalRecordNumber(project.updated_at),
          version: normalizeRecordVersion(project.version) ?? undefined,
          driveFolderId: project.drive_folder_id ? String(project.drive_folder_id) : undefined,
          driveUrl: project.drive_url ? String(project.drive_url) : undefined,
        };
      });
      setLeads(nextLeads);
      setClients(nextClients);
      setProjectItems(nextProjects);
      setSelectedLeadId((current) => current && nextLeads.some(({ id }) => id === current) ? current : null);
      setSelectedClient((current) => current ? nextClients.find(({ id }) => id === current.id) ?? null : null);
      setSelectedProject((current) => current ? nextProjects.find(({ id }) => id === current.id) ?? null : null);
      if (dashboardLoadId > dashboardAppliedLoadIdRef.current) {
        dashboardAppliedLoadIdRef.current = dashboardLoadId;
        setDashboard(dashboardData as unknown as DashboardSummary);
      }
      setLiveDataState("ready");
      void optionalRequests.then(([ruleResult, mirrorResult]) => {
        if (directoryLoadId !== directoryLoadIdRef.current) return;
        if (ruleResult.status === "fulfilled") {
          const rows = Array.isArray(ruleResult.value.rules) ? ruleResult.value.rules as Record<string, unknown>[] : [];
          setFilingRules(rows.filter((rule) => rule && typeof rule === "object").map((rule) => ({ id: rule.id ? String(rule.id) : undefined, name: String(rule.name), enabled: Boolean(rule.enabled), priority: Number(rule.priority), matchSummary: String(rule.matchSummary ?? rule.match_summary), action: String(rule.action) as FilingRuleDraft["action"], targetCategory: String(rule.targetCategory ?? rule.target_category), approvalRequired: Boolean(rule.approvalRequired ?? rule.approval_required) })));
        }
        if (mirrorResult.status === "fulfilled") setSheetMirror(mirrorResult.value.mirror ? mirrorResult.value.mirror as SheetMirrorStatus : null);
      }).catch(() => {});
    }).catch((error) => {
      if (directoryLoadId !== directoryLoadIdRef.current) return;
      if (!silent || isTerminalCachedGetError(error)) {
        if (isTerminalCachedGetError(error)) {
          setLeads([]); setClients([]); setProjectItems([]); setDashboard(null);
          setSelectedLeadId(null); setSelectedClient(null); setSelectedProject(null);
          onTerminalFailure();
        }
        setLiveDataState("error");
        setLiveDataError(error instanceof Error ? error.message : "Live application data could not be loaded.");
      }
    }).finally(() => {
      if (!silent) directoryVisibleLoadsInFlightRef.current -= 1;
    });
  }, [onTerminalFailure, userEmail, userName]);

  const refreshDashboardSnapshot = useCallback(async () => {
    const loadId = ++dashboardRefreshLoadIdRef.current;
    const data = await cachedGetJson<Record<string, unknown>>("/api/v1/dashboard", { force: true });
    if (loadId > dashboardAppliedLoadIdRef.current) {
      dashboardAppliedLoadIdRef.current = loadId;
      setDashboard(data as unknown as DashboardSummary);
    }
  }, []);

  useEffect(() => { void refreshDirectoryData(); }, [refreshDirectoryData]);
  useCachedGetSubscription(DIRECTORY_GET_URLS, () => refreshDirectoryData(true));

  useEffect(() => {
    const previousTimeZone = dashboardTimezoneRef.current;
    dashboardTimezoneRef.current = displayTimezone;
    if (previousTimeZone === displayTimezone) return;
    void refreshDashboardSnapshot().catch(() => {});
  }, [displayTimezone, refreshDashboardSnapshot]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    const schedule = () => {
      if (cancelled) return;
      timeoutId = window.setTimeout(() => { void refreshDashboardSnapshot().catch(() => {}).finally(schedule); }, localDayRolloverDelay(Date.now(), displayTimezone));
    };
    schedule();
    return () => { cancelled = true; if (timeoutId !== null) window.clearTimeout(timeoutId); };
  }, [displayTimezone, refreshDashboardSnapshot]);

  return {
    leads, clients, projectItems, filingRules, dashboard, liveDataState, liveDataError, sheetMirror, sheetSyncing,
    selectedLeadId, selectedProject, selectedClient,
    refreshDashboardSnapshot, refreshDirectoryData,
    setClients, setDashboard, setFilingRules, setLeads, setProjectItems, setSheetMirror, setSheetSyncing,
    setSelectedLeadId, setSelectedProject, setSelectedClient,
  };
}
