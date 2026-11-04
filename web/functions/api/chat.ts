// The Homie shopping agent: Muse Spark with tools that read the room, search the Shopee catalog, and
// place/move/remove items. Tools run here, on our own code (fit checks are deterministic); the client
// gets back the reply, the new room state and rich cards. Stateless: the client sends history + state.
import { checkFit, findSpot, productMap, replaceSpot, withMoves } from "../../src/lib/fit";
import type { Card, ChatTurn, Product, Room, RoomState } from "../../src/lib/types";
import { type Env, json, loadCatalog, loadRoom, meta, underLimit } from "../_lib";

const MODEL = "muse-spark-1.3"; // standard mode: visitors' chats and photos stay out of model training
const MAX_STEPS = 8; // agreed room plan: search, show, place, add to list, reply (with room to spare)
const MAX_BODY = 1_500_000; // the client shrinks photos to ~768 px JPEG, well under this
const MAX_OUT = 1200; // output tokens per model call (a 4-item plan plus reasoning fits)

const tools = [
  fn("search_products", "Search the cached Shopee Taiwan catalog. Returns up to 8 products with price, size and category.", {
    query: { type: "string", description: "Keywords in Traditional Chinese or English, e.g. 收納櫃 白色, lamp" },
    category: { type: "string", enum: ["cabinet", "wardrobe", "shelf", "drawer unit", "storage box", "nightstand", "desk", "chair", "bed frame", "bin", "lamp", "floor lamp", "rug", "any"] },
    max_price: { type: "number", description: "NT$" }, max_width_cm: { type: "number" }, max_depth_cm: { type: "number" }, max_height_cm: { type: "number" },
  }, ["query"]),
  fn("show_products", "Show 1-3 products to the user as cards with a fit check. Always do this after choosing candidates.", {
    product_ids: { type: "array", items: { type: "string" } }, title: { type: "string" },
    near_object_id: { type: "string", description: "existing object to place them near, if the user said where" },
    replace_object_id: { type: "string", description: "existing object these would replace; tapping a card swaps it in the room" },
  }, ["product_ids"]),
  fn("place_item", "Put a product into the user's 3D room. Code finds a free spot against a wall (or on top of near_object for lamps) and checks the fit.", {
    product_id: { type: "string" }, near_object_id: { type: "string" },
    replace_object_id: { type: "string", description: "existing object this product replaces (it gets hidden)" },
  }, ["product_id"]),
  fn("move_item", "Move a placed product next to another object.", { placement_id: { type: "string" }, near_object_id: { type: "string" } }, ["placement_id", "near_object_id"]),
  fn("remove_item", "Remove a placed product, or hide an existing object (to plan replacing it).", {
    placement_id: { type: "string" }, object_id: { type: "string" },
  }, []),
  fn("update_object_size", "The user corrected the size of something in their room.", {
    object_id: { type: "string" }, w_cm: { type: "number" }, d_cm: { type: "number" }, h_cm: { type: "number" },
  }, ["object_id"]),
  fn("set_taste", "Remember the user's style, budget and constraints.", {
    style: { type: "string" }, budget: { type: "number", description: "NT$ total" }, notes: { type: "string" },
  }, []),
  fn("add_to_list", "Add products to the shopping list.", { product_ids: { type: "array", items: { type: "string" } } }, ["product_ids"]),
  fn("show_list", "Show the shopping list with Shopee links and the total.", {}, []),
  fn("render_photo", "Make a realistic photo of the user's real room with a placed product (Muse Image). Use when the user wants to see how it looks.", {
    placement_id: { type: "string" },
  }, ["placement_id"]),
];

function fn(name: string, description: string, properties: object, required: string[]) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } };
}

const cm = (m: number) => Math.round(m * 100);
function describeRoom(room: Room, state: RoomState, pm: Map<string, Product>) {
  const objs = room.objects.filter((o) => !state.removed.includes(o.id)).map((o) => {
    const s = state.sizeEdits[o.id] ?? o.size;
    return `- ${o.id}: ${o.label}, ${cm(s.w)}×${cm(s.d)}×${cm(s.h)} cm${o.source === "approx" && !state.sizeEdits[o.id] ? ` (approx ±${o.pm_cm})` : ""}, at x=${o.center[0].toFixed(1)} z=${o.center[2].toFixed(1)}`;
  });
  const doors = room.shell.walls.flatMap((w) => w.openings.map((op) => `${op.type} on the ${w.id} wall, ${cm(op.to - op.from)} cm wide`));
  const placed = state.placements.map((p) => `- ${p.id}: ${pm.get(p.productId)?.title_en ?? p.productId} (product ${p.productId})`);
  return [
    `Room: ${cm(room.shell.width)} × ${cm(room.shell.depth)} cm, ceiling ${cm(room.shell.height)} cm (${((room.shell.width * room.shell.depth) / 3.3058).toFixed(1)} ping). ${doors.join("; ")}.`,
    `Style: ${room.finishes?.style ?? "unknown"}; walls ${room.finishes?.wall}, floor ${room.finishes?.floor_material}.`,
    `Existing furniture:\n${objs.join("\n")}`,
    placed.length ? `Placed products:\n${placed.join("\n")}` : "No products placed yet.",
    `Shopping list: ${state.list.length ? state.list.join(", ") : "empty"}. Taste: ${JSON.stringify(state.taste)}.`,
  ].join("\n");
}

