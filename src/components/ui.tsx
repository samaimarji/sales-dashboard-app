import Link from "next/link";
import { KPI_BY_CODE } from "@/lib/kpis/catalog";
import { STATUS_BAR, STATUS_CLASS, STATUS_LABEL, type Evaluation, type Status } from "@/lib/kpis/pace";
import { formatKpi, isVolume } from "@/lib/kpis/value";
import { unitName, type Unit } from "@/lib/org";

export function Crumbs({ crumbs, href, labels }: { crumbs: Unit[]; href: (u: Unit) => string; labels: Record<string, string> }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm print:hidden">
      {crumbs.map((c, i) => (
        <span key={c.id} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-400">›</span>}
          <Link href={href(c)} title={labels[c.level_key]}
            className={i === crumbs.length - 1 ? "font-semibold text-gray-900" : "text-gray-600 hover:underline"}>
            {unitName(c)}
          </Link>
        </span>
      ))}
    </nav>
  );
}

export function StatusPill({ status, pct }: { status: Status; pct?: number }) {
  if (status === "none") return <span className="text-xs text-gray-400">No goal</span>;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}{pct !== undefined ? ` · ${Math.round(pct * 100)}%` : ""}
    </span>
  );
}

export function ProgressBar({ e }: { e: Evaluation }) {
  if (e.pct === undefined) return <div className="h-2 rounded-full bg-gray-100" />;
  const width = Math.min(100, Math.max(2, e.pct * 100 / 1.5));
  return (
    <div className="relative h-2 rounded-full bg-gray-100" title={`${Math.round(e.pct * 100)}% of today's target`}>
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: STATUS_BAR[e.status] }} />
      {/* tick mark = today's target (100%) */}
      <div className="absolute -top-0.5 h-3 w-px bg-gray-500" style={{ left: `${100 / 1.5}%` }} />
    </div>
  );
}

/** A big number with its goal and pace, like the cards on the Store Card sheet. */
export function KpiTile({ code, e }: { code: string; e: Evaluation }) {
  const label = KPI_BY_CODE[code]?.label ?? code;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{formatKpi(code, e.actual)}</div>
      <div className="mt-1 min-h-[2rem] text-xs text-gray-500">
        {e.goal === undefined ? "No goal set"
          : isVolume(code) ? <>Should be {formatKpi(code, e.target)} today · goal {formatKpi(code, e.goal)}</>
          : <>Target {formatKpi(code, e.goal)}</>}
      </div>
      <div className="mt-2"><StatusPill status={e.status} pct={e.pct} /></div>
    </div>
  );
}

/** Background color for a table cell, by pace. */
export const cellClass = (s: Status) =>
  s === "ahead" ? "bg-blue-50 text-blue-800" : s === "on" ? "bg-green-50 text-green-800"
    : s === "close" ? "bg-orange-50 text-orange-800" : s === "behind" ? "bg-red-50 text-red-700" : "";

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 print:hidden">
      <span>Colors vs. today&apos;s pace:</span>
      <span className="rounded bg-blue-50 px-1.5 text-blue-800">150%+</span>
      <span className="rounded bg-green-50 px-1.5 text-green-800">on pace</span>
      <span className="rounded bg-orange-50 px-1.5 text-orange-800">close (70%+)</span>
      <span className="rounded bg-red-50 px-1.5 text-red-700">behind</span>
    </div>
  );
}

export function Pager({ page, pages, total, noun, href }: { page: number; pages: number; total: number; noun: string; href: (p: number) => string }) {
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-gray-600 print:hidden">
      <span>{total.toLocaleString()} {noun} · page {page} of {pages}</span>
      <span className="flex gap-3">
        {page > 1 && <Link className="hover:underline" href={href(page - 1)}>← Previous</Link>}
        {page < pages && <Link className="hover:underline" href={href(page + 1)}>Next →</Link>}
      </span>
    </div>
  );
}

/** Daily sales bars for the month (from the day-to-day change in month-to-date numbers). */
export function TrendBars({ days, code, color }: { days: { date: string; value: number }[]; code: string; color: string }) {
  if (!days.length) return null;
  const max = Math.max(1, ...days.map((d) => d.value));
  const W = 640, H = 120, gap = 3;
  const bw = (W - gap * (days.length - 1)) / days.length;
  const avg = days.reduce((a, d) => a + d.value, 0) / days.length;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-medium">{KPI_BY_CODE[code]?.label} per day this month</div>
        <div className="text-xs text-gray-500">average {formatKpi(code, avg)} a day</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="mt-2 w-full" role="img" aria-label="Daily trend">
        {days.map((d, i) => {
          const h = (d.value / max) * H;
          return (
            <g key={d.date}>
              <rect x={i * (bw + gap)} y={H - h} width={bw} height={Math.max(h, 1)} rx={2} fill={color} opacity={0.85}>
                <title>{`${d.date}: ${formatKpi(code, d.value)}`}</title>
              </rect>
              {(i === 0 || (i + 1) % 5 === 0) && (
                <text x={i * (bw + gap) + bw / 2} y={H + 13} fontSize="10" textAnchor="middle" fill="#6b7280">{Number(d.date.slice(8))}</text>
              )}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={H - (avg / max) * H} y2={H - (avg / max) * H} stroke="#6b7280" strokeDasharray="4 3" strokeWidth={1} />
      </svg>
    </div>
  );
}

/** Turns a month of month-to-date snapshots into daily amounts. */
export function dailyFromMtd(rows: { biz_date: Date; v: string | number | null }[]): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  let prev = 0;
  for (const r of rows) {
    const v = Number(r.v ?? 0);
    out.push({ date: r.biz_date.toISOString().slice(0, 10), value: Math.max(0, v - prev) });
    prev = v;
  }
  return out;
}
