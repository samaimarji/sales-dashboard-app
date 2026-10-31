import { getDealer } from "@/lib/dealers";
import { FILE_TYPES } from "@/lib/imports/file-types";
import UploadForm from "@/components/UploadForm";

export default async function UploadPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dealer = (await getDealer(slug))!;
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Daily upload</h1>
      <p className="mt-1 text-sm text-gray-600">
        Drag in the day&apos;s Power BI exports. Each file is recognized by its column headers, so file names don&apos;t matter.
        Uploading the same day again replaces that day.
      </p>
      <UploadForm slug={slug} color={dealer.primary_color} />
      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <h2 className="font-medium">The 7 files</h2>
        <ul className="mt-2 grid grid-cols-1 gap-1 text-gray-600 sm:grid-cols-2">
          {FILE_TYPES.map((f) => <li key={f.type}>• {f.label}{f.type === "mtd" ? " (required)" : ""}</li>)}
        </ul>
      </div>
    </main>
  );
}
