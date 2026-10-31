import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Where uploaded files are kept. A local folder for now; swapping in cloud storage
 * later only changes this file.
 */
const ROOT = resolve(process.env.STORAGE_DIR ?? "storage");

export async function putFile(key: string, data: Buffer | string) {
  const path = join(ROOT, key);
  if (!path.startsWith(ROOT)) throw new Error("Invalid storage key");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  const path = join(ROOT, key);
  if (!path.startsWith(ROOT)) throw new Error("Invalid storage key");
  return readFile(path);
}
