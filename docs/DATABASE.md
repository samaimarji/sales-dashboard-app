# Database design (plain language)

## The big ideas

1. **Every dealer is walled off.** Each row belongs to one dealer. The database itself refuses to show
   the app another dealer's rows (Postgres "row-level security"), even if a page had a bug.
2. **One org tree per dealer.** Dealer › Region › Area › District › Store. Each dealer can rename levels
   (for example, "Territory" instead of "Region") or skip them. Every unit stores its full path, so
   "everything under District 7" is one fast lookup.
3. **We keep the files' month-to-date numbers for every day.** Daily sales = today's MTD minus yesterday's.
   Percentages are never averaged. They're rebuilt from their two counts (enrollments ÷ opportunities),
   or weighted by size when the file only gives the percentage.
4. **Totals are pre-added.** After each import, the app adds up every district, area, region and the
   whole dealer for that day (`org_rollup_daily`). Screens read those totals instead of adding up
   1,000 stores every time.
5. **History is split by month** (table partitions), so years of data stay fast.

## Tables

| Group | Tables |
|---|---|
| Dealers and structure | `dealers`, `dealer_org_levels`, `org_units`, `stores` |
| People | `people`, `person_aliases`, `store_assignments` |
| Logins | `users`, `user_roles`, `sessions` |
| KPIs and reports | `kpi_catalog`, `saved_reports`, `saved_report_kpis` |
| Imports | `import_batches`, `import_files`, `reconciliation_issues` |
| Numbers | `rep_daily_mtd`, `store_daily_mtd`, `org_rollup_daily`, `kpi_goals` |
| Settings and history | `audit_log` |
| Ready for later | `labor_rules`, `schedules`, `shifts`, `commission_plans`, `billing_accounts` |

## Rules built into the design

- **Hidden from rep views:** `people.hidden_from_rep_views`. Their numbers stay in store and dealer totals,
  but rep lists, rankings and cards leave them out.
- **Reps at more than one store:** one `people` row, many `store_assignments`, and every spelling seen in
  a file maps to them through `person_aliases`.
- **Access by org level:** a `user_roles` row ties a login to one unit in the tree. They see that unit
  and everything below it.

## Sample data

`npm run db:seed` creates:

- **Sunrise Wireless:** 4 stores, Company › District › Store (Region and Area skipped), 14 people.
- **Pacific Coast Mobile:** 1,000 stores in 5 territories › 20 markets › 200 districts, about 10,200 people
  (about 800 work at 2 stores, plus 200 selling managers hidden from rep views).
- Aug 1 – Oct 30, 2026, with daily MTD numbers for every rep and store, store goals and dealer-wide rate
  goals, all generated so that rep totals add up exactly to store totals.
