import { useId, type ReactNode } from "react";
import type { RecordListSortDirection } from "../../lib/record-list-preferences";

export type OperationsActionableListColumn<SortKey extends string = string> = string | {
  key: SortKey;
  label: string;
};

export function OperationsActionableList({
  ariaLabel,
  columns,
  headerClassName,
  className = "",
  sortKey,
  sortDirection,
  sortDisabled = false,
  onSort,
  children,
}: {
  ariaLabel: string;
  columns: readonly OperationsActionableListColumn[];
  headerClassName: string;
  className?: string;
  sortKey?: string;
  sortDirection?: RecordListSortDirection;
  sortDisabled?: boolean;
  onSort?: (key: string) => void;
  children: ReactNode;
}) {
  const sortable = Boolean(onSort);
  return <>
    <div className={headerClassName} aria-hidden={sortable ? undefined : "true"} role={sortable ? "row" : undefined}>
      {columns.map((column, index) => {
        if (typeof column === "string") return <span key={`${index}-${column}`}>{column}</span>;
        const active = column.key === sortKey;
        return <span
          key={column.key}
          role="columnheader"
          aria-sort={active ? sortDirection : "none"}
        ><button type="button" className="operations-sort-header" disabled={sortDisabled} onClick={() => onSort?.(column.key)}>{column.label}<span aria-hidden="true">{active ? sortDirection === "ascending" ? "↑" : "↓" : "↕"}</span></button></span>;
      })}
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
