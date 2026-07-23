"use client";

import { type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, GripVertical, Plus, RotateCcw, Settings2, X } from "lucide-react";
import {
  defaultPageLayout,
  pageLayoutSectionCatalog,
  type PageLayout,
  type PageLayoutPage,
  type PageLayoutSectionKey,
} from "../../lib/page-layouts";
import styles from "./PageLayoutEditor.module.css";

type PageLayoutEditorContext = {
  layout: PageLayout;
  editing: boolean;
  editButton: ReactNode;
  editor: ReactNode;
  endDropZone: ReactNode;
  section: (key: PageLayoutSectionKey, content: ReactNode) => ReactNode;
};

type PageLayoutEditorProps = {
  page: PageLayoutPage;
  layout: PageLayout;
  isAdmin: boolean;
  enabled: boolean;
  loadError?: string;
  onRetry?: () => void;
  onSave: (layout: PageLayout) => Promise<void>;
  children: (context: PageLayoutEditorContext) => ReactNode;
};

function pageLabel(page: PageLayoutPage) {
  return page === "overview" ? "Overview" : "Reports";
}

function swapSection(order: PageLayoutSectionKey[], key: PageLayoutSectionKey, neighbor: PageLayoutSectionKey) {
  const next = [...order];
  const index = next.indexOf(key);
  const neighborIndex = next.indexOf(neighbor);
  if (index < 0 || neighborIndex < 0) return next;
  [next[index], next[neighborIndex]] = [next[neighborIndex], next[index]];
  return next;
}

