"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function UploadForm({ slug, color }: { slug: string; color: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [date, setDate] = useState(yesterday);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const add = (list: FileList | null) => {
    if (!list) return;
    const incoming = [...list].filter((f) => /\.(xlsx|csv)$/i.test(f.name));
    setFiles((cur) => [...cur.filter((c) => !incoming.some((n) => n.name === c.name)), ...incoming]);
    if (incoming.length < list.length) setError("Only .xlsx and .csv files can be uploaded.");
    else setError("");
  };

  async function submit() {
    setBusy(true);
    setError("");
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    form.append("date", date);
    const res = await fetch(`/api/d/${slug}/imports`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Upload failed.");
      setBusy(false);
      return;
    }
    router.push(`/d/${slug}/imports/${body.id}`);
  }

  return (
    <div className="mt-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-white px-6 py-12 text-center transition ${over ? "border-gray-500 bg-gray-50" : "border-gray-300"}`}
      >
        <p className="text-base font-medium">Drop the Excel files here</p>
        <p className="mt-1 text-sm text-gray-500">or click to choose them</p>
        <input ref={input} type="file" multiple accept=".xlsx,.csv" className="hidden" data-testid="file-input"
          onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
          {files.map((f) => (
            <li key={f.name} className="flex items-center justify-between px-3 py-2">
              <span>{f.name} <span className="text-gray-400">({Math.ceil(f.size / 1024).toLocaleString()} KB)</span></span>
              <button className="text-gray-400 hover:text-red-600" onClick={() => setFiles(files.filter((x) => x !== f))}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="block text-gray-600">Numbers through</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 rounded-md border border-gray-300 bg-white px-3 py-1.5" />
        </label>
        <p className="max-w-sm text-xs text-gray-500">Used only if the files don&apos;t say. Power BI&apos;s &quot;Applied filters&quot; note wins.</p>
        <button disabled={!files.length || busy} onClick={submit}
          className="ml-auto rounded-md px-5 py-2 text-sm font-medium text-white disabled:opacity-40" style={{ background: color }}>
          {busy ? "Uploading…" : `Upload ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
