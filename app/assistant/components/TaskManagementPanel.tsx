"use client";

import {
  ClipboardCheck,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import {
  OperationsEmptyState,
} from "../../components/operations/OperationsPrimitives";
import {
  OperationsActionableList,
  OperationsActionableListItem,
} from "../../components/operations/OperationsActionableList";
import {
  EMPTY_TASK_FILTERS,
  isTaskManagementRecord,
  TASK_MANAGEMENT_PATCH_KEYS,
  taskManagementCreateBody,
  taskManagementDraft,
  taskManagementPatch,
  taskManagementSavedValue,
  taskManagementSearch,
  TASK_MANAGEMENT_RESULT_LIMIT,
  type TaskManagementDraft,
  type TaskManagementFilters,
  type TaskManagementPatchKey,
  type TaskManagementRecord,
} from "../task-management";
import styles from "./TaskManagementPanel.module.css";

type TaskManagementProject = {
  id: string;
  number: string;
  name: string;
};

type TaskEditor =
  | { mode: "create" }
  | { mode: "edit"; task: TaskManagementRecord };

type TaskConflict = {
  current: TaskManagementRecord | null;
};

function projectLabel(
  projects: readonly TaskManagementProject[],
  projectId: string | null,
) {
  if (!projectId) return "No project";
  const project = projects.find((candidate) => candidate.id === projectId);
  return project ? `${project.number} — ${project.name}` : projectId;
}

function taskDate(value: string | null) {
  if (!value) return "No due date";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function TaskField({
  children,
  conflictValue,
  label,
}: {
  children: ReactNode;
  conflictValue?: string;
  label: string;
}) {
  return <label className={styles.field}>
    <span>{label}</span>
    {children}
    {conflictValue !== undefined
      ? <small className={styles.savedValue}>Saved value: {conflictValue}</small>
      : null}
  </label>;
}

function changedKeys(
  current: TaskManagementRecord,
  draft: TaskManagementDraft,
) {
  const patch = taskManagementPatch(current, draft);
  if (!patch) return new Set<TaskManagementPatchKey>();
  return new Set(
    TASK_MANAGEMENT_PATCH_KEYS.filter((key) => Object.hasOwn(patch, key)),
  );
}

export function TaskManagementPanel({
  projects,
}: {
  projects: readonly TaskManagementProject[];
}) {
  const [tasks, setTasks] = useState<TaskManagementRecord[]>([]);
  const [filters, setFilters] = useState<TaskManagementFilters>({ ...EMPTY_TASK_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState<TaskManagementFilters>({
    ...EMPTY_TASK_FILTERS,
  });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [editor, setEditor] = useState<TaskEditor | null>(null);
  const [draft, setDraft] = useState<TaskManagementDraft>(() => taskManagementDraft());
  const [editorError, setEditorError] = useState("");
  const [conflict, setConflict] = useState<TaskConflict | null>(null);
  const [saving, setSaving] = useState(false);
  const requestIdRef = useRef(0);
  const editorReturnFocusRef = useRef<HTMLButtonElement>(null);
  const stableFocusRef = useRef<HTMLButtonElement>(null);

  const loadTasks = useCallback(async (
    nextFilters: TaskManagementFilters,
    showLoading = true,
  ) => {
    const requestId = ++requestIdRef.current;
    if (showLoading) {
      setLoadState("loading");
      setLoadError("");
    }
    try {
      const response = await fetch(`/api/v1/tasks?${taskManagementSearch(nextFilters)}`);
      const data = await response.json().catch(() => ({})) as {
        tasks?: unknown[];
        error?: string;
      };
      if (
        !response.ok
        || !Array.isArray(data.tasks)
        || !data.tasks.every(isTaskManagementRecord)
      ) {
        throw new Error(data.error ?? "Tasks could not be loaded.");
      }
      if (requestId !== requestIdRef.current) return;
      setTasks(data.tasks);
      setLoadState("ready");
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setLoadError(error instanceof Error ? error.message : "Tasks could not be loaded.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadTasks(EMPTY_TASK_FILTERS, false));
  }, [loadTasks]);

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const conflictKeys = useMemo(
    () => conflict?.current
      ? changedKeys(conflict.current, draft)
      : new Set<TaskManagementPatchKey>(),
    [conflict, draft],
  );

  function updateDraft<Key extends keyof TaskManagementDraft>(
    key: Key,
    value: TaskManagementDraft[Key],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setEditorError("");
  }

  function openCreate(trigger: HTMLButtonElement) {
    editorReturnFocusRef.current = trigger;
    setDraft(taskManagementDraft());
    setEditorError("");
    setConflict(null);
    setEditor({ mode: "create" });
  }

  function openEdit(task: TaskManagementRecord, trigger: HTMLButtonElement) {
    editorReturnFocusRef.current = trigger;
    setDraft(taskManagementDraft(task));
    setEditorError("");
    setConflict(null);
    setEditor({ mode: "edit", task });
  }

  function closeEditor() {
    if (saving) return;
    setEditor(null);
    setConflict(null);
    setEditorError("");
  }

  async function readCurrentTask(taskId: string, currentVersion: string) {
    const requestId = ++requestIdRef.current;
    try {
      const response = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
      const data = await response.json().catch(() => ({})) as {
        task?: unknown;
      };
      if (
        !response.ok
        || !isTaskManagementRecord(data.task)
        || data.task.version !== currentVersion
        || requestId !== requestIdRef.current
      ) {
        return null;
      }
      return data.task;
    } catch {
      return null;
    }
  }

  async function saveEditDraft(nextDraft: TaskManagementDraft, success: string) {
    if (!editor || editor.mode !== "edit") return;
    if (conflict && !conflict.current) return;
    const base = conflict?.current ?? editor.task;
    const patch = taskManagementPatch(base, nextDraft);
    setDraft(nextDraft);
    setEditorError("");
    if (!patch) {
      setAnnouncement("No task fields changed.");
      closeEditor();
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/v1/tasks/${encodeURIComponent(editor.task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json().catch(() => ({})) as {
        task?: unknown;
        error?: string;
        currentVersion?: unknown;
      };
      if (response.status === 409) {
        const currentVersion = typeof data.currentVersion === "string"
          ? data.currentVersion
          : "";
        const current = currentVersion
          ? await readCurrentTask(editor.task.id, currentVersion)
          : null;
        if (!current) {
          setConflict({ current: null });
          setEditorError(
            "This task changed, but its latest saved version could not be loaded. Close this editor, refresh the list, then open the task again.",
          );
          return;
        }

        const intendedKeys = new Set(
          TASK_MANAGEMENT_PATCH_KEYS.filter((key) => Object.hasOwn(patch, key)),
        );
        const mergedDraft = taskManagementDraft(current);
        for (const key of intendedKeys) mergedDraft[key] = nextDraft[key] as never;
        setDraft(mergedDraft);
        setConflict({ current });
        setEditorError(
          "This task changed after you opened it. Review each saved value, then re-apply your changes.",
        );
        return;
      }
      if (!response.ok || !isTaskManagementRecord(data.task)) {
        throw new Error(data.error ?? "The task could not be updated.");
      }
      setAnnouncement(success);
      setConflict(null);
      await loadTasks(appliedFilters);
      setEditor(null);
    } catch (error) {
      setEditorError(
        error instanceof Error ? error.message : "The task could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    if (editor.mode === "edit") {
      await saveEditDraft(
        draft,
        conflict ? "Task changes re-applied." : "Task updated.",
      );
      return;
    }

    setSaving(true);
    setEditorError("");
    try {
      const response = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskManagementCreateBody(draft)),
      });
      const data = await response.json().catch(() => ({})) as {
        task?: unknown;
        error?: string;
      };
      if (!response.ok || !isTaskManagementRecord(data.task)) {
        throw new Error(data.error ?? "The task could not be created.");
      }
      setAnnouncement(`Task created: ${data.task.title}`);
      setEditor(null);
      await loadTasks(appliedFilters);
    } catch (error) {
      setEditorError(
        error instanceof Error ? error.message : "The task could not be created.",
      );
    } finally {
      setSaving(false);
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFilters = { ...filters };
    setAppliedFilters(nextFilters);
    void loadTasks(nextFilters);
  }

  function clearFilters() {
    const empty = { ...EMPTY_TASK_FILTERS };
    setFilters(empty);
    setAppliedFilters(empty);
    void loadTasks(empty);
  }

  const taskRows = tasks.map((task) => {
    const project = task.projectId ? projectById.get(task.projectId) : undefined;
    return <OperationsActionableListItem
      key={task.id}
      accessibleName={`Edit task ${task.title}`}
      accessibleDescription={[
        task.status === "done" ? "Done" : "Open",
        task.dueDate ? `due ${task.dueDate}` : "no due date",
        project ? `project ${project.number}` : "no linked project",
      ].join(", ")}
      className={styles.row}
      onActivate={(trigger) => openEdit(task, trigger)}
    >
      <span className={styles.taskIdentity}>
        <strong>{task.title}</strong>
        <small>{task.details || projectLabel(projects, task.projectId)}</small>
      </span>
      <span>{taskDate(task.dueDate)}</span>
      <span>{task.assigneeEmail ?? "Unassigned"}</span>
      <span className={styles.taskStatus} data-status={task.status}>
        {task.status === "done" ? "Done" : "Open"}
      </span>
      <Pencil size={16} aria-hidden="true" />
    </OperationsActionableListItem>;
  });

  return <section className={`panel ${styles.panel}`} aria-labelledby="task-management-title">
    <header className={styles.header}>
      <div>
        <p className="eyebrow">Saved work</p>
        <h2 id="task-management-title">Task management</h2>
        <p>Create, filter, edit, complete, or reopen office tasks.</p>
      </div>
      <button
        ref={stableFocusRef}
        className="primary-button"
        type="button"
        onClick={(event) => openCreate(event.currentTarget)}
      >
        <Plus size={16} aria-hidden="true" /> New task
      </button>
    </header>

    <p className={styles.visuallyHidden} role="status" aria-live="polite">
      {announcement}
    </p>

    <form className={styles.filters} onSubmit={applyFilters} aria-label="Task filters">
      <label>
        Status
        <select
          value={filters.status}
          onChange={(event) => setFilters((current) => ({
            ...current,
            status: event.target.value as TaskManagementFilters["status"],
          }))}
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="done">Done</option>
        </select>
      </label>
      <label>
        Assignee email
        <input
          type="email"
          value={filters.assigneeEmail}
          onChange={(event) => setFilters((current) => ({
            ...current,
            assigneeEmail: event.target.value,
          }))}
          placeholder="Anyone"
        />
      </label>
      <label>
        Due on or before
        <input
          type="date"
          value={filters.dueBefore}
          onChange={(event) => setFilters((current) => ({
            ...current,
            dueBefore: event.target.value,
          }))}
        />
      </label>
      <label>
        Project
        <select
          value={filters.projectId}
          onChange={(event) => setFilters((current) => ({
            ...current,
            projectId: event.target.value,
          }))}
        >
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.number} — {project.name}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.filterActions}>
        <button className="soft-button" type="button" onClick={clearFilters}>
          Clear
        </button>
        <button className="primary-button" type="submit">
          Apply filters
        </button>
      </div>
    </form>

    {loadState === "loading"
      ? <OperationsEmptyState variant="source">
          <RefreshCw className={styles.spinner} size={20} aria-hidden="true" />
          Loading saved tasks…
        </OperationsEmptyState>
      : loadState === "error"
        ? <OperationsEmptyState variant="source" tone="error">
            <span>{loadError}</span>
            <button
              className="soft-button"
              type="button"
              onClick={() => void loadTasks(appliedFilters)}
            >
              Try again
            </button>
          </OperationsEmptyState>
        : tasks.length === 0
          ? <OperationsEmptyState variant="source">
              No tasks match these filters.
            </OperationsEmptyState>
          : <>
              {tasks.length >= TASK_MANAGEMENT_RESULT_LIMIT ? <p className={styles.truncationNotice} role="status">
                Showing the first {TASK_MANAGEMENT_RESULT_LIMIT} tasks. There may be more —
                narrow the filters to see them. Tasks without a due date are listed last, so
                they are the first to fall outside this limit.
              </p> : null}
              <OperationsActionableList
                ariaLabel="Saved tasks"
                columns={["Task", "Due", "Assignee", "Status", ""]}
                headerClassName={styles.listHeader}
                className={styles.list}
              >
                {taskRows}
              </OperationsActionableList>
            </>}

    {editor ? <AccessibleOverlay
      ariaLabel={editor.mode === "create" ? "Create task" : `Edit task ${editor.task.title}`}
      busy={saving}
      contentClassName={`modal ${styles.modal}`}
      fallbackFocusRef={stableFocusRef}
      onClose={closeEditor}
      returnFocusRef={editorReturnFocusRef}
    >
      <header>
        <div>
          <p className="eyebrow">{editor.mode === "create" ? "New saved work" : "Task details"}</p>
          <h2>{editor.mode === "create" ? "Create task" : "Edit task"}</h2>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={closeEditor}
          disabled={saving}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <form onSubmit={(event) => void submitEditor(event)}>
        {editorError
          ? <p className={styles.editorError} role="alert">{editorError}</p>
          : null}

        <fieldset className={styles.formGrid} disabled={saving}>
          <TaskField
            label="Title"
            conflictValue={conflictKeys.has("title")
              ? taskManagementSavedValue(conflict!.current!, "title")
              : undefined}
          >
            <input
              required
              maxLength={200}
              value={draft.title}
              onChange={(event) => updateDraft("title", event.target.value)}
              data-overlay-initial-focus
            />
          </TaskField>
          <TaskField
            label="Status"
            conflictValue={conflictKeys.has("status")
              ? taskManagementSavedValue(conflict!.current!, "status")
              : undefined}
          >
            <select
              value={draft.status}
              onChange={(event) => updateDraft(
                "status",
                event.target.value as TaskManagementDraft["status"],
              )}
            >
              <option value="open">Open</option>
              <option value="done">Done</option>
            </select>
          </TaskField>
          <TaskField
            label="Details"
            conflictValue={conflictKeys.has("details")
              ? taskManagementSavedValue(conflict!.current!, "details")
              : undefined}
          >
            <textarea
              rows={4}
              maxLength={4_000}
              value={draft.details}
              onChange={(event) => updateDraft("details", event.target.value)}
            />
          </TaskField>
          <TaskField
            label="Due date"
            conflictValue={conflictKeys.has("dueDate")
              ? taskManagementSavedValue(conflict!.current!, "dueDate")
              : undefined}
          >
            <input
              type="date"
              value={draft.dueDate}
              onChange={(event) => updateDraft("dueDate", event.target.value)}
            />
          </TaskField>
          <TaskField
            label="Project"
            conflictValue={conflictKeys.has("projectId")
              ? taskManagementSavedValue(conflict!.current!, "projectId")
              : undefined}
          >
            <select
              value={draft.projectId}
              onChange={(event) => updateDraft("projectId", event.target.value)}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.number} — {project.name}
                </option>
              ))}
            </select>
          </TaskField>
          <TaskField
            label="Lead ID"
            conflictValue={conflictKeys.has("leadId")
              ? taskManagementSavedValue(conflict!.current!, "leadId")
              : undefined}
          >
            <input
              maxLength={128}
              value={draft.leadId}
              onChange={(event) => updateDraft("leadId", event.target.value)}
              placeholder="Optional"
            />
          </TaskField>
          <TaskField
            label="Assignee email"
            conflictValue={conflictKeys.has("assigneeEmail")
              ? taskManagementSavedValue(conflict!.current!, "assigneeEmail")
              : undefined}
          >
            <input
              type="email"
              maxLength={254}
              value={draft.assigneeEmail}
              onChange={(event) => updateDraft("assigneeEmail", event.target.value)}
              placeholder="Unassigned"
            />
          </TaskField>
        </fieldset>

        <footer className={`modal-footer ${styles.footer}`}>
          {editor.mode === "edit" && editor.task.status === "done" && !conflict
            ? <button
                className="soft-button"
                type="button"
                disabled={saving}
                onClick={() => void saveEditDraft(
                  { ...draft, status: "open" },
                  "Task reopened.",
                )}
              >
                <RotateCcw size={16} aria-hidden="true" /> Reopen task
              </button>
            : <span />}
          <div>
            <button className="soft-button" type="button" onClick={closeEditor} disabled={saving}>
              Cancel
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={saving || Boolean(conflict && !conflict.current)}
            >
              {saving
                ? <><span className="spinner" /> Saving…</>
                : conflict && !conflict.current
                  ? "Refresh list to continue"
                : conflict
                  ? <><RefreshCw size={16} aria-hidden="true" /> Re-apply changes</>
                  : editor.mode === "create"
                    ? <><Plus size={16} aria-hidden="true" /> Create task</>
                    : <><ClipboardCheck size={16} aria-hidden="true" /> Save changes</>}
            </button>
          </div>
        </footer>
      </form>
    </AccessibleOverlay> : null}
  </section>;
}