const SYSTEM = (lang: string, room: string) => `You are Homie, a friendly personal AI shopping assistant for renters in Taiwan.
The user filmed their room; it is measured and shown in 3D next to this chat. Help them find real Shopee Taiwan products that fit, place them in the 3D room, show realistic photos, and build a shopping list.
Rules:
- Act with tools instead of asking questions, except for a general request (below). Ask at most one short question, and only when you can't act at all (for example no budget hint and they asked for "the best"). Never ask the user to measure anything; sizes marked approx are fine as they are.
- To recommend: search_products, pick the best 1-3 for this room and taste, then show_products. Place an item with place_item when the user picks one or clearly asks to put something in the room.
- Fit results come from code. Never claim something fits unless a tool said so. Mention approx sizes briefly when relevant.
- Product data is in Chinese; reply in ${lang === "zh" ? "Traditional Chinese (zh-TW)" : "English"}, whatever language the product titles are in. Prices in NT$.
- Keep replies short: 1-3 sentences, or one line per item in a plan. The cards show the details.
- To replace something already in the room, pass replace_object_id to show_products (or place_item).
- A general request (what the room still needs, a plan, a redesign, "make it cozier"): first reply with a plan only, and call no tools in that reply. Compare the furniture with what a renter's room usually has (bed, desk, chair, clothes storage, shelves, desk lamp, bin, rug, nightstand) and give the 3-4 biggest gaps for this room, taste and budget, most needed first. One line each: the item, a target max size in cm that fits the free floor (use the room size and furniture above), and a rough NT$ price. End with one line: "Shall I find the best buys for these?" If they ask to change the list, revise the plan the same way.
- When they agree (yes, ok, go, 好, 可以 …): search_products for all items at once. Then show_products with 2-3 candidates per item to get their fit checks, place_item the best one per item that fits (fit "yes", or "check" if nothing better), and add_to_list. Choose on fit, rating and price. Reply with one short line per item saying why, then end with: "Want to see a real photo of it?"
- Call render_photo only when they say yes to a photo or ask for one.
- Any other request: do exactly what they ask.
${room}`;

