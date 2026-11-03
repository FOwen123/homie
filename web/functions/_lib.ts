// Shared helpers for the Cloudflare Pages Functions.
import type { Product, Room } from "../src/lib/types";

export type Env = { META_MODEL_API_KEY: string; ASSETS: Fetcher; LIMITS?: KVNamespace };
export const API = "https://api.meta.ai/v1";

export async function meta(env: Env, path: string, body: unknown) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.META_MODEL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json<any>();
}

const asset = async <T,>(env: Env, req: Request, path: string): Promise<T> => {
  const res = await env.ASSETS.fetch(new URL(path, req.url));
  if (!res.ok) throw new Error(`asset ${path}: ${res.status}`);
  return res.json<T>();
};
export const loadRoom = (env: Env, req: Request, id: string) => {
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error("bad room id");
  return asset<Room>(env, req, `/rooms/${id}/room.json`);
};
export const loadCatalog = (env: Env, req: Request) => asset<Product[]>(env, req, "/catalog.json");

/** Daily counters per visitor and overall, so public use can't drain the Meta credits. */
export async function underLimit(env: Env, req: Request, kind: "chat" | "photo" | "upload", perIp: number, total: number) {
  if (!env.LIMITS) return true; // local dev without KV
  const day = new Date().toISOString().slice(0, 10);
  const ip = req.headers.get("cf-connecting-ip") ?? "local";
  const keys = [`${kind}:${day}:${ip}`, `${kind}:${day}:all`];
  const [mine, all] = await Promise.all(keys.map(async (k) => Number((await env.LIMITS!.get(k)) ?? 0)));
  if (mine >= perIp || all >= total) return false;
  await Promise.all([env.LIMITS.put(keys[0], String(mine + 1), { expirationTtl: 172800 }), env.LIMITS.put(keys[1], String(all + 1), { expirationTtl: 172800 })]);
  return true;
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });
