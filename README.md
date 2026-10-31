# Dealer Dashboard

A sales dashboard web app for Cricket Wireless dealers, built to work for 4 stores or 1,000+.

**Status:** Step 1 of version 1 is done: project setup, database and sample data.
All names and numbers in this project are made up.

## What's here

| Folder | What it is |
|---|---|
| `src/app` | The web pages |
| `src/lib/kpis/catalog.ts` | The master KPI list (every column from the 7 Power BI exports) |
| `db/migrations` | The database design, as SQL files applied in order |
| `scripts/seed-demo.ts` | The fake-data generator (2 dealers, about 90 days of numbers) |
| `docs/DATABASE.md` | The database design in plain language |
| `docs/screenshots` | Screenshots of each step |

## Stack

- **Next.js + TypeScript:** pages and server in one codebase.
- **Postgres:** with row-level security per dealer, an `ltree` org tree, and month-partitioned history.
- **Pre-calculated totals:** `org_rollup_daily` stores every org level's totals per day, so screens stay fast at 1,000 stores.

## Running it on a computer (developer notes)

Requires Node 20+ and Postgres 16 (or run `docker compose up -d` to start one).

```bash
cp .env.example .env.local
npm install
npm run db:reset      # wipes the local database, creates tables, generates sample data (~5 min)
npm run dev           # then open http://localhost:3000
```
