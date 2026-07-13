"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";
import { tabBoundaryTarget } from "./overlay-focus";

type AccessibleOverlayProps = {
  ariaLabel: string;
  backdropClassName?: string;
  busy?: boolean;
  children: ReactNode;
  closeOnBackdrop?: boolean;
  contentClassName: string;
  onClose: () => void;
  variant?: "modal" | "drawer";
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const overlayStack: symbol[] = [];
let bodyLockCount = 0;
let bodyOverflowBeforeLock = "";

function lockBodyScroll() {
  if (bodyLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;

  return () => {
    bodyLockCount = Math.max(0, bodyLockCount - 1);
    if (bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeLock;
  };
}

function focusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => (
    !element.hidden
    && element.getAttribute("aria-hidden") !== "true"
    && !element.closest("[inert]")
  ));
}

export function AccessibleOverlay({
  ariaLabel,
  backdropClassName = "",
  busy = false,
  children,
  closeOnBackdrop = true,
  contentClassName,
  onClose,
  variant = "modal",
}: AccessibleOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef(Symbol("accessible-overlay"));
  const busyRef = useRef(busy);
  const closeOnBackdropRef = useRef(closeOnBackdrop);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    busyRef.current = busy;
    closeOnBackdropRef.current = closeOnBackdrop;
    onCloseRef.current = onClose;
  }, [busy, closeOnBackdrop, onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const token = tokenRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlayStack.push(token);
    const unlockBodyScroll = lockBodyScroll();

    const focusFrame = window.requestAnimationFrame(() => {
      const focusable = focusableElements(panel);
      const preferredTarget = panel.querySelector<HTMLElement>("[data-overlay-initial-focus]");
      const initialTarget = preferredTarget && focusable.includes(preferredTarget)
        ? preferredTarget
        : focusable[0] ?? panel;
      initialTarget.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (overlayStack[overlayStack.length - 1] !== token) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = focusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = tabBoundaryTarget(activeElement, focusable, event.shiftKey, Boolean(activeElement && panel.contains(activeElement)));
      if (target) {
        event.preventDefault();
        target.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      const stackIndex = overlayStack.lastIndexOf(token);
      if (stackIndex >= 0) overlayStack.splice(stackIndex, 1);
      unlockBodyScroll();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (overlayStack[overlayStack.length - 1] !== tokenRef.current) return;
    if (!closeOnBackdropRef.current || busyRef.current) return;
    onCloseRef.current();
  }

  const baseBackdropClass = variant === "drawer" ? "drawer-backdrop" : "modal-backdrop";
  return <div className={`${baseBackdropClass} accessible-overlay-backdrop ${backdropClassName}`.trim()} role="presentation" onMouseDown={closeFromBackdrop}>
    <div
      ref={panelRef}
      className={`${contentClassName} accessible-overlay-panel`}
      role="dialog"
      aria-label={ariaLabel}
      aria-modal="true"
      aria-busy={busy || undefined}
      tabIndex={-1}
    >
      {children}
    </div>
  </div>;
}
