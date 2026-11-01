import { withDealer } from "@/lib/db";
import { getDealer } from "@/lib/dealers";
import { saveCompany } from "../actions";

export const dynamic = "force-dynamic";

/** Name, colors, logo and what this dealer calls each level of its org tree. */
export default async function CompanySettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dealer = (await getDealer(slug))!;
  const levels = await withDealer(dealer.id, (sql) => sql<{ level_key: string; label: string; enabled: boolean }[]>`
    select level_key, label, enabled from dealer_org_levels order by depth`);
  const input = "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm";
  return (
    <form action={saveCompany} className="max-w-2xl space-y-6">
      <input type="hidden" name="slug" value={slug} />
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold">Branding</h2>
        <label className="mt-3 block text-sm">Company name<input name="name" defaultValue={dealer.name} className={input} /></label>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <label className="block text-sm">Main color<input type="color" name="primary_color" defaultValue={dealer.primary_color} className="mt-1 block h-9 w-20" /></label>
          <label className="block text-sm">Second color<input type="color" name="accent_color" defaultValue={dealer.accent_color} className="mt-1 block h-9 w-20" /></label>
        </div>
        <label className="mt-3 block text-sm">Logo web address (optional)
          <input name="logo_url" defaultValue={dealer.logo_url ?? ""} placeholder="https://…/logo.png" className={input} />
        </label>
        <p className="mt-1 text-xs text-gray-500">Logo upload comes with hosting; for now paste a link to an image.</p>
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold">Level names</h2>
        <p className="mt-1 text-sm text-gray-600">What your company calls each level. Every screen uses these names.</p>
        <div className="mt-3 space-y-2">
          {levels.map((l) => (
            <label key={l.level_key} className="flex items-center gap-3 text-sm">
              <span className="w-28 text-gray-500">{l.level_key === "dealer" ? "Top" : l.level_key[0].toUpperCase() + l.level_key.slice(1)}</span>
              <input name={`label:${l.level_key}`} defaultValue={l.label} disabled={!l.enabled} className="w-56 rounded-md border border-gray-300 bg-white px-3 py-1.5 disabled:bg-gray-50 disabled:text-gray-400" />
              {!l.enabled && <span className="text-xs text-gray-400">not used</span>}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">Turning a level on or off moves stores around, so it&apos;s done during setup, not here.</p>
      </section>
      <button className="rounded-md px-4 py-2 text-sm font-medium text-white" style={{ background: dealer.primary_color }}>Save</button>
    </form>
  );
}
