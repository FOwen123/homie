// The iPhone app uploads a capture here (stable URL). We forward it to whichever processing server is
// registered in KV under "processor_origin" (tonight: the Mac via a Cloudflare tunnel; later: Modal).
import { type Env, json, underLimit } from "../_lib";

type UpEnv = Env & { ROOMIE_UPLOAD_TOKEN: string };

export const onRequestPost: PagesFunction<UpEnv> = async ({ request, env }) => {
  if (!(await underLimit(env, request, "upload", 3, 20))) return json({ error: "busy" }, 429);
  const origin = await env.LIMITS?.get("processor_origin");
  if (!origin) return json({ error: "processing is offline, try again later" }, 503);
  const res = await fetch(`${origin}/upload`, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "", "x-roomie-token": env.ROOMIE_UPLOAD_TOKEN },
    body: request.body,
  });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
};
