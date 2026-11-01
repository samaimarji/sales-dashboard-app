# Putting Dealer Dashboard online with Railway

About 20 minutes of clicking, then about 8 minutes of waiting. You create the account and type every password yourself.
Nothing here needs a command line.

**Cost:** Railway Hobby plan, $5/month (includes $5 of usage), plus usage above that. Expect about $10–25/month
for the demo. Step 2 caps it.

---

## 1. Create your Railway account

1. Go to **railway.com** and click **Login → Login with GitHub**. Use the GitHub account that owns `sales-dashboard-app`.
2. Pick the **Hobby** plan and add a payment card.

## 2. Cap the bill

1. Open your **workspace settings → Usage**.
2. Set a **hard limit** of **$30**. Railway stops the app instead of charging more. You can raise it later.

## 3. Create the project from GitHub

1. Click **New Project → Deploy from GitHub repo**.
2. If asked, let Railway see **only** the `sales-dashboard-app` repository.
3. Pick **samaimarji/sales-dashboard-app**.

Railway starts a first deploy. **It will fail. That's expected:** it has no database or settings yet.

## 4. Add the database

1. In the project, click **+ Create** (or **+ New**) → **Database** → **PostgreSQL**.
2. Wait until it shows as running. It's called **Postgres**.

## 5. Add the app's settings

1. Click the **sales-dashboard-app** box.
2. Open **Variables → Raw Editor** and paste this:

```
DATABASE_ADMIN_URL=${{Postgres.DATABASE_URL}}
APP_DB_PASSWORD=
ADMIN_EMAIL=
ADMIN_NAME=
ADMIN_PASSWORD=
DEMO_PASSWORD=
SEED_DEMO=1
```

3. Fill in the blanks yourself:

| Setting | What to type |
|---|---|
| `APP_DB_PASSWORD` | Any long random text (25+ letters and numbers). The app uses it to reach its database. You never need to remember it. |
| `ADMIN_EMAIL` | The email you'll log in with. |
| `ADMIN_NAME` | Your name as it should appear in the app's menu. |
| `ADMIN_PASSWORD` | Your first password: 10+ characters, letters with numbers or symbols. You'll change it after logging in. |
| `DEMO_PASSWORD` | One shared password for the demo logins (district manager, rep…) that you'll use when you demo. Make it different from yours. |

4. Leave the first line exactly as it is: `${{Postgres.DATABASE_URL}}` tells Railway to fill in the database address.
5. Click **Update Variables**. Railway redeploys on its own.

## 6. Give it a web address

1. In the same box, open **Settings → Networking → Generate Domain**.
2. You get an address like `sales-dashboard-app-production.up.railway.app`. That's your demo link.

## 7. Wait for it to finish

1. Open **Deployments**, click the newest one, then open **Deploy Logs**.
2. Within about 2 minutes you'll see `[bootstrap] Created platform admin …`. The site works from here.
3. After about 5–8 minutes you'll see `[bootstrap] Demo data ready.` Both made-up dealers are now loaded.

## 8. Log in and lock the door behind you

1. Open your web address and log in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
2. Click **Account** and change your password.
3. Back in Railway **Variables**, **delete `ADMIN_PASSWORD`** (it was only needed once), and set **`SEED_DEMO`** to `0`.

## 9. Check it

- **Your view:** you see both dealers. Open **Pacific Coast Mobile** and click through Overview, KPI report, Rankings and Opportunities.
- **A district manager's view:** in a private/incognito window, log in as `district@pacific-coast.demo` with your `DEMO_PASSWORD`. It should only show one district.
- **A rep's view:** log in as `rep@pacific-coast.demo`. It should only show one rep card.

---

## After this

- **Updates are automatic.** Every time a change is saved to GitHub (`main`), Railway rebuilds and redeploys in a few minutes.
- **Costs** are under **workspace → Usage**.
- **If something fails,** copy the last ~30 lines of **Deploy Logs** and paste them to Claude. Passwords never appear in the logs.
- **Real data:** the two demo dealers use made-up names. Before uploading Spacetel's real files, we'll create a separate,
  private dealer for it and add only the logins you choose.

## What's running (for the technically curious)

One Railway service (`npm run start:all`) runs the website and the import worker as two separate programs. A first-start
step (`scripts/bootstrap.ts`) creates the admin login and the demo data. Before each deploy, the database is updated
(`npm run db:migrate`) and the app's restricted database role gets `APP_DB_PASSWORD`. Uploaded files are kept in the
database. Settings are in `railway.json`.
