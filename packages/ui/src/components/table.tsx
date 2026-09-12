import type { CSSProperties, ReactNode } from "react";

import { cn } from "../lib/cn";

export type TableRow = { id?: string } & Record<string, unknown>;

export type TableColumn<Row extends TableRow = TableRow> = {
  key: string;
  header: ReactNode;
  width?: number | string;
  align?: "left" | "right" | "center";
  mono?: boolean;
  muted?: boolean;
  render?: (row: Row) => ReactNode;
};

export type TableProps<Row extends TableRow = TableRow> = {
  columns: TableColumn<Row>[];
  rows: Row[];
  density?: "dense" | "default" | "comfortable";
  zebra?: boolean;
  selectedId?: string;
  onRowClick?: (row: Row) => void;
  empty?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

const ROW_HEIGHTS: Record<NonNullable<TableProps["density"]>, string> = {
  dense: "h-row-dense",
  default: "h-row-default",
  comfortable: "h-row-comfortable",
};

const ALIGN: Record<NonNullable<TableColumn["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function cellContent(value: unknown): ReactNode {
  if (value === null || value === undefined || typeof value === "boolean")
    return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return String(value);
}

export function Table<Row extends TableRow>({
  columns,
  rows,
  density = "default",
  zebra = false,
  selectedId,
  onRowClick,
  empty,
  className,
  style,
}: TableProps<Row>) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-border bg-card",
        className,
      )}
      style={style}
    >
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="h-row-dense bg-muted">
            {columns.map((column) => (
              <th
                key={column.key}
                style={
                  column.width === undefined
                    ? undefined
                    : { width: column.width }
                }
                className={cn(
                  "whitespace-nowrap border-b border-border px-5 text-2xs font-medium uppercase tracking-caps text-meta",
                  ALIGN[column.align ?? "left"],
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-0">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const selected =
                selectedId !== undefined && row.id === selectedId;
              return (
                <tr
                  key={row.id ?? i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    ROW_HEIGHTS[density],
                    "transition-[background] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
                    onRowClick && "cursor-pointer",
                    selected
                      ? "bg-selected"
                      : cn(
                          zebra && i % 2 === 1 && "bg-muted",
                          "hover:bg-hover",
                        ),
                  )}
                >
                  {columns.map((column, columnIndex) => (
                    <td
                      key={column.key}
                      className={cn(
                        "truncate px-5 text-base text-foreground",
                        ALIGN[column.align ?? "left"],
                        column.mono && "font-mono text-sm",
                        column.muted && "text-meta",
                        i < rows.length - 1 && "border-b border-border",
                        selected && columnIndex === 0 && "shadow-inset-rail",
                      )}
                    >
                      {column.render
                        ? column.render(row)
                        : cellContent(row[column.key])}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