export function PageLayoutEditor({ page, layout, isAdmin, enabled, loadError, onRetry, onSave, children }: PageLayoutEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PageLayout>(layout);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const draggedKeyRef = useRef<PageLayoutSectionKey | null>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const addButtonRefs = useRef(new Map<PageLayoutSectionKey, HTMLButtonElement>());
  const sectionPrimaryButtonRefs = useRef(new Map<PageLayoutSectionKey, HTMLButtonElement>());
  const pendingFocusRef = useRef<
    | { target: "edit" }
    | { target: "add" | "section"; key: PageLayoutSectionKey }
    | null
  >(null);
  const catalog = pageLayoutSectionCatalog(page, isAdmin);
  const labels = new Map(catalog.map((entry) => [entry.key, entry.label]));
  const activeLayout = editing ? draft : layout;
  const visibleKeys = activeLayout.order.filter((key) => !activeLayout.hidden.includes(key));
  const hiddenKeys = activeLayout.order.filter((key) => activeLayout.hidden.includes(key));
  const title = pageLabel(page);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const target = pending.target === "edit"
      ? editButtonRef.current
      : pending.target === "add"
        ? addButtonRefs.current.get(pending.key)
        : sectionPrimaryButtonRefs.current.get(pending.key);
    if (!target) return;
    target.focus();
    pendingFocusRef.current = null;
  });

  function beginEditing() {
    setDraft(layout);
    setError("");
    setEditing(true);
  }

  function hideSection(key: PageLayoutSectionKey) {
    pendingFocusRef.current = { target: "add", key };
    setDraft((current) => current.hidden.includes(key) ? current : { ...current, hidden: [...current.hidden, key] });
  }

  function addSection(key: PageLayoutSectionKey) {
    pendingFocusRef.current = { target: "section", key };
    setDraft((current) => ({ ...current, hidden: current.hidden.filter((hiddenKey) => hiddenKey !== key) }));
  }

  function moveSection(key: PageLayoutSectionKey, direction: -1 | 1) {
    setDraft((current) => {
      const currentVisible = current.order.filter((sectionKey) => !current.hidden.includes(sectionKey));
      const visibleIndex = currentVisible.indexOf(key);
      const neighbor = currentVisible[visibleIndex + direction];
      return neighbor ? { ...current, order: swapSection(current.order, key, neighbor) } : current;
    });
  }

  function dropRelativeTo(targetKey: PageLayoutSectionKey, afterTarget: boolean, droppedKey?: PageLayoutSectionKey) {
    const draggedKey = droppedKey ?? draggedKeyRef.current;
    if (!draggedKey || draggedKey === targetKey) return;
    setDraft((current) => {
      const next = current.order.filter((key) => key !== draggedKey);
      const targetIndex = next.indexOf(targetKey);
      const insertionIndex = targetIndex < 0 ? next.length : targetIndex + (afterTarget ? 1 : 0);
      next.splice(insertionIndex, 0, draggedKey);
      return { ...current, order: next };
    });
    draggedKeyRef.current = null;
  }

  function dropAtEnd(droppedKey?: PageLayoutSectionKey) {
    const draggedKey = droppedKey ?? draggedKeyRef.current;
    if (!draggedKey) return;
    setDraft((current) => ({ ...current, order: [...current.order.filter((key) => key !== draggedKey), draggedKey] }));
    draggedKeyRef.current = null;
  }

  async function finishEditing() {
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      pendingFocusRef.current = { target: "edit" };
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `The ${title} layout could not be saved.`);
    } finally {
      setSaving(false);
    }
  }

  const editButton = loadError && !enabled
    ? <button ref={editButtonRef} type="button" className="soft-button" onClick={onRetry} aria-label={`Retry ${title} layout`} title={loadError}>
      <RotateCcw size={16} aria-hidden="true" /> Retry layout
    </button>
    : <button ref={editButtonRef} type="button" className={`soft-button ${styles.editButton}`} onClick={beginEditing} disabled={!enabled || editing} aria-label={`Edit ${title} layout`} title={`Edit ${title} layout`}>
      <Settings2 size={16} aria-hidden="true" />
    </button>;

  const editor = editing ? <section className={styles.editor} aria-label={`${title} layout editor`}>
    <div className={styles.editorHeading}>
      <div><strong>Edit {title} layout</strong><span>Drag sections or use Move up and Move down. Hiding changes presentation only.</span></div>
      <div className={styles.editorActions}>
        <button type="button" className="soft-button" onClick={() => setDraft(defaultPageLayout(page, isAdmin))} disabled={saving}><RotateCcw size={15} aria-hidden="true" /> Reset to default</button>
        <button type="button" className="primary-button" onClick={() => void finishEditing()} disabled={saving}><Check size={15} aria-hidden="true" /> {saving ? "Saving…" : "Done"}</button>
      </div>
    </div>
    {hiddenKeys.length > 0 ? <div className={styles.addRow} data-layout-add-section="true">
      <strong>Hidden sections</strong>
      <div>{hiddenKeys.map((key) => <button
        type="button"
        key={key}
        data-layout-add-key={key}
        ref={(node) => { if (node) addButtonRefs.current.set(key, node); else addButtonRefs.current.delete(key); }}
        onClick={() => addSection(key)}
        disabled={saving}
      ><Plus size={14} aria-hidden="true" /> {labels.get(key)}</button>)}</div>
    </div> : null}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section> : null;

  function section(key: PageLayoutSectionKey, content: ReactNode) {
    if (!editing) return content;
    const index = visibleKeys.indexOf(key);
    return <div
      className={styles.editableSection}
      data-layout-section={key}
      data-layout-drop-section={key}
      key={key}
      onDragOver={(event) => { if (!saving) event.preventDefault(); }}
      onDrop={(event) => {
        event.preventDefault();
        if (saving) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        dropRelativeTo(key, event.clientY > bounds.top + bounds.height * .65, (event.dataTransfer.getData("text/plain") || undefined) as PageLayoutSectionKey | undefined);
      }}
    >
      <div className={styles.sectionControls}>
        <span
          className={styles.dragHandle}
          draggable={!saving}
          data-layout-drag-handle={key}
          title={`Drag ${labels.get(key)}`}
          onDragStart={(event: DragEvent<HTMLSpanElement>) => { if (saving) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", key); draggedKeyRef.current = key; }}
          onDragEnd={() => window.requestAnimationFrame(() => { draggedKeyRef.current = null; })}
        ><GripVertical size={17} aria-hidden="true" /></span>
        <strong>{labels.get(key)}</strong>
        <span className={styles.keyboardControls}>
          <button type="button" onClick={() => moveSection(key, -1)} disabled={saving || index <= 0} aria-label={`Move ${labels.get(key)} up`}><ArrowUp size={14} aria-hidden="true" /> Move up</button>
          <button type="button" onClick={() => moveSection(key, 1)} disabled={saving || index < 0 || index >= visibleKeys.length - 1} aria-label={`Move ${labels.get(key)} down`}><ArrowDown size={14} aria-hidden="true" /> Move down</button>
          <button
            type="button"
            ref={(node) => { if (node) sectionPrimaryButtonRefs.current.set(key, node); else sectionPrimaryButtonRefs.current.delete(key); }}
            onClick={() => hideSection(key)}
            disabled={saving}
            aria-label={`Hide ${labels.get(key)}`}
          ><X size={14} aria-hidden="true" /> Hide</button>
        </span>
      </div>
      {content}
    </div>;
  }

  const endDropZone = editing ? <div
    className={styles.endDropZone}
    data-layout-drop-end={page}
    onDragOver={(event) => { if (!saving) event.preventDefault(); }}
    onDrop={(event) => { event.preventDefault(); if (!saving) dropAtEnd((event.dataTransfer.getData("text/plain") || undefined) as PageLayoutSectionKey | undefined); }}
  ><GripVertical size={16} aria-hidden="true" /> Drop section at end</div> : null;

  return children({ layout: activeLayout, editing, editButton, editor, endDropZone, section });
}
