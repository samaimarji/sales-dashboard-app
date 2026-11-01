/**
 * Master list of every KPI the app knows about, built from the header rows of the
 * 7 daily Power BI exports. Each KPI says how it adds up across reps and stores:
 *
 *   sum           counts and dollars: just add them
 *   ratio         rates we can rebuild from two counts (e.g. Autopay Rate =
 *                 Autopay Enrollments / Autopay Opportunities). Never average a %.
 *   weighted_avg  rates where the file only gives the %, so we weight by a size KPI
 *
 * `sources` records which file/column each value comes from; the importer (step 2)
 * uses this to map columns. Goals from the files land in kpi_goals, not here.
 *
 * Header names for the MTD report include the group row above the column row,
 * e.g. "Accessories › Access", because names like "Goals" repeat in each group.
 */

export type FileType = "mtd" | "rank" | "matrix" | "fees" | "retention" | "chi" | "features";
export type Unit = "count" | "currency" | "percent" | "decimal";
export type Agg = "sum" | "ratio" | "weighted_avg";

export interface KpiSource {
  file: FileType;
  header: string;
  /**
   * "goal": the dealer's monthly goal for this KPI (e.g. MTD report goals).
   * "target": Cricket's performance target (e.g. rank export "Perf Target").
   */
  role?: "value" | "goal" | "target";
}

export interface Kpi {
  code: string;
  label: string;
  category: string;
  unit: Unit;
  agg: Agg;
  numerator?: string;
  denominator?: string;
  weightKpi?: string;
  higherIsBetter: boolean;
  /** false = calculated from other KPIs, not stored */
  stored: boolean;
  /** calculated KPIs that add other KPIs together (e.g. boxes = activations + upgrades) */
  parts?: string[];
  /** multiply a ratio (e.g. 10 for "per 10 bill payments") */
  scale?: number;
  sources: KpiSource[];
  description?: string;
}

const src = (file: FileType, header: string, role: KpiSource["role"] = "value"): KpiSource => ({ file, header, role });

function count(code: string, label: string, category: string, sources: KpiSource[], opts: Partial<Kpi> = {}): Kpi {
  return { code, label, category, unit: "count", agg: "sum", higherIsBetter: true, stored: true, sources, ...opts };
}
function money(code: string, label: string, category: string, sources: KpiSource[], opts: Partial<Kpi> = {}): Kpi {
  return { code, label, category, unit: "currency", agg: "sum", higherIsBetter: true, stored: true, sources, ...opts };
}
function ratio(code: string, label: string, category: string, numerator: string, denominator: string, sources: KpiSource[], opts: Partial<Kpi> = {}): Kpi {
  return { code, label, category, unit: "percent", agg: "ratio", numerator, denominator, higherIsBetter: true, stored: false, sources, ...opts };
}
function wavg(code: string, label: string, category: string, weightKpi: string, sources: KpiSource[], opts: Partial<Kpi> = {}): Kpi {
  return { code, label, category, unit: "percent", agg: "weighted_avg", weightKpi, higherIsBetter: true, stored: true, sources, ...opts };
}

