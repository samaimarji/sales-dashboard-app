import { cache } from "react";
import { adminSql } from "@/lib/db";

export interface Dealer {
  id: number;
  slug: string;
  name: string;
  primary_color: string;
  accent_color: string;
  logo_url: string | null;
}

/** Looks up a dealer by its web address name (e.g. "pacific-coast"). */
export const getDealer = cache(async (slug: string): Promise<Dealer | null> => {
  const [d] = await adminSql<Dealer[]>`
    select id, slug, name, primary_color, accent_color, logo_url from dealers where slug = ${slug}`;
  return d ?? null;
});
