"use client";

import { useId, type ButtonHTMLAttributes } from "react";
import { ShieldCheck } from "lucide-react";

type AdministratorActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isAdmin: boolean;
};

export function AdministratorActionButton({ isAdmin, disabled, children, ...buttonProps }: AdministratorActionButtonProps) {
  const noteId = useId();
  const describedBy = [buttonProps["aria-describedby"], !isAdmin ? noteId : undefined].filter(Boolean).join(" ") || undefined;

  return <span className={`administrator-action-control${isAdmin ? "" : " blocked"}`}>
    <button {...buttonProps} disabled={!isAdmin || disabled} aria-describedby={describedBy}>{children}</button>
    {!isAdmin && <span id={noteId} className="administrator-action-note" role="note"><ShieldCheck size={13} aria-hidden="true" /><span><strong>Administrator action</strong><small>Available to administrators only.</small></span></span>}
  </span>;
}
