"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import styles from "./WorkspaceInfoHint.module.css";

export type WorkspaceInfoHintProps = Readonly<{
  label: string;
  text: string;
}>;

export function WorkspaceInfoHint({ label, text }: WorkspaceInfoHintProps) {
  const descriptionId = useId();
  const pointerInteraction = useRef({ type: "", open: false });
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [tapped, setTapped] = useState(false);
  const open = keyboardFocused || hovered || tapped;

  useEffect(() => {
    if (!open) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setKeyboardFocused(false);
      setHovered(false);
      setTapped(false);
    };
    document.addEventListener("keydown", dismissOnEscape);
    return () => document.removeEventListener("keydown", dismissOnEscape);
  }, [open]);

  return <span
    className={`workspace-info-hint${open ? " open" : ""}`}
    onFocusCapture={() => {
      if (pointerInteraction.current.type !== "touch") setKeyboardFocused(true);
    }}
    onBlurCapture={(event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setKeyboardFocused(false);
      setTapped(false);
      pointerInteraction.current = { type: "", open: false };
    }}
    onPointerEnter={(event) => {
      if (event.pointerType === "mouse") setHovered(true);
    }}
    onPointerLeave={(event) => {
      if (event.pointerType === "mouse") setHovered(false);
    }}
  >
    <button
      type="button"
      className={`workspace-info-hint-trigger ${styles.trigger}`}
      aria-label={label}
      aria-describedby={descriptionId}
      aria-expanded={open}
      onPointerDown={(event) => {
        pointerInteraction.current = { type: event.pointerType, open };
      }}
      onClick={(event) => {
        if (event.detail === 0) {
          setKeyboardFocused(true);
          return;
        }
        if (pointerInteraction.current.type === "touch") setTapped(!pointerInteraction.current.open);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setKeyboardFocused(false);
        setHovered(false);
        setTapped(false);
      }}
    >
      <Info size={14} aria-hidden="true" />
    </button>
    <span id={descriptionId} className="workspace-info-hint-tooltip" role="tooltip">{text}</span>
  </span>;
}