export const KPI_CATALOG: Kpi[] = [
  // --- Sales -----------------------------------------------------------------
  count("activations", "Activations", "Sales", [
    src("mtd", "Activations › Activations"), src("mtd", "Activations › Goal", "goal"),
    src("rank", "Total Connected Gross Adds"), src("rank", "TCGA Perf Target", "target"),
    src("matrix", "Total Connected Gross Adds"),
  ], { description: "Total Connected Gross Adds: wireless lines + Home Internet. Same as 'Activations' on the MTD report." }),
  count("wireless_gross_adds", "Wireless Gross Adds", "Sales", [
    src("rank", "Wireless Gross Adds"), src("rank", "Wireless Gross Adds Perf Target", "target"),
    src("matrix", "Wireless Gross Adds"),
  ], { description: "New wireless lines only (no Home Internet)." }),
  count("upgrades", "Upgrades", "Sales", [
    src("mtd", "Upgrades › Upgrades"), src("mtd", "Upgrades › Goals", "goal"),
    src("rank", "Device Upgrades"), src("matrix", "Device Upgrades"),
  ]),
  money("accessory_revenue", "Accessory Revenue", "Sales", [
    src("mtd", "Accessories › Access"), src("mtd", "Accessories › Goals", "goal"),
    src("matrix", "Accessory Revenue"),
  ]),
  wavg("accessory_rev_per_opp", "Accessory Revenue per Opportunity", "Sales", "activations",
    [src("matrix", "Accessory Revenue per Opportunity")], { unit: "currency" }),
  count("net_adds", "Net Adds", "Sales", [src("rank", "Net Adds"), src("retention", "Net Adds")]),
  count("net_disconnects", "Net Disconnects", "Sales", [src("rank", "Net Disconnects"), src("retention", "Net Disconnects")],
    { description: "Reported as a negative number, as in the Power BI files." }),
  count("boxes", "Total Boxes", "Sales", [], { stored: false, parts: ["activations", "upgrades"],
    description: "Activations + upgrades." }),
  ratio("sales_per_10_bill_pays", "Sales per 10 Bill Payments", "Sales", "boxes", "bill_payments", [],
    { unit: "decimal", scale: 10, description: "Boxes for every 10 bill payment customers: how well walk-in traffic turns into sales." }),
  count("open_stores", "Open Stores", "Sales", [src("rank", "BOP Open Stores")],
    { description: "1 per open store. Used for per-door rates." }),
  count("port_in", "Port In", "Sales", [src("matrix", "Port In")]),
  count("port_out", "Port Out", "Sales", [src("matrix", "Port Out")], { higherIsBetter: false }),
  ratio("port_ratio", "Port Ratio", "Sales", "port_in", "port_out", [src("matrix", "Port Ratio")], { unit: "decimal" }),
  count("bill_payments", "Bill Payments", "Sales", [
    src("mtd", "PPP & Payment › Cricket Bill Payment"), src("matrix", "Bill Payment"), src("fees", "Bill Payment"),
  ]),
  count("customer_assist_fees", "Full Customer Assistance Fees", "Sales", [src("matrix", "Full Customer Assistance Fees")]),
  count("plan_upgrades_30d", "Plan Upgrades within 30 Days", "Sales", [src("matrix", "Plan Upgrades within 30 days of Activation Date")]),
  count("plan_downgrades_30d", "Plan Downgrades within 30 Days", "Sales", [src("matrix", "Plan Downgrades within 30 days of Activation Date")],
    { higherIsBetter: false }),
  count("free_ship_gross_adds", "Free Shipping Gross Adds", "Sales", [src("matrix", "Free Shipping Gross Adds")]),
  count("free_ship_upgrades", "Free Shipping Upgrades", "Sales", [src("matrix", "Free Shipping Upgrades")]),
  wavg("wtr", "WTR (Willing to Recommend)", "Sales", "activations", [src("matrix", "WTR")],
    { description: "Customer survey score." }),

  // --- Activation mix ------------------------------------------------------------
  wavg("byod_pct", "BYOD Activation %", "Activation Mix", "wireless_gross_adds",
    [src("rank", "BYOD Activation %"), src("matrix", "BYOD Activation %")]),
  wavg("add_a_line_pct", "Add-a-Line Activations %", "Activation Mix", "wireless_gross_adds",
    [src("rank", "Add-a-Line Activations %"), src("matrix", "Add-a-Line Activations %")]),
  wavg("multiline_pct", "Multiline Activations %", "Activation Mix", "wireless_gross_adds",
    [src("rank", "Multiline Activations %"), src("matrix", "Multiline Activations %"), src("retention", "Multiline Activations %")]),
  count("plan_35", "$35 Sensible Activations", "Activation Mix", [src("rank", "$35 Sensible Activations"), src("matrix", "$35 Sensible Activations")]),
  count("plan_40", "$40 Select Activations", "Activation Mix", [src("rank", "$40 Select Activations"), src("matrix", "$40 Select Activations")]),
  count("plan_50", "$50 Smart Activations", "Activation Mix", [src("rank", "$50 Smart Activations"), src("matrix", "$50 Smart Activations")]),
  count("plan_55_legacy", "$55 Legacy Unlimited Activations", "Activation Mix",
    [src("rank", "$55 Legacy Unlimited Activations"), src("matrix", "$55 Legacy Unlimited Activations")]),
  count("plan_60_legacy", "$60 Legacy Unlimited Activations", "Activation Mix",
    [src("rank", "$60 Legacy Unlimited Activations"), src("matrix", "$60 Legacy Unlimited Activations")]),
  count("plan_60_supreme", "$60 Supreme Activations", "Activation Mix", [src("rank", "$60 Supreme Activations"), src("matrix", "$60 Supreme Activations")]),
  wavg("plan_60_plus_mix", "$60+ Rate Plan Mix", "Activation Mix", "wireless_gross_adds",
    [src("rank", "$60+ Rate Plan Mix"), src("matrix", "$60+ Rate Plan Mix")]),
  count("simply_data", "Simply Data Activations", "Activation Mix", [src("rank", "Simply Data Activations"), src("matrix", "Simply Data Activations")]),
  count("watch_activations", "Watch Activations", "Activation Mix", [src("rank", "Watch Activations"), src("matrix", "Watch Activations")]),
  wavg("max_attach_rate", "Max Activation Attach Rate", "Activation Mix", "wireless_gross_adds",
    [src("rank", "Max Activation Attach Rate"), src("matrix", "Max Activation Attach Rate")]),

  // --- Features (attach rates) ---------------------------------------------------
  count("autopay_opps", "Autopay Opportunities", "Features", [src("features", "Autopay Opportunities"), src("retention", "Autopay Opportunities")]),
  count("autopay_enrollments", "Autopay Enrollments", "Features", [src("features", "Autopay Enrollments"), src("retention", "Autopay Enrollments")]),
  ratio("autopay_rate", "Autopay Rate", "Features", "autopay_enrollments", "autopay_opps", [
    src("features", "Autopay Rate"), src("retention", "Autopay Enrollment Rate"), src("matrix", "Autopay Enrollment Rate"),
  ], { description: "Used for commission (Detailed Matrix value)." }),
  count("protect_opps", "Protect Opportunities", "Features", [src("features", "Protect Opportunities")]),
  count("protect_adds", "Protect Adds", "Features", [src("features", "Protect Adds")]),
  ratio("protect_rate", "Protect Attach Rate (All-In)", "Features", "protect_adds", "protect_opps",
    [src("features", "Protect Attach Rate (All-In)"), src("matrix", "Protect Attach Rate (All-In)")]),
  count("upgrade_plus_opps", "Upgrade Plus Opportunities", "Features",
    [src("mtd", "Upgrade Plus Opportunities › Upgrade Plus Opportunities"), src("features", "Upgrade Plus Opportunities"), src("matrix", "Upgrade Plus Opportunities")]),
  count("upgrade_plus_adds", "Upgrade Plus Adds", "Features",
    [src("mtd", "Upgrade Plus Opportunities › Upgrade Plus Adds"), src("features", "Upgrade Plus Adds"), src("matrix", "Upgrade Plus Adds")]),
  ratio("upgrade_plus_rate", "Upgrade Plus Attach Rate", "Features", "upgrade_plus_adds", "upgrade_plus_opps",
    [src("mtd", "Upgrade Plus Opportunities › Upgrade Plus Attach Rate"), src("features", "Upgrade Plus Attach Rate"), src("matrix", "Upgrade Plus Attach Rate")]),
  count("hotspot_opps", "Hotspot Opportunities", "Features", [src("features", "Hotspot Opportunities")]),
  count("hotspot_adds", "Hotspot Adds", "Features", [src("features", "Hotspot Adds")]),
  ratio("hotspot_rate", "Hotspot Attach Rate", "Features", "hotspot_adds", "hotspot_opps", [src("features", "Hotspot Attach Rate")]),
  count("ild_opps", "ILD Opportunities", "Features", [src("features", "ILD Opportunities"), src("matrix", "ILD Opportunities")]),
  count("ild_adds", "ILD Adds", "Features", [src("features", "ILD Adds"), src("matrix", "ILD Adds")]),
  ratio("ild_rate", "ILD Attach Rate", "Features", "ild_adds", "ild_opps", [src("features", "ILD Attach Rate"), src("matrix", "ILD Attach Rate")]),

  // --- PPP / financing -----------------------------------------------------------
  count("ppp_links_sent", "PPP Application Links Sent", "PPP & Financing", [src("matrix", "Total PPP Application Links Sent")]),
  count("ppp_funded", "PPP Leases Funded", "PPP & Financing", [], { stored: false, parts: ["bread_leases", "progressive_leases"],
    description: "Bread + Progressive leases funded." }),
  count("ppp_apps_submitted", "PPP Applications Submitted", "PPP & Financing", [src("mtd", "PPP & Payment › PPP Applications Submitted")]),
  money("ppp_accessory_sales", "PPP Accessories Sales", "PPP & Financing", [src("mtd", "Accessories › PPP Accessories Sales")]),
  count("progressive_rebates", "Progressive Lease Vendor Rebate", "PPP & Financing", [src("mtd", "PPP & Payment › Progressive Lease Vendor Rebate")]),
  count("bread_submitted", "Bread Applications Submitted", "PPP & Financing", [src("mtd", "Bread Financial › Submitted")]),
  count("bread_approved", "Bread Applications Approved", "PPP & Financing", [src("mtd", "Bread Financial › Approved")]),
  count("bread_leases", "Bread Leases Funded", "PPP & Financing", [src("matrix", "Bread Leases Funded")]),
  count("progressive_leases", "Progressive Leases Funded", "PPP & Financing", [src("matrix", "Progressive Leases Funded")]),
  wavg("ppp_attach_rate", "Total PPP Attach Rate", "PPP & Financing", "activations", [src("matrix", "Total PPP Attach Rate")]),

  // --- Fees ------------------------------------------------------------------
  count("activation_fees", "Activation Fees", "Fees", [src("fees", "Activation Fees")]),
  count("act_fees_discounted", "Discounted Activation Fees", "Fees", [src("fees", "Discounted Activation Fees")], { higherIsBetter: false }),
  ratio("act_fees_discounted_rate", "Discounted Activation Fee Rate", "Fees", "act_fees_discounted", "activation_fees",
    [src("fees", "Discounted Activation Fee Attach Rate")], { higherIsBetter: false }),
  money("act_fees_discounted_rev", "Discounted Activation Fee Revenue", "Fees", [src("fees", "Discounted Activation Fee Revenue")]),
  count("act_fees_waived", "Waived Activation Fees", "Fees", [src("fees", "Waived Activation Fees")], { higherIsBetter: false }),
  ratio("act_fees_waived_rate", "Waived Activation Fee Rate", "Fees", "act_fees_waived", "activation_fees",
    [src("fees", "Waived Activation Fee Attach Rate")], { higherIsBetter: false }),
  money("act_fees_waived_rev", "Waived Activation Fee Revenue", "Fees", [src("fees", "Waived Activation Fee Revenue")], { higherIsBetter: false }),
  wavg("avg_act_fee_collected", "Average Activation Fee Collected", "Fees", "activation_fees",
    [src("fees", "Average Activation Fees Collected")], { unit: "currency" }),
  count("upgrade_fees", "Upgrade Fees", "Fees", [src("fees", "Upgrade Fees")]),
  count("upg_fees_discounted", "Discounted Upgrade Fees", "Fees", [src("fees", "Discounted Upgrade Fees")], { higherIsBetter: false }),
  ratio("upg_fees_discounted_rate", "Discounted Upgrade Fee Rate", "Fees", "upg_fees_discounted", "upgrade_fees",
    [src("fees", "Discounted Upgrade Fee Attach Rate")], { higherIsBetter: false }),
  money("upg_fees_discounted_rev", "Discounted Upgrade Fee Revenue", "Fees", [src("fees", "Discounted Upgrade Fee Revenue")]),
  count("upg_fees_waived", "Waived Upgrade Fees", "Fees", [src("fees", "Waived Upgrade Fees")], { higherIsBetter: false }),
  ratio("upg_fees_waived_rate", "Waived Upgrade Fee Rate", "Fees", "upg_fees_waived", "upgrade_fees",
    [src("fees", "Waived Upgrade Fee Attach Rate")], { higherIsBetter: false }),
  money("upg_fees_waived_rev", "Waived Upgrade Fee Revenue", "Fees", [src("fees", "Waived Upgrade Fee Revenue")], { higherIsBetter: false }),

  // --- Retention ---------------------------------------------------------------
  count("bop_subscribers", "BOP Subscribers", "Retention", [src("rank", "BOP Subscribers"), src("retention", "BOP Subscribers")],
    { description: "Subscribers at beginning of period." }),
  count("eop_subscribers", "EOP Subscribers", "Retention", [src("rank", "EOP Subscribers"), src("retention", "EOP Subscribers")],
    { description: "Subscribers at end of period." }),
  count("voluntary_churn", "Voluntary Churn", "Retention", [src("retention", "Voluntary Churn")], { higherIsBetter: false }),
  count("involuntary_churn", "Involuntary Churn", "Retention", [src("retention", "Involuntary Churn")], { higherIsBetter: false }),
  wavg("churn_rate", "Churn Rate", "Retention", "bop_subscribers",
    [src("rank", "Churn Rate"), src("retention", "Churn Monthly")], { higherIsBetter: false }),
  wavg("retention_rate", "Retention Rate", "Retention", "bop_subscribers", [src("rank", "Retention Rate (CCS)")]),
  count("eop_suspended", "EOP Suspended", "Retention", [src("retention", "EOP Suspended")], { higherIsBetter: false }),
  wavg("port_in_ga_pct", "Port In Gross Add %", "Retention", "wireless_gross_adds", [src("retention", "Port In Gross Add %")]),

  // --- Home Internet (CHI) ---------------------------------------------------------
  count("chi_orders", "Home Internet Orders", "Home Internet", [
    src("mtd", "CHI › Achieved"), src("mtd", "CHI › Goals", "goal"),
    src("rank", "Home Internet Orders"), src("matrix", "Home Internet Orders"), src("chi", "Total Orders"),
  ]),
  count("chi_gross_adds", "Home Internet Gross Adds", "Home Internet", [
    src("rank", "Home Internet Gross Adds"), src("matrix", "Home Internet Gross Adds"), src("chi", "Gross Adds"),
  ]),
  count("chi_addresses_checked", "Addresses Checked", "Home Internet", [
    src("mtd", "CHI › Addresses Checked for CHI"), src("chi", "Addresses Checked"),
  ]),
  count("chi_addresses_eligible", "Addresses Eligible", "Home Internet", [
    src("mtd", "CHI › Addresses Eligible for CHI"), src("chi", "Addresses Eligible"),
  ]),
  count("chi_credit_checked", "Addresses Credit Checked", "Home Internet", [src("chi", "Addresses Credit Checked")]),
  ratio("chi_check_rate", "CHI Checks per Bill Payment", "Home Internet", "chi_addresses_checked", "bill_payments", [],
    { description: "Goal: check an address for every bill payment customer." }),
  ratio("chi_credit_check_rate", "Credit Checks % of Address Checks", "Home Internet", "chi_credit_checked", "chi_addresses_checked",
    [src("chi", "Credit Checks % of Address Checks")]),
  count("chi_adv_payment_required", "Advanced Payment Required", "Home Internet", [src("chi", "Advanced Payment Required")]),
  ratio("chi_order_rate", "% of Addresses Checked with Order", "Home Internet", "chi_orders", "chi_addresses_checked",
    [src("chi", "% of Addresses Checked with Internet Order")]),
  ratio("chi_close_rate", "Home Internet Close Rate", "Home Internet", "chi_gross_adds", "chi_orders", [src("chi", "Close Rate")]),
  ratio("chi_addresses_per_door", "Addresses Checked / Door", "Home Internet", "chi_addresses_checked", "open_stores",
    [src("chi", "Addresses Checked / Door")], { unit: "decimal" }),
  ratio("chi_orders_per_door", "Orders / Door", "Home Internet", "chi_orders", "open_stores",
    [src("chi", "Orders / Door")], { unit: "decimal" }),
];

export const KPI_BY_CODE: Record<string, Kpi> = Object.fromEntries(KPI_CATALOG.map((k) => [k.code, k]));

/** KPIs that are stored in the jsonb `m` maps (everything except calculated ratios). */
export const STORED_KPIS = KPI_CATALOG.filter((k) => k.stored);
