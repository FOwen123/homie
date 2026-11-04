// The iPhone app uploads a capture here (stable URL). We forward it to whichever processing server is
// registered in KV under "processor_origin" (tonight: the Mac via a Cloudflare tunnel; later: Modal).
import { type Env, json, underLimit } from "../_lib";

type UpEnv = Env & { ROOMIE_UPLOAD_TOKEN: string };
const MAX_BYTES = 300 * 1024 * 1024; // pipeline/modal_app.py MAX_VIDEO

export const onRequestPost: PagesFunction<UpEnv> = async ({ request, env }) => {
  if (!(await underLimit(env, request, "upload", 3, 20))) return json({ error: "busy" }, 429);
  const origin = await env.LIMITS?.get("processor_origin");
  if (!origin) return json({ error: "processing is offline, try again later" }, 503);
  // the processor needs the length up front (it refuses bodies it can't size before reading them)
  const len = Number(request.headers.get("content-length"));
  if (!request.body || !(len > 0)) return json({ error: "length required" }, 411);
  if (len > MAX_BYTES) return json({ error: "upload too big" }, 413);
  const sized = new FixedLengthStream(len);
  void request.body.pipeTo(sized.writable);
  const res = await fetch(`${origin}/upload`, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "", "x-roomie-token": env.ROOMIE_UPLOAD_TOKEN },
    body: sized.readable,
  });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
};
