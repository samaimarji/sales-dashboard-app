import { NextResponse } from "next/server";
import { getDealer } from "@/lib/dealers";
import { releaseHeldStores } from "@/lib/imports/process";

/** "Save anyway" for held stores: body {"stores": ["1001", ...]} or {"stores": "all"}. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const dealer = await getDealer(slug);
  if (!dealer) return NextResponse.json({ error: "Dealer not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const stores = body.stores === "all" ? "all" : Array.isArray(body.stores) ? body.stores.map(String) : null;
  if (!stores) return NextResponse.json({ error: "Say which stores to save." }, { status: 400 });
  try {
    const saved = await releaseHeldStores(dealer.id, Number(id), stores, null);
    return NextResponse.json({ saved });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
