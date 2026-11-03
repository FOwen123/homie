// Processing status for an uploaded room, read from the processing server registered in KV.
import { type Env, json } from "../../_lib";

export const onRequestGet: PagesFunction<Env & { ROOMIE_UPLOAD_TOKEN: string }> = async ({ params, env }) => {
  const id = String(params.id);
  if (!/^[a-z0-9]{4,40}$/.test(id)) return json({ error: "bad id" }, 400);
  const origin = await env.LIMITS?.get("processor_origin");
  if (!origin) return json({ state: "failed", error: "processing is offline" }, 503);
  const res = await fetch(`${origin}/status/${id}`, { headers: { "x-roomie-token": env.ROOMIE_UPLOAD_TOKEN } });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
};
