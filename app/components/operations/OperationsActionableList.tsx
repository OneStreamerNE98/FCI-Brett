import { useId, type ReactNode } from "react";

export function OperationsActionableList({
  ariaLabel,
  columns,
  headerClassName,
  className = "",
  children,
}: {
  ariaLabel: string;
  columns: readonly string[];
  headerClassName: string;
  className?: string;
  children: ReactNode;
}) {
  return <>
    <div className={headerClassName} aria-hidden="true">
      {columns.map((column, index) => <span key={`${index}-${column}`}>{column}</span>)}
    </div>
    <ul className={`operations-actionable-list ${className}`.trim()} aria-label={ariaLabel} role="list">
      {children}
    </ul>
  </>;
}

export function OperationsActionableListItem({
  accessibleName,
  accessibleDescription,
  className,
  onActivate,
  children,
}: {
  accessibleName: string;
  accessibleDescription: string;
  className: string;
  onActivate: (trigger: HTMLButtonElement) => void;
  children: ReactNode;
}) {
  const descriptionId = useId();

  return <li className="operations-actionable-list-item">
    <button
      type="button"
      className={`operations-actionable-row ${className}`}
      aria-label={accessibleName}
      aria-describedby={descriptionId}
      onClick={(event) => onActivate(event.currentTarget)}
    >
      {children}
      <span id={descriptionId} className="sr-only">{accessibleDescription}</span>
    </button>
  </li>;
}
