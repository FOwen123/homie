import { afterEach, expect, test } from "bun:test";
import { onRequestPost } from "./chat";
import type { Env } from "../_lib";
import type { RoomState } from "../../src/lib/types";

const room = await Bun.file(new URL("../../public/rooms/demo/room.json", import.meta.url)).json();
const catalog = await Bun.file(new URL("../../public/catalog.json", import.meta.url)).json();
const initial: RoomState = { placements: [], removed: [], sizeEdits: {}, taste: {}, list: [] };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

async function turn(calls: { name: string; args: object }[], state = initial, selected?: string) {
  let modelCalls = 0;
  const live = { ...catalog[0], id: "sp-live-test", title: "Live listing", category: "desk" };
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith("/products")) return Response.json([]);
    if (url.endsWith("/products/search")) return Response.json({ source: "live", products: [live] });
    if (url.includes("api.meta.ai")) {
      const body = JSON.parse(String(init?.body));
      if (modelCalls++ === 0) return Response.json({ choices: [{ message: { role: "assistant", tool_calls: calls.map((c, i) => ({ id: String(i), type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }] });
      expect(body.messages.some((m: { role: string }) => m.role === "tool")).toBe(true);
      return Response.json({ choices: [{ message: { role: "assistant", content: "Updated." } }] });
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  const env = {
    META_MODEL_API_KEY: "test", ROOMIE_UPLOAD_TOKEN: "test",
    ASSETS: { fetch: async (url: URL) => Response.json(String(url).endsWith("catalog.json") ? catalog : room) },
    LIMITS: { get: async (key: string) => key === "processor_origin" ? "https://processor.test" : null, put: async () => {} },
  } as unknown as Env;
  const request = new Request("https://homie.test/api/chat", { method: "POST", body: JSON.stringify({ roomId: "demo", lang: "en", messages: [{ role: "user", text: "Update my room" }], state, selected }) });
  const res = await onRequestPost({ request, env } as Parameters<typeof onRequestPost>[0]) as Response;
  expect(res.status).toBe(200);
  return { result: await res.json(), seen };
}

test("live search results can be shown, placed, and added to the shopping list in one turn", async () => {
  const { result, seen } = await turn([
    { name: "search_products", args: { query: "書桌" } },
    { name: "show_products", args: { product_ids: ["sp-live-test"] } },
    { name: "place_item", args: { product_id: "sp-live-test" } },
    { name: "add_to_list", args: { product_ids: ["sp-live-test"] } },
  ], { ...initial, removed: room.objects.map((o: { id: string }) => o.id) });
  expect(seen).toContain("https://processor.test/products/search");
  expect(result.products.some((p: { id: string }) => p.id === "sp-live-test")).toBe(true);
  expect(result.state.placements[0]?.productId).toBe("sp-live-test");
  expect(result.state.list).toEqual(["sp-live-test"]);
  expect(result.cards.some((c: { type: string }) => c.type === "products")).toBe(true);
});

test("agent deletes scanned objects and the last placed product with its shopping entry", async () => {
  const { result } = await turn([
    { name: "remove_item", args: { object_id: room.objects[0].id } },
    { name: "remove_item", args: { placement_id: "placed-test" } },
    { name: "show_objects", args: {} },
  ], { ...initial, placements: [{ id: "placed-test", productId: catalog[0].id, x: 0, z: 0, yaw: 0 }], list: [catalog[0].id] });
  expect(result.state.removed).toEqual([room.objects[0].id]);
  expect(result.state.placements).toEqual([]);
  expect(result.state.list).toEqual([]);
  expect(result.cards).toContainEqual({ type: "objects" });
});

test("starting from scratch clears furniture and shopping while retaining room preferences", async () => {
  const { result } = await turn([{ name: "clear_room", args: {} }], { ...initial, list: [catalog[0].id], taste: { budget: 3000 } });
  expect(result.state.removed).toEqual(room.objects.map((o: { id: string }) => o.id));
  expect(result.state.placements).toEqual([]);
  expect(result.state.list).toEqual([]);
  expect(result.state.taste.budget).toBe(3000);
});
