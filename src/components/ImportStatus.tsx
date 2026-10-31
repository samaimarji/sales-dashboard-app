"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Check { key: string; label: string; status: "pass" | "fail" | "skipped"; compared: number; mismatches: number; note?: string }
interface Data {
  batch: {
    id: number; biz_date: string; status: string; progress: number; error: string | null; date_source: string | null;
    summary: {
      checks?: Check[]; issue_counts?: { error: number; warning: number; info: number };
      stores?: number; reps?: number; saved?: { reps: number; stores: number; newStores: number; newPeople: number };
    };
  };
  files: { id: number; original_name: string; file_type: string | null; row_count: number | null; detected_date: string | null; status: string; message: string | null }[];
  issues: { severity: string; check_name: string; message: string }[];
  issueTotal: number;
  page: number;
  pageSize: number;
}

const STAGES: Record<string, string> = {
  queued: "Waiting to start…", reading: "Reading files…", checking: "Running checks…", saving: "Saving…",
  done: "Saved", needs_review: "Needs your review", failed: "Failed", cancelled: "Cancelled", replaced: "Replaced by a newer upload",
};
const RUNNING = new Set(["queued", "reading", "checking", "saving"]);
const FILE_LABELS: Record<string, string> = {
  mtd: "MTD Performance", rank: "Rank Export", matrix: "Detailed Matrix", fees: "Fees", retention: "Retention", chi: "CHI", features: "Features",
};
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "–";

export default function ImportStatus({ slug, id, color }: { slug: string; id: number; color: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [severity, setSeverity] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page), ...(severity ? { severity } : {}) });
    const res = await fetch(`/api/d/${slug}/imports/${id}?${q}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, [slug, id, severity, page]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!data || !RUNNING.has(data.batch.status)) return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [data, load]);

  async function act(action: "save" | "cancel") {
    setBusy(true);
    await fetch(`/api/d/${slug}/imports/${id}/${action}`, { method: "POST" });
    await load();
    setBusy(false);
  }

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  const { batch, files, issues, issueTotal } = data;
  const s = batch.summary;
  const counts = s.issue_counts;
  const running = RUNNING.has(batch.status);
  const barColor = batch.status === "failed" ? "#dc2626" : batch.status === "needs_review" ? "#d97706" : color;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Import #{batch.id}</h1>
        <Link href={`/d/${slug}/imports`} className="text-sm text-gray-500 hover:underline">All imports</Link>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Numbers through <b>{fmtDate(batch.biz_date)}</b>
        {batch.date_source === "file" ? " (from the files)" : batch.date_source === "chosen" ? " (date you picked)" : ""}
      </p>

      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium" data-testid="stage">{STAGES[batch.status] ?? batch.status}</span>
          <span className="text-gray-500">{batch.progress}%</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${batch.progress}%`, background: barColor }} />
        </div>
        {batch.status === "done" && s.saved && (
          <p className="mt-3 text-sm text-green-700">
            Saved {s.saved.stores.toLocaleString()} stores and {s.saved.reps.toLocaleString()} rep rows.
            {s.saved.newStores ? ` Added ${s.saved.newStores} new store(s).` : ""}
            {s.saved.newPeople ? ` Added ${s.saved.newPeople} new rep(s).` : ""}{" "}
            <Link href={`/d/${slug}`} className="underline">See the numbers →</Link>
          </p>
        )}
        {batch.status === "failed" && <p className="mt-3 text-sm text-red-600">Something went wrong: {batch.error}</p>}
        {batch.status === "needs_review" && (
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <p><b>Nothing has been saved yet.</b> The checks found {counts?.error} problem{counts?.error === 1 ? "" : "s"} (listed below).
              Fix the files and upload again, or save anyway if you know why the numbers differ.</p>
            <div className="mt-3 flex gap-2">
              <button disabled={busy} onClick={() => act("save")} className="rounded-md px-4 py-1.5 font-medium text-white" style={{ background: color }}>Save anyway</button>
              <button disabled={busy} onClick={() => act("cancel")} className="rounded-md border border-gray-300 bg-white px-4 py-1.5">Cancel import</button>
            </div>
          </div>
        )}
      </div>

      <h2 className="mt-8 font-semibold">Files</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-3 py-2">File</th><th className="px-3 py-2">Recognized as</th><th className="px-3 py-2 text-right">Rows</th><th className="px-3 py-2">Numbers through</th></tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-t border-gray-100">
                <td className="px-3 py-2">{f.original_name}</td>
                <td className="px-3 py-2">
                  {f.file_type ? <span className="text-green-700">✓ {FILE_LABELS[f.file_type]}</span>
                    : f.status === "pending" ? <span className="text-gray-400">…</span>
                    : <span className="text-red-600">✗ {f.message ?? "Not recognized"}</span>}
                </td>
                <td className="px-3 py-2 text-right">{f.row_count?.toLocaleString() ?? "–"}</td>
                <td className="px-3 py-2">{fmtDate(f.detected_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {s.checks && (
        <>
          <h2 className="mt-8 font-semibold">Checks</h2>
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
            {s.checks.map((c) => (
              <li key={c.key} className="flex items-center justify-between px-3 py-2">
                <span>
                  <span className={c.status === "pass" ? "text-green-700" : c.status === "fail" ? "text-red-600" : "text-gray-400"}>
                    {c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "–"}
                  </span>{" "}
                  {c.label}
                </span>
                <span className="text-gray-500">
                  {c.status === "skipped" ? c.note : c.status === "pass"
                    ? `${c.compared.toLocaleString()} stores match`
                    : `${c.mismatches.toLocaleString()} mismatch${c.mismatches === 1 ? "" : "es"} across ${c.compared.toLocaleString()} stores`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {counts && (counts.error + counts.warning + counts.info > 0) && (
        <>
          <div className="mt-8 flex items-center gap-2">
            <h2 className="font-semibold">Details</h2>
            {[["", "All"], ["error", `Problems (${counts.error})`], ["warning", `Warnings (${counts.warning})`], ["info", `Notes (${counts.info})`]].map(([v, l]) => (
              <button key={v} onClick={() => { setSeverity(v); setPage(1); }}
                className={`rounded-full px-3 py-0.5 text-xs ${severity === v ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-700"}`}>{l}</button>
            ))}
          </div>
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
            {issues.map((i, n) => (
              <li key={n} className="flex gap-3 px-3 py-2">
                <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${i.severity === "error" ? "bg-red-500" : i.severity === "warning" ? "bg-amber-400" : "bg-gray-300"}`} />
                <span>{i.message}</span>
              </li>
            ))}
          </ul>
          {issueTotal > data.pageSize && (
            <div className="mt-2 flex justify-between text-sm text-gray-600">
              <span>{issueTotal.toLocaleString()} items · page {page} of {Math.ceil(issueTotal / data.pageSize)}</span>
              <span className="flex gap-3">
                {page > 1 && <button onClick={() => setPage(page - 1)} className="hover:underline">← Previous</button>}
                {page * data.pageSize < issueTotal && <button onClick={() => setPage(page + 1)} className="hover:underline">Next →</button>}
              </span>
            </div>
          )}
        </>
      )}
      {running && <p className="mt-6 text-xs text-gray-400">You can leave this page. The import keeps running in the background.</p>}
    </div>
  );
}
