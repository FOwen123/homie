// Meta Model API calls for the pipeline, with a spend ledger so tests stay inside the US$50 Muse budget.
// Prices from https://dev.meta.ai/docs/pricing-rate-limits (Nov 2026).
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const API = "https://api.meta.ai/v1";
const KEY = process.env.META_MODEL_API_KEY; // Bun loads .env from the working directory
if (!KEY) throw new Error("META_MODEL_API_KEY missing: fill in .env and run from the repo root");

export const BUDGET_USD = 50;
const LEDGER = join(import.meta.dir, "spend.jsonl"); // git-ignored
const PRICE: Record<string, { in: number; cached: number; out: number }> = {
  "muse-spark-1.3": { in: 1.25e-6, cached: 0.15e-6, out: 4.25e-6 },
  "muse-spark-1.3-contributor": { in: 0.1e-6, cached: 0.002e-6, out: 0.2e-6 },
};
const SAM_IMAGE = 2.5 / 1000;
const MUSE_IMAGE = 0.01;

export function spent(): number {
  if (!existsSync(LEDGER)) return 0;
  return readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).reduce((s, l) => s + JSON.parse(l).usd, 0);
}

function record(kind: string, model: string, usd: number, detail: unknown) {
  appendFileSync(LEDGER, JSON.stringify({ t: new Date().toISOString(), kind, model, usd, detail }) + "\n");
}

function guard() {
  const s = spent();
  if (s >= BUDGET_USD) throw new Error(`Muse budget reached: $${s.toFixed(2)} of $${BUDGET_USD}`);
}

export async function call(path: string, body: any, stream = false): Promise<Response> {
  guard();
  const res = await fetch(API + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(stream ? { Accept: "text/event-stream" } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (path === "/responses" && body.model?.startsWith("sam")) record("sam", body.model, SAM_IMAGE, null);
  if (path === "/images/edits" || path === "/images/generations") record("image", body.model, MUSE_IMAGE * (body.n ?? 1), null);
  return res;
}

/** Chat completion that returns parsed JSON content and records token cost. */
export async function chatJSON(model: string, content: unknown[], schema: object, name = "out"): Promise<any> {
  const j: any = await (await call("/chat/completions", {
    model, reasoning_effort: "minimal", messages: [{ role: "user", content }],
    response_format: { type: "json_schema", json_schema: { name, schema } },
  })).json();
  const u = j.usage ?? {};
  const p = PRICE[model] ?? PRICE["muse-spark-1.3"];
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  record("chat", model, ((u.prompt_tokens ?? 0) - cached) * p.in + cached * p.cached + (u.completion_tokens ?? 0) * p.out, u);
  return JSON.parse(j.choices[0].message.content);
}

export const dataUrl = async (path: string) =>
  `data:image/jpeg;base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64")}`;
