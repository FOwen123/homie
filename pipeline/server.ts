// Processing server that runs on the Mac (tonight's stand-in for Modal + R2).
// The Pages function /api/upload forwards captures here through a Cloudflare quick tunnel; this server
// runs pipeline/process.ts, publishes the room to the website, and reports status.
// Usage: bun pipeline/server.ts      (then: cloudflared tunnel --url http://localhost:8790)
import { $ } from "bun";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const PORT = 8790;
const ROOT = join(import.meta.dir, "..");
const UPLOADS = join(ROOT, "pipeline", "uploads"); // git-ignored
const TOKEN = process.env.ROOMIE_UPLOAD_TOKEN; // shared with the Pages function, so only it can call us
const DAILY_MAX = 20;
const FILES = ["video.mov", "frames.jsonl", "features.jsonl", "planes.json", "meta.json"];
if (!TOKEN) throw new Error("ROOMIE_UPLOAD_TOKEN missing in .env");

type Job = { state: "queued" | "processing" | "publishing" | "done" | "failed"; step?: string; url?: string; error?: string };
const jobs = new Map<string, Job>();
const queue: string[] = [];
let running = false;
const today = () => new Date().toISOString().slice(0, 10);
const perDay = new Map<string, number>();

async function work() {
  if (running) return;
  running = true;
  for (let id; (id = queue.shift()); ) {
    const job = jobs.get(id)!;
    const cap = join(UPLOADS, id), bundle = join(ROOT, "web", "public", "rooms", id);
    try {
      job.state = "processing";
      // Visitors' rooms use standard mode so their data stays out of model training.
      const proc = Bun.spawn(["bun", join(import.meta.dir, "process.ts"), cap, bundle], {
        cwd: ROOT, env: { ...process.env, SEGMENT_MODEL: "muse-spark-1.3", PARTS_MODEL: "muse-spark-1.3" }, stdout: "pipe", stderr: "pipe",
      });
      for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
        const m = [...chunk.matchAll(/▸ ([^…]+)…/g)].at(-1);
        if (m) job.step = m[1];
      }
      if ((await proc.exited) !== 0) throw new Error((await new Response(proc.stderr).text()).slice(-400));
      await rm(join(bundle, ".work"), { recursive: true, force: true });
      job.state = "publishing";
      await $`bun run build`.cwd(join(ROOT, "web")).quiet();
      await $`bunx wrangler pages deploy dist --project-name roomie-tw --branch main --commit-dirty=true`.cwd(join(ROOT, "web")).quiet();
      job.state = "done";
      job.url = `/room/${id}`;
    } catch (e: any) {
      job.state = "failed";
      job.error = String(e.message ?? e).slice(-300);
      console.error(id, job.error);
    }
  }
  running = false;
}

Bun.serve({
  port: PORT,
  maxRequestBodySize: 120 * 1024 * 1024,
  async fetch(req) {
    if (req.headers.get("x-roomie-token") !== TOKEN) return new Response("unauthorized", { status: 401 });
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/upload") {
      const day = today(), n = perDay.get(day) ?? 0;
      if (n >= DAILY_MAX) return Response.json({ error: "busy" }, { status: 429 });
      perDay.set(day, n + 1); // reserve the slot before the first await so concurrent uploads can't share it
      const release = () => perDay.set(day, (perDay.get(day) ?? 1) - 1);
      const form = await req.formData().catch(() => null);
      if (!form) return release(), Response.json({ error: "bad upload" }, { status: 400 });
      const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await mkdir(join(UPLOADS, id), { recursive: true });
      for (const name of FILES) {
        const f = form.get(name);
        if (!(f instanceof File)) return release(), Response.json({ error: `missing ${name}` }, { status: 400 });
        await Bun.write(join(UPLOADS, id, name), f);
      }
      jobs.set(id, { state: "queued" });
      queue.push(id);
      void work();
      return Response.json({ id });
    }
    const m = url.pathname.match(/^\/status\/([a-z0-9]+)$/);
    if (m) return Response.json(jobs.get(m[1]) ?? { state: "failed", error: "unknown room" });
    return new Response("not found", { status: 404 });
  },
});
console.log(`Roomie processing server on :${PORT} · ${(await readdir(UPLOADS).catch(() => [])).length} past uploads`);

// Open a Cloudflare quick tunnel and register its URL in KV, so /api/upload on the website finds us.
const KV_NAMESPACE = "e887d89473a542d1a3a32863a41d31f2"; // web/wrangler.toml LIMITS
const tunnel = Bun.spawn(["cloudflared", "tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { stderr: "pipe", stdout: "ignore" });
let registered = false;
// Keep reading cloudflared's log for its whole life: closing the pipe makes it exit on its next log line.
for await (const chunk of tunnel.stderr.pipeThrough(new TextDecoderStream())) {
  const m = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (registered || !m) continue;
  registered = true;
  await $`bunx wrangler kv key put processor_origin ${m[0]} --namespace-id ${KV_NAMESPACE} --remote`.cwd(join(ROOT, "web")).quiet();
  console.log(`tunnel ${m[0]} registered; the website's /api/upload now reaches this Mac`);
}
console.error("cloudflared exited");
