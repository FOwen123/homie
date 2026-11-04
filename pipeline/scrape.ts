// Shopee Taiwan listings via Apify (memo23~shopee-scraper), in two steps so money goes to good listings only:
//   bun pipeline/scrape.ts search    each keyword, best sellers first, rated ≥ 4.5 (US$0.0004 per result)
//   bun pipeline/scrape.ts details   full details for the best-ranked, highest-rated results per keyword
//                                    (US$0.0035 each): seller rating, official shop, reviews, description
// Results are cached in pipeline/catalog/ (git-ignored); pipeline/catalog.ts applies the trust thresholds.
// Every run checks the account's usage first and carries maxTotalChargeUsd, so the total stays under BUDGET_USD.
import { join } from "node:path";

const BUDGET_USD = 3; // the user's total Apify budget for this project
const ACTOR = "memo23~shopee-scraper";
const API = "https://api.apify.com/v2";
const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) throw new Error("APIFY_TOKEN missing: fill in .env and run from the repo root");
const dir = join(import.meta.dir, "catalog");

export const KEYWORDS = ["收納櫃", "抽屜櫃", "衣櫃", "層架", "書桌", "電腦椅", "床架", "床頭櫃", "垃圾桶", "檯燈", "落地燈", "地毯", "收納箱"];
const PER_KEYWORD = 50;  // search results per keyword (best sellers first)
const DETAILS_PER_KEYWORD = 10;

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`apify ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
};
const used = async () => (await api("/users/me/limits")).data.current.monthlyUsageUsd as number;

async function run(input: object, capUsd: number): Promise<any[]> {
  const before = await used();
  if (before + capUsd > BUDGET_USD) throw new Error(`Apify budget: $${before.toFixed(2)} used, this run could add $${capUsd}, cap $${BUDGET_USD}`);
  let r = (await api(`/acts/${ACTOR}/runs?maxTotalChargeUsd=${capUsd}&memory=512`, { method: "POST", body: JSON.stringify(input) })).data;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(r.status)) {
    await Bun.sleep(5000);
    r = (await api(`/actor-runs/${r.id}`)).data;
  }
  if (r.status !== "SUCCEEDED") throw new Error(`run ${r.id} ${r.status}`);
  return api(`/datasets/${r.defaultDatasetId}/items?clean=true`);
}

const step = process.argv[2];
if (step === "search") {
  const todo = [...KEYWORDS];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let kw; (kw = todo.shift()); ) {
      const items = await run({ searchTerms: [kw], country: "TW", mode: "search", sortBy: "sales", minRating: 4.5, minPrice: 50, maxItems: PER_KEYWORD }, 0.05);
      await Bun.write(join(dir, `search_${kw}.json`), JSON.stringify(items, null, 1));
      console.log(`${kw}: ${items.length} results`);
    }
  }));
} else if (step === "details") {
  // Best sellers first (search order), rated ≥ 4.7 with a real rating, not already fetched.
  const urls: string[] = [];
  for (const kw of KEYWORDS) {
    const items: any[] = await Bun.file(join(dir, `search_${kw}.json`)).json();
    urls.push(...items.filter((x) => Number(x.rating) >= 4.7).slice(0, DETAILS_PER_KEYWORD).map((x) => x.url));
  }
  const n = Number(process.argv[3]) || urls.length; // optional: fetch only the first n (a sample)
  // On Apify's free plan one run makes at most 20 real lookups; later product links come back as title + image only.
  const items: any[] = [];
  for (let i = 0; i < n; i += 20) {
    const chunk = urls.slice(i, Math.min(i + 20, n));
    items.push(...await run({ startUrls: chunk.map((url) => ({ url })), mode: "product", maxItems: chunk.length, maxConcurrency: 2 }, Math.ceil(chunk.length * 0.004 * 100) / 100 + 0.01));
  }
  await Bun.write(join(dir, n < urls.length ? "details_sample.json" : "details.json"), JSON.stringify(items, null, 1));
  console.log(`details: ${items.length} of ${urls.length} listings, ${items.filter((x) => x.ratingCount != null).length} with review counts`);
} else {
  throw new Error("usage: bun pipeline/scrape.ts search | details [n]");
}
console.log(`Apify usage this month: $${(await used()).toFixed(3)} of $${BUDGET_USD}`);
