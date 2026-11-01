import { Pager } from "@/components/ui";
import { withDealer } from "@/lib/db";
import { requireAccess } from "@/lib/auth/access";
import { withParams } from "@/lib/links";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

const ACTIONS: Record<string, string> = {
  "import.uploaded": "Uploaded files", "import.saved": "Import saved", "import.cancelled": "Import cancelled",
  "import.saved_despite_mismatches": "Saved despite mismatches", "import.held_stores_saved": "Held stores saved anyway",
  "person.hidden": "Hid from rep views", "person.shown": "Showed in rep views again", "person.combined": "Combined people",
  "goals.changed": "Changed store goals", "goals.copied": "Copied goals", "targets.changed": "Changed rate targets",
  "company.changed": "Changed company settings", "report.saved": "Saved a report", "report.deleted": "Deleted a report",
  "demo.seeded": "Sample data created", "user.login": "Logged in", "user.added": "Added a login",
  "user.password_reset": "Reset a password", "user.password_changed": "Changed own password",
  "user.deactivated": "Turned a login off", "user.reactivated": "Turned a login back on",
};

function summary(action: string, d: Record<string, unknown>): string {
  if (action === "person.combined") {
    const kept = d.kept as { display_name: string } | undefined;
    const combined = (d.combined as { display_name: string }[] | undefined) ?? [];
    return `${combined.map((c) => c.display_name).join(", ")} → ${kept?.display_name}`;
  }
  if (action.startsWith("person.")) return String(d.name ?? "");
  if (action === "goals.changed" || action === "targets.changed") return `${d.count} change(s) for ${String(d.month).slice(0, 7)}`;
  if (action === "goals.copied") return `${d.count} goals from ${String(d.from).slice(0, 7)} to ${String(d.to).slice(0, 7)}`;
  if (action === "import.saved") return `Numbers through ${d.biz_date}: ${d.stores} stores${d.held ? `, ${d.held} held` : ""}`;
  if (action === "import.uploaded") return `${(d.files as string[] | undefined)?.length ?? 0} files`;
  if (action === "import.held_stores_saved") return `Stores ${(d.stores as string[]).join(", ")}`;
  if (action.startsWith("report.")) return String(d.name ?? "");
  if (action.startsWith("user.")) return String(d.email ?? d.ip ?? "");
  return "";
}

/** Every upload and settings change, newest first. */
export default async function History({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }) {
  const { slug } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { dealer } = await requireAccess(slug, { admin: true });
  const rows = await withDealer(dealer.id, (sql) => sql<{ id: number; action: string; details: Record<string, unknown>; at: Date; who: string | null; total: number }[]>`
    select a.id, a.action, a.details, a.at, u.full_name as who, count(*) over ()::int as total
      from audit_log a left join users u on u.id = a.user_id
     order by a.at desc, a.id desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`);
  const total = rows[0]?.total ?? 0;
  return (
    <div>
      <p className="text-sm text-gray-600">Every login, upload and settings change, and who did it.</p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Details</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" })}</td>
                <td className="px-3 py-2 text-gray-600">{r.who ?? "–"}</td>
                <td className="px-3 py-2 font-medium">{ACTIONS[r.action] ?? r.action}</td>
                <td className="px-3 py-2 text-gray-600">{summary(r.action, r.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} noun="changes"
        href={(p) => withParams(`/d/${slug}/settings/history`, { page: p })} />
    </div>
  );
}
