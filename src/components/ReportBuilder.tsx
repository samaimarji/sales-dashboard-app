"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

interface KpiOption { code: string; label: string; category: string; description?: string }

/**
 * The KPI checklist: pick any KPIs from all 7 files, choose what each row is
 * (stores, districts, reps...), then show it or save it as a named report.
 */
export default function ReportBuilder({ slug, unitId, kpis, selected, level, levels, reportName, canDelete, canShare, reportId, color }: {
  slug: string; unitId: number; kpis: KpiOption[]; selected: string[]; level: string;
  levels: { key: string; label: string }[]; reportName: string; canDelete: boolean; canShare: boolean; reportId: number | null; color: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(selected);
  const [rowLevel, setRowLevel] = useState(level);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const out = new Map<string, KpiOption[]>();
    for (const k of kpis) {
      if (f && !k.label.toLowerCase().includes(f) && !k.category.toLowerCase().includes(f)) continue;
      (out.get(k.category) ?? out.set(k.category, []).get(k.category)!).push(k);
    }
    return [...out];
  }, [kpis, filter]);

  const toggle = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));
  const move = (code: string, d: -1 | 1) => setPicked((p) => {
    const i = p.indexOf(code);
    const j = i + d;
    if (j < 0 || j >= p.length) return p;
    const n = [...p];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const label = (code: string) => kpis.find((k) => k.code === code)?.label ?? code;

  function apply() {
    const q = new URLSearchParams({ unit: String(unitId), level: rowLevel, kpis: picked.join(",") });
    router.push(`/d/${slug}/report?${q}`);
    setOpen(false);
  }

  async function save() {
    const name = window.prompt("Name this report", reportName === "Custom report" ? "" : reportName);
    if (!name) return;
    const shared = canShare && window.confirm("Share this report with everyone at the company?\n\nOK = everyone sees it · Cancel = only you");
    setBusy(true);
    const res = await fetch(`/api/d/${slug}/reports`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, level: rowLevel, kpis: picked, shared }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(body.error ?? "Couldn't save.");
    router.push(`/d/${slug}/report?unit=${unitId}&report=${body.id}`);
    setOpen(false);
  }

  async function remove() {
    if (!reportId || !window.confirm(`Delete the report "${reportName}"?`)) return;
    await fetch(`/api/d/${slug}/reports?id=${reportId}`, { method: "DELETE" });
    router.push(`/d/${slug}/report?unit=${unitId}`);
  }

  return (
    <div className="print:hidden">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setOpen(!open)} className="rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ background: color }}>
          {open ? "Close KPI list" : "Choose KPIs"}
        </button>
        <button onClick={save} disabled={busy || !picked.length} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium">
          Save as report
        </button>
        {canDelete && <button onClick={remove} className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-red-600">Delete report</button>}
        {msg && <span className="text-sm text-red-600">{msg}</span>}
      </div>

      {open && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4" data-testid="kpi-checklist">
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">One row per
              <select value={rowLevel} onChange={(e) => setRowLevel(e.target.value)} className="ml-2 rounded-md border border-gray-300 px-2 py-1">
                {levels.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </label>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search KPIs…"
              className="w-56 rounded-md border border-gray-300 px-3 py-1 text-sm" />
            <span className="text-sm text-gray-500">{picked.length} chosen</span>
            <button onClick={apply} disabled={!picked.length} className="ml-auto rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>
              Show report
            </button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
            <div className="grid max-h-[420px] grid-cols-1 gap-x-6 gap-y-4 overflow-y-auto pr-2 sm:grid-cols-2 xl:grid-cols-3">
              {groups.map(([cat, list]) => (
                <fieldset key={cat}>
                  <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">{cat}</legend>
                  {list.map((k) => (
                    <label key={k.code} className="mt-1 flex items-start gap-2 text-sm" title={k.description}>
                      <input type="checkbox" checked={picked.includes(k.code)} onChange={() => toggle(k.code)} className="mt-0.5" />
                      {k.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Column order</div>
              <ol className="mt-2 space-y-1 text-sm">
                {picked.map((c, i) => (
                  <li key={c} className="flex items-center justify-between gap-1">
                    <span className="truncate">{i + 1}. {label(c)}</span>
                    <span className="flex shrink-0 gap-1 text-gray-400">
                      <button onClick={() => move(c, -1)} aria-label="Move up" className="hover:text-gray-700">↑</button>
                      <button onClick={() => move(c, 1)} aria-label="Move down" className="hover:text-gray-700">↓</button>
                      <button onClick={() => toggle(c)} aria-label="Remove" className="hover:text-red-600">✕</button>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
