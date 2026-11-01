# Dealer Dashboard

A sales dashboard web app for Cricket Wireless dealers, built to work for 4 stores or 1,000+.

**Status:** Version 1 is complete (steps 1–6): database, sample data, daily upload with checks, screens, settings, logins with roles, and a speed test at 1,000 stores ([results](docs/SPEED.md)).
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

## Putting it online

See [docs/DEPLOY-RAILWAY.md](docs/DEPLOY-RAILWAY.md): a click-by-click guide, no command line needed.

## Running it on a computer (developer notes)

Requires Node 20+ and Postgres 16 (or run `docker compose up -d` to start one).

```bash
cp .env.example .env.local   # then set DEMO_PASSWORD to a password of your choice
npm install
npm run db:reset      # wipes the local database, creates tables, generates sample data (~5 min)
npm run dev           # then open http://localhost:3000 and log in, e.g. admin@pacific-coast.demo
                      # demo logins: owner@demo.local, admin@ / territory@ / market@ / district@ / store@ / rep@pacific-coast.demo
npm run create-admin  # create a real platform admin login (asks for the password; nothing is saved to files)

# fake Power BI files for trying the upload page:
npm run samples -- --dealer sunrise --date 2026-10-30
npm run samples -- --dealer pacific-coast --date 2026-10-30 --break   # with 3 planted mistakes
npm test
```
