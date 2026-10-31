import type { FileType } from "@/lib/kpis/catalog";

/**
 * The 7 daily Power BI exports. A file is recognized by its header row: it must
 * contain every `required` header. File names are never used.
 */
export interface FileTypeDef {
  type: FileType;
  label: string;
  /** "store" = one row per store; "rep" = one row per rep per store */
  level: "store" | "rep";
  required: string[];
  /** MTD report has a group row above the header row ("Activations", "Accessories", ...) */
  groupedHeader?: boolean;
}

export const FILE_TYPES: FileTypeDef[] = [
  {
    type: "mtd",
    label: "MTD Performance",
    level: "store",
    required: ["Location Code", "Upgrade Plus Opportunities", "Upgrade Plus Adds"],
    groupedHeader: true,
  },
  {
    type: "rank",
    label: "Rank Export",
    level: "store",
    required: ["Location", "Sales Code", "Region", "Submarket", "TCGA Perf Target"],
  },
  {
    type: "matrix",
    label: "Detailed Matrix (reps)",
    level: "rep",
    required: ["Advocate Name and ID", "Total Connected Gross Adds", "Accessory Revenue"],
  },
  {
    type: "fees",
    label: "Fees",
    level: "rep",
    required: ["Advocate Name and ID", "Activation Fees", "Waived Activation Fees"],
  },
  {
    type: "retention",
    label: "Retention",
    level: "rep",
    required: ["Authorized Retailer", "Advocate Name and ID", "BOP Subscribers", "Churn Monthly"],
  },
  {
    type: "chi",
    label: "CHI (Home Internet)",
    level: "rep",
    required: ["Advocate Name and ID", "Addresses Checked", "Close Rate"],
  },
  {
    type: "features",
    label: "Features",
    level: "rep",
    required: ["Advocate Name and ID", "Autopay Opportunities", "Hotspot Adds"],
  },
];

export const FILE_TYPE_BY_KEY = Object.fromEntries(FILE_TYPES.map((f) => [f.type, f])) as Record<FileType, FileTypeDef>;

/** Headers that identify the row rather than hold a number. */
export const LOCATION_HEADERS = ["location code", "location"];
export const REP_HEADER = "advocate name and id";
export const STRUCTURAL_HEADERS = new Set([
  "location code", "location", "sales code", "advocate name and id", "authorized retailer",
  "region", "market", "submarket", "%",
  // calculated by Power BI from columns we already keep
  "tcga attain", "wireless gross adds attain",
]);

export const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
