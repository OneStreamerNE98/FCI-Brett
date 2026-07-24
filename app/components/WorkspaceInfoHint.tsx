"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import {
  resolveInfoHintAnchor,
  type InfoHintAnchor,
  type ResolvedInfoHintAnchor,
} from "./info-hint-anchor";
import styles from "./WorkspaceInfoHint.module.css";

export type WorkspaceInfoHintProps = Readonly<{
  label: string;
  text: string;
  anchor?: InfoHintAnchor;
}>;

export function WorkspaceInfoHint({
  label,
  text,
  anchor = "right",
}: WorkspaceInfoHintProps) {
  const descriptionId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pointerInteraction = useRef({ type: "", open: false });
  const [automaticAnchor, setAutomaticAnchor] = useState<ResolvedInfoHintAnchor>("right");
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [tapped, setTapped] = useState(false);
  const open = keyboardFocused || hovered || tapped;
  const resolvedAnchor = anchor === "auto" ? automaticAnchor : anchor;

  const resolveAutomaticAnchor = () => {
    if (anchor !== "auto" || !triggerRef.current) return;
    setAutomaticAnchor(resolveInfoHintAnchor(
      anchor,
      triggerRef.current.getBoundingClientRect(),
      window.innerWidth,
    ));
  };

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

  useEffect(() => {
    if (!open || anchor !== "auto") return;
    const updateAnchor = () => {
      if (!triggerRef.current) return;
      setAutomaticAnchor(resolveInfoHintAnchor(
        anchor,
        triggerRef.current.getBoundingClientRect(),
        window.innerWidth,
      ));
    };
    window.addEventListener("resize", updateAnchor);
    return () => window.removeEventListener("resize", updateAnchor);
  }, [anchor, open]);

  return <span
    className={`info-hint${resolvedAnchor === "left" ? " info-hint-anchor-left" : ""}${open ? " open" : ""}`}
    onFocusCapture={() => {
      if (pointerInteraction.current.type !== "touch") {
        resolveAutomaticAnchor();
        setKeyboardFocused(true);
      }
    }}
    onBlurCapture={(event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setKeyboardFocused(false);
      setTapped(false);
      pointerInteraction.current = { type: "", open: false };
    }}
    onPointerEnter={(event) => {
      if (event.pointerType === "mouse") {
        resolveAutomaticAnchor();
        setHovered(true);
      }
    }}
    onPointerLeave={(event) => {
      if (event.pointerType === "mouse") setHovered(false);
    }}
  >
    <button
      ref={triggerRef}
      type="button"
      className={`info-hint-trigger ${styles.trigger}`}
      aria-label={label}
      aria-describedby={descriptionId}
      aria-expanded={open}
      onPointerDown={(event) => {
        resolveAutomaticAnchor();
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
    <span id={descriptionId} className="info-hint-tooltip" role="tooltip">{text}</span>
  </span>;
}
