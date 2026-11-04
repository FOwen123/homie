// Hands the website a short-lived signed ticket so the processing server only takes uploads that came through this site.
import { type Env, json, underLimit } from "../_lib";

type TicketEnv = Env & { ROOMIE_UPLOAD_TOKEN: string };

export const onRequestPost: PagesFunction<TicketEnv> = async ({ request, env }) => {
  if (!(await underLimit(env, request, "upload", 2, 20))) return json({ error: "busy" }, 429);
  const origin = await env.LIMITS?.get("processor_origin");
  if (!origin) return json({ error: "offline" }, 503);
  const exp = Math.floor(Date.now() / 1000) + 900;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ROOMIE_UPLOAD_TOKEN), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(exp))));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  return json({ url: `${origin}/upload-video`, ticket: `${exp}.${hex}` });
};
