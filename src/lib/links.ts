/** Where a click on an org unit or a rep goes. */
export const unitHref = (slug: string, u: { id: number; level_key: string }) =>
  u.level_key === "store" ? `/d/${slug}/store/${u.id}` : `/d/${slug}?unit=${u.id}`;

export const repHref = (slug: string, personId: number) => `/d/${slug}/rep/${personId}`;

export function withParams(base: string, params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}
