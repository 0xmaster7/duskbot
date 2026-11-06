import type { DataColumn, DataPage } from "../../../shared/data-surface";

export type Cell = DataPage["rows"][number][number];

export function isNumericType(type: string): boolean {
  return /^(?:U?(?:TINY|SMALL|BIG|HUGE)?INT(?:EGER)?|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL)\b/i.test(type.trim());
}

/** DuckDB sends bigints and decimals as strings. */
export function cellNumber(value: Cell): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Vega-Lite parses ISO dates itself. */
export function rowObjects(columns: DataColumn[], rows: Cell[][]): Array<Record<string, Cell>> {
  const numeric = columns.map((column) => isNumericType(column.type));
  return rows.map((row) => {
    const object: Record<string, Cell> = {};
    columns.forEach((column, index) => {
      const value = row[index] ?? null;
      object[column.name] = numeric[index] ? cellNumber(value) : value;
    });
    return object;
  });
}
