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
/** A file of a room: from the site's own files (the demo), else from the processing server (visitors' rooms). */
export async function roomFile(env: Env & { ROOMIE_UPLOAD_TOKEN?: string }, req: Request, id: string, path: string) {
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error("bad room id");
  const own = await env.ASSETS.fetch(new URL(`/rooms/${id}/${path}`, req.url));
  // a missing file comes back as the app's index.html (single-page fallback)
  if (own.ok && !own.headers.get("content-type")?.includes("text/html")) return own;
  const origin = await env.LIMITS?.get("processor_origin");
  if (!origin || !env.ROOMIE_UPLOAD_TOKEN) return new Response("not found", { status: 404 });
  return fetch(`${origin}/rooms/${id}/${path}`, { headers: { "x-roomie-token": env.ROOMIE_UPLOAD_TOKEN } });
}
export const loadRoom = async (env: Env, req: Request, id: string) => {
  const res = await roomFile(env, req, id, "room.json");
  if (!res.ok) throw new Error(`room ${id}: ${res.status}`);
  return res.json<Room>();
};
export const loadCatalog = (env: Env, req: Request) => asset<Product[]>(env, req, "/catalog.json");

/** Daily counters per visitor and overall, so public use can't drain the Meta credits. */
export async function underLimit(env: Env, req: Request, kind: "chat" | "photo" | "upload", perIp: number, total: number) {
  if (!env.LIMITS) return true; // local dev without KV
  const day = new Date().toISOString().slice(0, 10);
  const ip = req.headers.get("cf-connecting-ip") ?? "local";
  const keys = [`${kind}:${day}:${ip}`, `${kind}:${day}:all`];
  try {
    const [mine, all] = await Promise.all(keys.map(async (k) => Number((await env.LIMITS!.get(k)) ?? 0)));
    if (mine >= perIp || all >= total) return false;
    await Promise.all([env.LIMITS.put(keys[0], String(mine + 1), { expirationTtl: 172800 }), env.LIMITS.put(keys[1], String(all + 1), { expirationTtl: 172800 })]);
  } catch {
    // KV's free plan allows 1,000 writes a day: past that the counters can't count, so let the request through
    // rather than fail it; the Meta account's credit stays the real ceiling. Modal keeps its own upload cap.
  }
  return true;
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });
