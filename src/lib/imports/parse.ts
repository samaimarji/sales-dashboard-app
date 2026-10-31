import ExcelJS from "exceljs";
import { KPI_CATALOG, type FileType } from "@/lib/kpis/catalog";
import { FILE_TYPES, LOCATION_HEADERS, REP_HEADER, STRUCTURAL_HEADERS, norm, type FileTypeDef } from "./file-types";

export type Cell = string | number | null;

export interface ParsedRecord {
  storeNumber: string;
  location: string;
  /** rep files only */
  repRaw?: string;
  repName?: string;
  repCode?: string;
  values: Record<string, number>;
}

export interface ParsedGoal {
  storeNumber: string;
  kpi: string;
  goalSet: "dealer" | "cricket";
  target: number;
}

export interface ParsedFile {
  name: string;
  type: FileType | null;
  label: string;
  /** "numbers through" date from the Power BI "Applied filters" note, if present */
  dateThrough: string | null;
  records: ParsedRecord[];
  goals: ParsedGoal[];
  ignoredColumns: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Reading cells from .xlsx / .csv
// ---------------------------------------------------------------------------

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue); // formula
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
  }
  return String(v);
}

function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field === "" ? null : field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field === "" ? null : field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field === "" ? null : field); rows.push(row); }
  return rows;
}

/** Returns every sheet in the file as a grid of cells. */
export async function readGrids(name: string, data: Buffer): Promise<Cell[][][]> {
  if (/\.csv$/i.test(name)) return [parseCsv(data.toString("utf8"))];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const grid: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const cells: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { cells[c - 1] = cellValue(cell.value); });
      grid[r - 1] = Array.from(cells, (c) => c ?? null);
    });
    return Array.from(grid, (r) => r ?? []);
  });
}

// ---------------------------------------------------------------------------
// Recognizing and mapping
// ---------------------------------------------------------------------------

/** header (normalized) -> KPI mapping, per file type, built from the catalog's `sources`. */
const MAPPINGS: Record<string, Map<string, { kpi: string; role: "value" | "goal" | "target"; stored: boolean }>> = {};
for (const k of KPI_CATALOG) {
  for (const s of k.sources) {
    (MAPPINGS[s.file] ??= new Map()).set(norm(s.header), { kpi: k.code, role: s.role ?? "value", stored: k.stored });
  }
}

function findHeader(grid: Cell[][]): { def: FileTypeDef; row: number } | null {
  const limit = Math.min(grid.length, 30);
  for (let r = 0; r < limit; r++) {
    const cells = new Set(grid[r].map(norm));
    for (const def of FILE_TYPES) {
      if (def.required.every((h) => cells.has(norm(h)))) return { def, row: r };
    }
  }
  return null;
}

/** Reads numbers as Power BI writes them: 12, "1,234.50", "$12.00", "45%", "0.45", blank. */
export function toNumber(v: Cell): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.trim();
  if (!s || s === "-" || s === "—") return null;
  const pct = s.endsWith("%");
  const n = Number(s.replace(/[$,%\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

const DATE_RANGE = /calendar date is on or after (\d{4}-\d{2}-\d{2}) and is before (\d{4}-\d{2}-\d{2})/i;
const DATE_ON_OR_BEFORE = /calendar date is on or before (\d{4}-\d{2}-\d{2})/i;

function findDateThrough(grid: Cell[][]): string | null {
  for (let r = grid.length - 1; r >= 0; r--) {
    for (const c of grid[r]) {
      if (typeof c !== "string" || !/calendar date/i.test(c)) continue;
      const m = c.match(DATE_RANGE);
      if (m) {
        const d = new Date(m[2] + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      }
      const m2 = c.match(DATE_ON_OR_BEFORE);
      if (m2) return m2[1];
    }
  }
  return null;
}

/** "101: Demo Dealer - Main St" -> "101" */
export function storeNumberOf(location: string): string | null {
  const m = location.trim().match(/^(\d{1,6})\s*[:\-–]/) ?? location.trim().match(/^(\d{1,6})$/);
  return m ? m[1] : null;
}

/** "JANE DOE - jd1234" -> { name: "Jane Doe", code: "jd1234" } */
export function splitRep(raw: string): { name: string; code: string | null } {
  const i = raw.lastIndexOf(" - ");
  const name = (i > 0 ? raw.slice(0, i) : raw).trim();
  const code = i > 0 ? raw.slice(i + 3).trim() || null : null;
  const pretty = name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  return { name: pretty, code };
}

export function parseGrid(name: string, grid: Cell[][]): ParsedFile {
  const found = findHeader(grid);
  if (!found) {
    return { name, type: null, label: "Not recognized", dateThrough: null, records: [], goals: [], ignoredColumns: [],
      error: "No known header row found. Is this one of the 7 Power BI exports?" };
  }
  const { def, row } = found;
  const header = grid[row];
  const groupRow = def.groupedHeader && row > 0 ? grid[row - 1] : [];
  const mapping = MAPPINGS[def.type] ?? new Map();

  let locCol = -1;
  let repCol = -1;
  const cols: { idx: number; kpi: string; role: "value" | "goal" | "target" }[] = [];
  const ignored: string[] = [];
  let group = "";
  header.forEach((h, idx) => {
    if (groupRow[idx]) group = String(groupRow[idx]).trim();
    const col = norm(h);
    if (!col) return;
    if (locCol < 0 && LOCATION_HEADERS.includes(col)) { locCol = idx; return; }
    if (col === REP_HEADER) { repCol = idx; return; }
    const m = (group && mapping.get(norm(`${group} › ${h}`))) || mapping.get(col);
    if (m && (m.stored || m.role !== "value")) cols.push({ idx, kpi: m.kpi, role: m.role });
    else if (!m && !STRUCTURAL_HEADERS.has(col)) ignored.push(group ? `${group} › ${String(h).trim()}` : String(h).trim());
  });
  if (def.type === "retention") {
    // Retention lists "Authorized Retailer" first; the store is in "Location".
    const i = header.findIndex((h) => norm(h) === "location");
    if (i >= 0) locCol = i;
  }

  const records: ParsedRecord[] = [];
  const goals: ParsedGoal[] = [];
  for (let r = row + 1; r < grid.length; r++) {
    const cells = grid[r];
    const location = cells[locCol];
    if (typeof location !== "string" && typeof location !== "number") continue;
    const storeNumber = storeNumberOf(String(location));
    if (!storeNumber) continue; // "Total", notes, blank rows
    const rec: ParsedRecord = { storeNumber, location: String(location).trim(), values: {} };
    if (def.level === "rep") {
      const raw = cells[repCol];
      if (raw === null || raw === undefined || String(raw).trim() === "") continue;
      const { name: repName, code } = splitRep(String(raw));
      Object.assign(rec, { repRaw: String(raw).trim(), repName, repCode: code ?? undefined });
    }
    for (const c of cols) {
      const v = toNumber(cells[c.idx]);
      if (c.role === "value") {
        if (v !== null) rec.values[c.kpi] = v;
      } else if (v !== null && v > 0) {
        goals.push({ storeNumber, kpi: c.kpi, goalSet: c.role === "goal" ? "dealer" : "cricket", target: v });
      }
    }
    records.push(rec);
  }
  return { name, type: def.type, label: def.label, dateThrough: findDateThrough(grid), records, goals, ignoredColumns: ignored };
}

/** Reads a file and returns the first sheet that is a recognized export. */
export async function parseFile(name: string, data: Buffer): Promise<ParsedFile> {
  let grids: Cell[][][];
  try {
    grids = await readGrids(name, data);
  } catch {
    return { name, type: null, label: "Unreadable", dateThrough: null, records: [], goals: [], ignoredColumns: [],
      error: "Couldn't open this file. Upload the .xlsx (or .csv) exactly as exported from Power BI." };
  }
  let first: ParsedFile | null = null;
  for (const grid of grids) {
    const parsed = parseGrid(name, grid);
    if (parsed.type) return parsed;
    first ??= parsed;
  }
  return first ?? parseGrid(name, []);
}
