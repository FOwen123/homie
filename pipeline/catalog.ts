// Shopee scraper output (pipeline/catalog/search_*.json from scrape.ts) → web/public/catalog.json.
// Only trusted listings get in (thresholds below); the rest are dropped before any Muse call.
// Muse reads each listing (title + main photo) for category, size, colour and a parts model. Sizes found
// in the listing text are "listing"; otherwise Muse estimates from the photo and they are "estimated".
// Usage: bun pipeline/catalog.ts
import { Glob } from "bun";
import { join } from "node:path";
import { chatJSON, spent } from "./meta";

const MODEL = process.env.CATALOG_MODEL ?? "muse-spark-1.3-contributor"; // public listings: contributor mode is fine
const dir = join(import.meta.dir, "catalog");
// Trust thresholds. Search results come sorted by sales, so `position` is the best-seller rank for its keyword.
const MIN_RATING = 4.8;          // product rating, out of 5
const MAX_RANK = 15;             // top best sellers per keyword
const MIN_PRICE_SHARE = 0.35;    // below 35% of the keyword's median price = a teaser variant ("from NT$55"), not the real item
const MIN_REVIEWS = 30, MIN_SHOP_RATING = 4.7; // applied when the detail lookup returned them
const details = new Map<string, any>();
for await (const f of new Glob("details*.json").scan(dir))
  for (const d of await Bun.file(join(dir, f)).json()) if (d.ratingCount != null) details.set(String(d.itemId), d);
const seen = new Set<string>();
const items: any[] = [];
for await (const f of new Glob("search_*.json").scan(dir)) {
  const list: any[] = await Bun.file(join(dir, f)).json();
  const prices = list.map((x) => Number(x.price)).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  for (const x of list) {
    const d = details.get(String(x.itemId));
    const trusted = Number(x.rating) >= MIN_RATING && x.position <= MAX_RANK && Number(x.price) >= Math.max(30, median * MIN_PRICE_SHARE) &&
      !/海外|中國|大陸/.test(x.location ?? "") && (!d || (d.ratingCount >= MIN_REVIEWS && (d.shopRating ?? 5) >= MIN_SHOP_RATING));
    if (trusted && !seen.has(String(x.itemId)) && seen.add(String(x.itemId)))
      items.push({ ...x, reviews: d?.ratingCount, shopName: d?.shopName, official: d?.isOfficialShop });
  }
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["category", "w_cm", "d_cm", "h_cm", "size_in_listing", "color", "title_en", "parts"],
  properties: {
    category: { type: "string", enum: ["cabinet", "wardrobe", "shelf", "drawer unit", "storage box", "nightstand", "desk", "chair", "bed frame", "bin", "lamp", "floor lamp", "rug", "other"] },
    w_cm: { type: "number" }, d_cm: { type: "number" }, h_cm: { type: "number" },
    size_in_listing: { type: "boolean", description: "true only if the dimensions are written in the title" },
    color: { type: "string", description: "main colour #rrggbb" },
    title_en: { type: "string", description: "short English name, max 6 words" },
    parts: { type: "array", items: { type: "object", additionalProperties: false, required: ["shape", "size", "pos", "color"],
      properties: { shape: { type: "string", enum: ["box", "cylinder"] }, size: { type: "array", items: { type: "number" } },
        pos: { type: "array", items: { type: "number" } }, color: { type: "string" } } } },
  },
};
const prompt = (x: any) =>
  `Shopee Taiwan listing: "${x.title}". From the title and photo: the product category; its overall width, depth and height in cm ` +
  `(use dimensions from the title when present, e.g. 寬60 深30 高90 or 60x30x90, otherwise estimate from the photo); the main colour; ` +
  `a short English name; and 2 to 10 simple parts (boxes, cylinders) in meters for a 3D preview. Part coordinates: origin at the ` +
  `centre of the footprint on the floor, y up, front faces +z, all parts inside the product's size. Cylinder size = [diameter, height, diameter]. ` +
  `For a rug, one thin box about 0.01 m tall.`;

const out: any[] = [];
const todo = [...items];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let x; (x = todo.shift()); ) {
    const image = (typeof x.images === "string" ? JSON.parse(x.images.replace(/'/g, '"')) : x.images)?.[0] ?? x.imageUrl;
    try {
      const r = await chatJSON(MODEL, [{ type: "text", text: prompt(x) }, { type: "image_url", image_url: { url: image } }], SCHEMA, "product");
      if (r.category === "other") throw new Error("not furniture we can place");
      const size = { w: r.w_cm / 100, d: r.d_cm / 100, h: Math.max(r.h_cm / 100, 0.005) };
      if (!(size.w > 0.05 && size.d > 0.05 && size.w < 4 && size.d < 4 && size.h < 2.6)) throw new Error(`implausible size ${JSON.stringify(size)}`);
      out.push({
        id: `sp${x.itemId}`, title: x.title, title_en: r.title_en, price: Number(x.price), url: x.url, image, shop: x.official ? "Shopee Mall" : x.shopName,
        rating: Number(x.rating) || undefined, reviews: x.reviews, rank: x.position, category: r.category, query: x.searchTerm,
        size, size_source: r.size_in_listing ? "listing" : "estimated", color: r.color,
        parts: r.parts.map((p: any, i: number) => ({ name: `p${i}`, ...p })),
      });
    } catch (e: any) {
      console.error(`${x.itemId}: ${e.message.slice(0, 120)}`);
    }
  }
}));
out.sort((a, b) => a.rank - b.rank);
await Bun.write(join(import.meta.dir, "..", "web", "public", "catalog.json"), JSON.stringify(out));
const by = Object.groupBy(out, (p) => p.category);
console.log(`${items.length} trusted listings → ${out.length} products · ${Object.entries(by).map(([k, v]) => `${k} ${v!.length}`).join(", ")} · ` +
  `${out.filter((p) => p.size_source === "listing").length} with listed size · Muse spend so far $${spent().toFixed(3)}`);
