# Speed test

Run 2026-11-01 03:40 UTC against **pacific-coast**: 1,000 stores, ~11,000 reps, 360 days of history
(3,959,640 rep rows, database 4935 MB). Each page: 1 warm-up, then median and slowest of 5 loads. Budget: 2 s.

**Every page is under budget.**

| Role | Page | Typical | Slowest |
|---|---|---:|---:|
| Dealer admin | Company overview | 0.15 s | 0.18 s |
| Dealer admin | Company overview sorted by Autopay | 0.18 s | 0.19 s |
| Dealer admin | Search 1,000 stores | 0.13 s | 0.16 s |
| Dealer admin | Territory overview | 0.06 s | 0.06 s |
| Dealer admin | Market overview | 0.05 s | 0.05 s |
| Dealer admin | District overview | 0.04 s | 0.04 s |
| Dealer admin | Store card | 0.05 s | 0.05 s |
| Dealer admin | Rep card | 0.04 s | 0.04 s |
| Dealer admin | KPI report: 1,000 stores (page 1) | 0.07 s | 0.08 s |
| Dealer admin | KPI report: 1,000 stores (page 20) | 0.08 s | 0.08 s |
| Dealer admin | KPI report: stores sorted by Autopay | 0.08 s | 0.10 s |
| Dealer admin | KPI report: 25 KPIs × 1,000 stores | 0.10 s | 0.10 s |
| Dealer admin | KPI report: ~11,000 reps sorted | 0.24 s | 0.26 s |
| Dealer admin | KPI report: 25 KPIs × 11,000 reps | 0.42 s | 0.46 s |
| Dealer admin | Rankings: stores | 0.04 s | 0.04 s |
| Dealer admin | Rankings: stores by % of goal | 0.19 s | 0.20 s |
| Dealer admin | Rankings: 11,000 reps by Autopay | 0.09 s | 0.10 s |
| Dealer admin | Rankings: reps page 50 | 0.08 s | 0.09 s |
| Dealer admin | Opportunities: company | 0.22 s | 0.24 s |
| Dealer admin | Opportunities: district | 0.03 s | 0.04 s |
| Dealer admin | Opportunities: store | 0.04 s | 0.04 s |
| Dealer admin | Upload page | 0.01 s | 0.02 s |
| Dealer admin | Import history | 0.02 s | 0.03 s |
| Dealer admin | Import detail | 0.01 s | 0.02 s |
| Dealer admin | Settings: users | 0.02 s | 0.03 s |
| Dealer admin | Settings: people (10,000+) | 0.09 s | 0.11 s |
| Dealer admin | Settings: people search | 0.02 s | 0.03 s |
| Dealer admin | Settings: store goals | 0.06 s | 0.09 s |
| Dealer admin | Settings: rate targets | 0.02 s | 0.02 s |
| Dealer admin | Settings: change history | 0.02 s | 0.03 s |
| Territory manager | Home (territory) | 0.04 s | 0.05 s |
| Territory manager | KPI report: their stores | 0.07 s | 0.08 s |
| Territory manager | Rankings: their reps | 0.03 s | 0.04 s |
| Territory manager | Opportunities | 0.06 s | 0.08 s |
| District manager | Home (district) | 0.03 s | 0.03 s |
| District manager | Store card | 0.03 s | 0.04 s |
| District manager | KPI report: reps | 0.04 s | 0.05 s |
| District manager | Rankings: stores | 0.02 s | 0.02 s |
| District manager | Opportunities | 0.03 s | 0.04 s |
| Store manager | Home (store card) | 0.04 s | 0.04 s |
| Store manager | KPI report: reps | 0.03 s | 0.04 s |
| Store manager | Opportunities | 0.03 s | 0.04 s |
| Rep | Own card | 0.04 s | 0.04 s |

**25 people at once:** all done in 1.27 s; typical 1.12 s, slowest 1.27 s, 0 errors.

**Daily upload, 1,000 stores (7 files):** 11.2 s from upload to saved, in the background (done).

Machine: a small shared cloud container (4 CPUs), app and database on the same box.

## In a real browser (page fully drawn)

| Page | Time |
|---|---:|
| Company overview | 0.18 s |
| KPI report, 1,000 stores | 0.22 s |
| KPI report, 25 KPIs × 11,000 reps | 0.47 s |
| Rankings, 11,000 reps | 0.17 s |
| Opportunities | 0.25 s |
| Store card | 0.11 s |
| Open the KPI checklist (93 KPIs) | 0.11 s |

## While a 1,000-store upload is running

| Setup | Typical page | Slowest page |
|---|---:|---:|
| Import worker inside the web server (local default) | 0.14 s | 1.19 s |
| Import worker as its own process (`IMPORT_WORKER=off` + `npm run worker`) | 0.13 s | 0.29 s |

Reading big Excel files is heavy work, so when the app is hosted the import worker runs as its own process.

## What was fixed

- **Rankings by % of today's goal** added up goals one store at a time (0.43 s). It now adds them up in one pass (0.19 s).

## How to re-run

```bash
npm run db:extend-history -- --dealer pacific-coast   # once: grow the demo to 12 months
npm run samples -- --dealer pacific-coast --date 2026-10-30
npm run build && npm start                            # in another terminal
npm run speed-test
```
