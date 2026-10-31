import { getDealer } from "@/lib/dealers";
import ImportStatus from "@/components/ImportStatus";

export default async function ImportPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const dealer = (await getDealer(slug))!;
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <ImportStatus slug={slug} id={Number(id)} color={dealer.primary_color} />
    </main>
  );
}