/** A product placed in this reply already has its own card: drop it from the candidate cards shown before. */
function tidy(cards: Card[]) {
  const placed = new Set(cards.flatMap((c) => (c.type === "products" ? c.items.filter((i) => i.placementId).map((i) => i.product.id) : [])));
  return cards
    .map((c) => (c.type === "products" && !c.items.some((i) => i.placementId) ? { ...c, items: c.items.filter((i) => !placed.has(i.product.id)) } : c))
    .filter((c) => c.type !== "products" || c.items.length);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Bound what one request can cost: body size, history, text, images and the state we put in the prompt.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return json({ error: "too large" }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: "too large" }, 413);
  const body = JSON.parse(raw) as { roomId: string; lang: "zh" | "en"; messages: ChatTurn[]; state: RoomState; selected?: string };
  if (!Array.isArray(body.messages) || !body.state) return json({ error: "bad request" }, 400);
  if (!(await underLimit(env, request, "chat", 40, 600))) return json({ error: "busy" }, 429);
  body.messages = body.messages.slice(-8).map((m, i, all) => ({
    role: m.role === "assistant" ? "assistant" : "user", text: String(m.text ?? "").slice(0, 1500),
    image: i === all.length - 1 && typeof m.image === "string" && m.image.startsWith("data:image/") ? m.image : undefined, // only the newest photo
  }));
  const st = body.state;
  body.state = {
    placements: (st.placements ?? []).slice(0, 20), removed: (st.removed ?? []).slice(0, 40).map(String),
    sizeEdits: Object.fromEntries(Object.entries(st.sizeEdits ?? {}).slice(0, 40)),
    moved: Object.fromEntries(Object.entries(st.moved ?? {}).slice(0, 40)),
    taste: { style: String(st.taste?.style ?? "").slice(0, 200) || undefined, budget: Number(st.taste?.budget) || undefined, notes: String(st.taste?.notes ?? "").slice(0, 300) || undefined },
    list: (st.list ?? []).slice(0, 50).map(String),
  };
  const [scanned, catalog] = await Promise.all([loadRoom(env, request, body.roomId), loadCatalog(env, request)]);
  const pm = productMap(catalog);
  // Keep only ids that exist in this room and catalog, so nothing client-made reaches the prompt unchecked.
  const objIds = new Set(scanned.objects.map((o) => o.id));
  const num = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const st0 = body.state;
  const state: RoomState = {
    placements: st0.placements.filter((p) => typeof p?.id === "string" && p.id.length <= 40 && pm.has(p.productId))
      .map((p) => ({ id: p.id, productId: p.productId, x: num(p.x, -10, 10), z: num(p.z, -10, 10), y: p.y === undefined ? undefined : num(p.y, 0, 3), yaw: num(p.yaw, -7, 7), accepted: !!p.accepted })),
    removed: st0.removed.filter((id) => objIds.has(id)),
    sizeEdits: Object.fromEntries(Object.entries(st0.sizeEdits).filter(([id]) => objIds.has(id))
      .map(([id, s]) => [id, { w: num(s?.w, 0.05, 5), d: num(s?.d, 0.05, 5), h: num(s?.h, 0.01, 3) }])),
    moved: Object.fromEntries(Object.entries(st0.moved ?? {}).filter(([id]) => objIds.has(id))
      .map(([id, m]) => [id, { x: num(m?.x, -10, 10), z: num(m?.z, -10, 10), yaw: num(m?.yaw, -7, 7) }])),
    taste: st0.taste, list: st0.list.filter((id) => pm.has(id)),
  };
  const room = withMoves(scanned, state); // furniture where the user dragged it
  const cards: Card[] = [];
  const objectById = (id?: string) => room.objects.find((o) => o.id === id);
  // Desk lamps go on the desk unless the user said otherwise.
  const nearFor = (productId: string, id?: string) =>
    objectById(id) ?? (pm.get(productId)?.category === "lamp" ? room.objects.find((o) => o.label === "desk" && !state.removed.includes(o.id)) : undefined);

  const run: Record<string, (a: any) => unknown> = {
    search_products: (a) => {
      const q = String(a.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      return catalog
        .filter((p) => (!a.category || a.category === "any" || p.category === a.category || (a.category === "lamp" && p.category === "floor lamp")))
        .filter((p) => (!a.max_price || p.price <= a.max_price))
        .filter((p) => !p.size || ((!a.max_width_cm || p.size.w * 100 <= a.max_width_cm) && (!a.max_depth_cm || p.size.d * 100 <= a.max_depth_cm) && (!a.max_height_cm || p.size.h * 100 <= a.max_height_cm)))
        .map((p) => ({ p, score: q.filter((w) => (p.title + " " + (p.title_en ?? "") + " " + p.category).toLowerCase().includes(w)).length + (16 - (p.rank ?? 15)) / 40 })) // best sellers break ties
        .sort((x, y) => y.score - x.score).slice(0, 8)
        .map(({ p }) => ({ id: p.id, name: p.title_en, price: p.price, size_cm: p.size && `${cm(p.size.w)}×${cm(p.size.d)}×${cm(p.size.h)}`, size_source: p.size_source, category: p.category, color: p.color, rating: p.rating, best_seller_rank: p.rank }));
    },
    show_products: (a) => {
      const replaced = objectById(a.replace_object_id);
      const trial: RoomState = replaced ? { ...state, removed: [...state.removed, replaced.id] } : state;
      const items = (a.product_ids as string[]).map((id) => pm.get(id)).filter(Boolean).slice(0, 3).map((product) => {
        const spot = replaced ? replaceSpot(state, pm, replaced, product!.id) : findSpot(room, state, pm, product!.id, nearFor(product!.id, a.near_object_id));
        return { product: product!, fit: spot ? checkFit(room, trial, pm, spot) : { status: "no" as const, clearance_cm: null, reason_en: "No free spot found", reason_zh: "房間裡找不到空位" } };
      });
      cards.push({ type: "products", title: a.title, items, ...(replaced ? { replace: replaced.id } : {}) });
      return items.map((i) => ({ id: i.product.id, fit: i.fit.status, reason: i.fit.reason_en }));
    },
    place_item: (a) => {
      const replaced = objectById(a.replace_object_id);
      const pr = pm.get(a.product_id);
      if (!pr) return { error: "unknown product" };
      // Try with the replaced object hidden, but only keep it hidden if the new product actually fits.
      const trial: RoomState = replaced ? { ...state, removed: [...state.removed, replaced.id] } : state;
      let spot = replaced ? replaceSpot(state, pm, replaced, pr.id) : null;
      spot = spot && checkFit(room, trial, pm, spot).status !== "no" ? spot : findSpot(room, trial, pm, a.product_id, nearFor(a.product_id, a.near_object_id));
      if (!spot) return { error: "no free spot in the room" };
      if (replaced) state.removed.push(replaced.id);
      state.placements.push(spot);
      const fit = checkFit(room, state, pm, spot);
      cards.push({ type: "products", items: [{ product: pr, fit, placementId: spot.id }] });
      return { placement_id: spot.id, fit: fit.status, reason: fit.reason_en };
    },
    move_item: (a) => {
      const i = state.placements.findIndex((p) => p.id === a.placement_id);
      if (i < 0) return { error: "unknown placement" };
      const [old] = state.placements.splice(i, 1);
      const spot = findSpot(room, state, pm, old.productId, objectById(a.near_object_id));
      state.placements.push(spot ? { ...spot, id: old.id } : old);
      return spot ? { moved: true, fit: checkFit(room, state, pm, { ...spot, id: old.id }).reason_en } : { moved: false, reason: "no free spot there" };
    },
    remove_item: (a) => {
      if (a.placement_id) state.placements = state.placements.filter((p) => p.id !== a.placement_id);
      if (a.object_id && objectById(a.object_id)) state.removed.push(a.object_id);
      return { ok: true };
    },
    update_object_size: (a) => {
      const o = objectById(a.object_id);
      if (!o) return { error: "unknown object" };
      const s = state.sizeEdits[o.id] ?? o.size;
      state.sizeEdits[o.id] = { w: a.w_cm ? a.w_cm / 100 : s.w, d: a.d_cm ? a.d_cm / 100 : s.d, h: a.h_cm ? a.h_cm / 100 : s.h };
      return { ok: true, size: state.sizeEdits[o.id] };
    },
    set_taste: (a) => ((state.taste = { ...state.taste, ...a }), { ok: true }),
    add_to_list: (a) => {
      for (const id of a.product_ids as string[]) if (pm.has(id) && !state.list.includes(id)) state.list.push(id);
      return { list: state.list };
    },
    show_list: () => (cards.push({ type: "list" }), { shown: true }),
    render_photo: (a) => {
      const p = state.placements.find((x) => x.id === a.placement_id);
      if (!p) return { error: "unknown placement" };
      cards.push({ type: "photo", placementId: p.id, productId: p.productId });
      return { started: true };
    },
  };

  const history = body.messages.slice(-12).map((m) => m.role === "user"
    ? { role: "user", content: m.image ? [{ type: "text", text: m.text || "(photo)" }, { type: "image_url", image_url: { url: m.image } }] : m.text }
    : { role: "assistant", content: m.text });
  const picked = objectById(objIds.has(String(body.selected)) ? String(body.selected) : undefined); // tapped in the 3D view
  const context = describeRoom(room, state, pm) + (picked ? `\nThe user has tapped ${picked.id} (${picked.label}) in the 3D view; "this" or "it" means that object.` : "");
  const messages: any[] = [{ role: "system", content: SYSTEM(body.lang, context) }, ...history];
  let retried = false;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const r = await meta(env, "/chat/completions", { model: MODEL, reasoning_effort: "low", messages, tools, max_tokens: MAX_OUT });
      const msg = r.choices[0].message;
      if (!msg.tool_calls?.length && !msg.content?.trim() && !retried) { retried = true; continue; } // an empty turn now and then: ask again once
      messages.push(msg);
      if (!msg.tool_calls?.length) return json({ reply: msg.content ?? "", state, cards: tidy(cards) });
      for (const call of msg.tool_calls) {
        let result: unknown;
        try {
          result = run[call.function.name]?.(JSON.parse(call.function.arguments || "{}")) ?? { error: "unknown tool" };
        } catch (e: any) {
          result = { error: e.message };
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return json({ reply: body.lang === "zh" ? "好了，請看下面的卡片。" : "Done: see the cards below.", state, cards: tidy(cards) });
  } catch (e: any) {
    return json({ error: String(e.message ?? e) }, 502);
  }
};
