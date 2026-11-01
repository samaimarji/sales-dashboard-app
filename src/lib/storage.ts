import { adminSql } from "@/lib/db";

/**
 * Where uploaded files (and their parsed copies) are kept: a table in the database,
 * so hosting needs no separate file storage. Keys look like "batches/12/1-MTD.xlsx".
 */
export async function putFile(key: string, data: Buffer | string) {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  await adminSql`
    insert into file_blobs (key, data, size_bytes) values (${key}, ${buf}, ${buf.length})
    on conflict (key) do update set data = excluded.data, size_bytes = excluded.size_bytes, created_at = now()`;
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  const [row] = await adminSql<{ data: Buffer }[]>`select data from file_blobs where key = ${key}`;
  if (!row) throw new Error(`File not found: ${key}`);
  return row.data;
}
