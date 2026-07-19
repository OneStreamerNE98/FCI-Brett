import type { ReactNode } from "react";

export type OperationsDataTableColumn = {
  key: string;
  label: string;
  className?: string;
};

export function OperationsDataTable({
  columns,
  children,
  labelledBy,
  className,
}: {
  columns: readonly OperationsDataTableColumn[];
  children: ReactNode;
  labelledBy: string;
  className?: string;
}) {
  const wrapperClassName = ["operations-data-table", className].filter(Boolean).join(" ");

  return <div className={wrapperClassName}>
    <div className="operations-data-table-frame">
      <table aria-labelledby={labelledBy}>
        <thead>
          <tr>{columns.map((column) => <th className={column.className} key={column.key} scope="col">{column.label}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  </div>;
}

export function OperationsDataTableCell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return <td className={className} data-label={label}>{children}</td>;
}
