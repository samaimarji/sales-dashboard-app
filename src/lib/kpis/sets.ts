/** Default KPI lists for each screen (dealers will be able to change these in Settings). */

export const TILE_KPIS = ["activations", "upgrades", "accessory_revenue", "chi_orders", "autopay_rate", "protect_rate", "upgrade_plus_rate", "wtr"];

export const OVERVIEW_COLUMNS = ["activations", "upgrades", "accessory_revenue", "chi_orders", "autopay_rate", "protect_rate", "upgrade_plus_rate", "wtr"];

/** Store card and rep card, in the same order as the Sales Dashboard sheet. */
export const CARD_KPIS = [
  "activations", "upgrades", "accessory_revenue", "chi_orders", "bread_leases", "progressive_leases", "ppp_links_sent",
  "add_a_line_pct", "multiline_pct", "max_attach_rate", "autopay_rate", "protect_rate", "ild_rate", "upgrade_plus_rate", "wtr",
];

/** KPIs that can be ranked. */
export const RANKING_KPIS = [
  "activations", "upgrades", "boxes", "accessory_revenue", "chi_orders", "autopay_rate", "protect_rate", "upgrade_plus_rate",
  "ild_rate", "wtr", "ppp_funded", "sales_per_10_bill_pays", "net_adds",
];

/**
 * Opportunities: customers already at the counter who didn't get the product.
 * missed = chances - sold. CHI's chances are bill payments (goal: check every one).
 */
export const OPPORTUNITIES = [
  { key: "chi", label: "CHI address checks", chances: "bill_payments", sold: "chi_addresses_checked", rate: "chi_check_rate" },
  { key: "ild", label: "ILD", chances: "ild_opps", sold: "ild_adds", rate: "ild_rate" },
  { key: "upgrade_plus", label: "Upgrade Plus", chances: "upgrade_plus_opps", sold: "upgrade_plus_adds", rate: "upgrade_plus_rate" },
  { key: "protect", label: "Protect", chances: "protect_opps", sold: "protect_adds", rate: "protect_rate" },
  { key: "autopay", label: "Autopay", chances: "autopay_opps", sold: "autopay_enrollments", rate: "autopay_rate" },
] as const;

/** Short column headings for tables. */
const SHORT: Record<string, string> = {
  activations: "Activations", upgrades: "Upgrades", accessory_revenue: "Accessories", chi_orders: "CHI", boxes: "Boxes",
  autopay_rate: "Autopay", protect_rate: "Protect", upgrade_plus_rate: "Upgrade+", ild_rate: "ILD", wtr: "WTR",
  ppp_funded: "PPP funded", sales_per_10_bill_pays: "Sales/10 bill pays", net_adds: "Net adds", bill_payments: "Bill pays",
};
export const shortLabel = (code: string, fallback?: string) => SHORT[code] ?? fallback ?? code;
