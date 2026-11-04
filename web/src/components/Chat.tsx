import { useEffect, useMemo, useRef, useState } from "react";
import { SWAP, checkFit, findSpot, keepLocal, replaceSpot } from "../lib/fit";
import { type Key, LABEL_ZH, LangContext, useLang, useT } from "../lib/i18n";
import type { Card, ChatTurn, FitResult, Placement, Product, Room, RoomObject, RoomState } from "../lib/types";
import { ProductCard, dims, ntd } from "./bits";

type Props = {
  roomId: string; room: Room; state: RoomState; setState: React.Dispatch<React.SetStateAction<RoomState>>; products: Map<string, Product>;
  turns: ChatTurn[]; setTurns: (t: ChatTurn[]) => void; onFocus: (id: string) => void; selected?: string | null;
  opened: string[]; setOpened: React.Dispatch<React.SetStateAction<string[]>>; // checkout progress, shared by every list
};
/** Put a product in the room (App listens): swapped in for `replace`, or on a free spot. */
const place = (productId: string, replace?: string) => window.dispatchEvent(new CustomEvent("roomie:place", { detail: { productId, replace } }));

async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const s = Math.min(1, 768 / Math.max(img.width, img.height));
  const c = new OffscreenCanvas(Math.round(img.width * s), Math.round(img.height * s));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(blob); });
}

const FIRST_CHIPS: Key[] = ["quickPlan", "quick1", "quick2", "quick3"];
/** Suggested replies from the last turn and the room, no model call: a plan waiting for a yes, else room follow-ups. */
function followUps(turns: ChatTurn[], state: RoomState): Key[] {
  const last = turns.at(-1);
  if (!last || last.role !== "assistant") return [];
  if (!last.cards?.some((c) => c.type === "products") && /[?？]$/.test(last.text.trim())) return ["followYes", "followChange"];
  return state.placements.length ? ["followPhoto", "followCheaper", "followMore"] : [];
}

export function Chat({ roomId, room, state, setState, products, turns, setTurns, onFocus, selected, opened, setOpened }: Props) {
  const t = useT();
  const { lang } = useLang();
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns, busy]);
  const chips = turns.length <= 1 ? FIRST_CHIPS : followUps(turns, state);

  async function send(msg: string, img = image) {
    if (!msg.trim() && !img) return;
    const next = [...turns, { role: "user" as const, text: msg.trim(), image: img }];
    setTurns(next);
    setText(""); setImage(undefined); setBusy(true);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, lang, messages: next.map(({ role, text, image }) => ({ role, text, image })), state, selected }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error === "busy" ? t("busy") : j.error);
      setState((cur) => keepLocal(state, cur, j.state)); // the reply is built on the state as it was sent
      const placed = j.state.placements.at(-1) as Placement | undefined;
      if (placed && placed.id !== state.placements.at(-1)?.id) onFocus(placed.id);
      for (const c of j.cards as Card[]) {
        const p = c.type === "photo" && (j.state as RoomState).placements.find((x) => x.id === c.placementId);
        if (p) freshPhotos.add(photoKey(p));
      }
      setTurns([...next, { role: "assistant", text: j.reply, cards: j.cards }]);
    } catch (e: any) {
      setTurns([...next, { role: "assistant", text: e.message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pt-5 pb-3">
        {turns.map((m, i) => (
          <div key={i} className="rise space-y-3">
            {(m.text || m.image) && (
              <div className={`flex items-start gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && <Avatar />}
                <div className={`max-w-[85%] whitespace-pre-line rounded-[22px] px-4 py-3 text-[17px] leading-[1.45] ${m.role === "user" ? "rounded-br-md bg-charcoal text-paper-white" : "rounded-tl-md bg-paper"}`}>
                  {m.image && <img src={m.image} alt="" className="mb-2 max-h-48 rounded-2xl" />}
                  {m.text}
                </div>
              </div>
            )}
            {m.cards?.map((c, j) => <CardView key={j} card={c} {...{ roomId, room, state, setState, products, onFocus, opened, setOpened }} />)}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-[15px] text-fog"><span className="pulse-dot h-2 w-2 rounded-full bg-powder-blue" />{t("thinking")}</div>}
        <div ref={end} />
      </div>
      {chips.length > 0 && !busy && (
        // one swipeable row just above the composer, fading at the right edge so it reads as scrollable
        <div role="group" aria-label={t("suggestions")}
          className="flex snap-x gap-2 overflow-x-auto px-4 pt-1 [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] [scrollbar-width:none] md:px-5">
          {chips.map((k) => (
            <button key={k} onClick={() => send(t(k))}
              className="min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border border-ink/10 bg-paper px-4 text-[14px] text-ink hover:bg-sand">{t(k)}</button>
          ))}
          <span aria-hidden className="w-2 shrink-0" />
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="m-3 mt-2 flex items-end gap-2 rounded-[28px] border border-ink/14 bg-paper-white p-1.5 md:m-4 md:mt-2">
        <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-graphite" title="photo">
          <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImage(await shrink(f)); e.target.value = ""; }} />
          {image ? <img src={image} alt="" className="h-9 w-9 rounded-full object-cover" /> : (
            <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
          )}
        </label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={t("chatPlaceholder")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }}
          className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-1 py-2.5 text-[17px] outline-none placeholder:text-fog" />
        <button disabled={busy} aria-label={t("send")} title={t("send")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-charcoal text-paper-white disabled:opacity-50">
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
    </div>
  );
}

/** Homie's mark beside its messages: the house from the wordmark on ink. */
function Avatar() {
  return (
    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-charcoal text-paper-white">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5V20H3z" /></svg>
    </span>
  );
}

function CardView({ card, roomId, room, state, setState, products, onFocus, opened, setOpened }: { card: Card } & Omit<Props, "turns" | "setTurns" | "selected">) {
  const t = useT();
  if (card.type === "products") {
    return (
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
        {card.items.map(({ product, fit, placementId }) => {
          const placement = state.placements.find((p) => p.id === placementId) ?? state.placements.find((p) => p.productId === product.id);
          const liveFit = placement ? checkFit(room, state, products, placement) : fit;
          return (
            <ProductCard key={product.id} product={product} fit={liveFit} inList={state.list.includes(product.id)}
              onAdd={() => setState({ ...state, list: [...state.list, product.id] })}
              onShow={() => (placement ? onFocus(placement.id) : place(product.id, card.replace))} />
          );
        })}
      </div>
    );
  }
  if (card.type === "photo") {
    const placement = state.placements.find((p) => p.id === card.placementId);
    // keyed by position: a moved product remounts the card, so it never shows (or fetches for) the old spot
    return <PhotoCard key={placement ? photoKey(placement) : card.placementId} roomId={roomId} placement={placement} />;
  }
  return <ShoppingList state={state} setState={setState} products={products} t={t} opened={opened} setOpened={setOpened} />;
}

// Each AI photo costs a Muse Image call: generate only for photo cards created in this visit, cache the
// result, and show a button (not an automatic call) for photo cards restored from saved chat history.
type Photo = { image?: string; frame?: string; error?: string };
const photoCache = new Map<string, Photo>();
export const freshPhotos = new Set<string>(); // photo keys requested in this visit
/** A moved product needs a new photo, so the key includes where it stands. */
export const photoKey = (p: Placement) => `${p.id}@${p.x.toFixed(2)},${(p.y ?? 0).toFixed(2)},${p.z.toFixed(2)},${p.yaw.toFixed(2)}`;

export function PhotoCard({ roomId, placement }: { roomId: string; placement?: Placement }) {
  const t = useT();
  const id = placement ? photoKey(placement) : "";
  const [img, setImg] = useState<Photo | null>(photoCache.get(id) ?? null);
  const [want, setWant] = useState(freshPhotos.has(id));
  const [before, setBefore] = useState(false);
  useEffect(() => {
    if (!placement || !want || photoCache.has(id)) return;
    let live = true;
    fetch("/api/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, placement }) })
      .then((r) => r.json()).then((j: Photo) => { if (j.image) photoCache.set(id, j); if (live) setImg(j); })
      .catch((e) => live && setImg({ error: String(e) }));
    return () => { live = false; };
  }, [roomId, id, want]);
  if (!img && !want) return <button onClick={() => setWant(true)} className="min-h-11 rounded-full bg-charcoal px-4 text-[15px] text-paper-white shadow-button">{t("showMe")}</button>;
  if (!img) return <div className="flex aspect-[3/4] w-full max-w-sm items-center justify-center rounded-[24px] bg-paper text-[15px] text-fog"><span className="pulse-dot mr-2 h-2 w-2 rounded-full bg-powder-blue" />{t("making")}</div>;
  if (!img.image) return <p className="text-[15px] text-fog">{t("photoFailed")} {img.error === "busy" ? t("busy") : img.error?.startsWith("no frame") ? t("noFrame") : ""}</p>;
  return (
    <figure className="relative w-full max-w-sm overflow-hidden rounded-[24px]" onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)}>
      <img src={before ? img.frame : img.image} alt="" className="w-full select-none" draggable={false} />
      <figcaption className="absolute top-3 left-3 rounded-full bg-paper-white/90 px-3 py-1 text-[12px]">{before ? "Before" : t("aiPreview")} · hold to compare</figcaption>
    </figure>
  );
}

// Checkout opens one Shopee page per tap (browsers block several at once); `opened` lives in the room page so
// progress survives switching tabs, and only items still on the list count.
export function ShoppingList({ state, setState, products, t, opened, setOpened }: { state: RoomState; setState: React.Dispatch<React.SetStateAction<RoomState>>; products: Map<string, Product>; t: ReturnType<typeof useT> } & Pick<Props, "opened" | "setOpened">) {
  const items = state.list.map((id) => products.get(id)).filter((p): p is Product => !!p);
  const total = items.reduce((s, p) => s + p.price, 0);
  if (!items.length) return <p className="rounded-[24px] bg-paper p-4 text-[15px] text-fog">{t("empty")}</p>;
  const next = items.find((p) => !opened.includes(p.id)), done = items.length - items.filter((p) => !opened.includes(p.id)).length;
  const open = (id: string) => setOpened((o) => (o.includes(id) ? o : [...o, id]));
  return (
    <div className="rounded-[24px] bg-paper p-4">
      <h3 className="mb-2 text-[20px]">{t("list")} <span className="num text-[15px] text-fog">{items.length}</span></h3>
      {items.map((p) => (
        <div key={p.id} className="flex items-center gap-3 border-b border-ink/6 py-2 last:border-0">
          <img src={p.image} alt="" referrerPolicy="no-referrer" className="h-12 w-12 rounded-xl bg-mist-gray object-contain" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[14px] text-ink">{p.title}</p>
            <a href={p.url} target="_blank" rel="noreferrer" onClick={() => open(p.id)} className="text-[13px] text-graphite underline decoration-iris/40">
              {opened.includes(p.id) ? `✓ ${t("openedShopee")}` : t("openShopee")}
            </a>
          </div>
          <span className="num text-[15px]">{ntd(p.price)}</span>
          <button onClick={() => setState({ ...state, list: state.list.filter((x) => x !== p.id) })} aria-label={`${t("remove")} ${p.title}`} className="grid h-11 w-11 shrink-0 place-items-center text-fog">✕</button>
        </div>
      ))}
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-[15px] text-graphite">{t("total")}</span>
        <span className="num text-[24px]">{ntd(total)}</span>
      </div>
      <a href={(next ?? items[0]).url} target="_blank" rel="noreferrer" onClick={() => next && open(next.id)}
        className="mt-3 flex min-h-12 w-full items-center justify-center rounded-full bg-charcoal px-6 text-[16px] text-paper-white shadow-button">
        {!next ? t("checkoutDone") : done ? `${t("checkoutNext")} ${done + 1}/${items.length}` : `${t("checkout")} (${items.length})`}
      </a>
      <p className="mt-2 text-[13px] text-fog">{t("checkoutNote")}</p>
    </div>
  );
}

const NO_SPOT: FitResult = { status: "no", clearance_cm: null, reason_en: "No free spot in your room", reason_zh: "房間裡沒有空位放" };

/** Every product in the catalog, grouped by category, each checked against this room (best spot first).
 *  With `swap` (an object tapped in the 3D view): only products that could replace it, checked in its place. */
export function ShopAll({ room, state, setState, products, onFocus, swap, onClear }: Omit<Props, "roomId" | "turns" | "setTurns" | "selected" | "opened" | "setOpened"> & { swap?: RoomObject; onClear: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const name = (label: string) => (lang === "zh" ? LABEL_ZH[label] ?? label : label);
  const groups = useMemo(() => {
    const desk = room.objects.find((o) => o.label === "desk" && !state.removed.includes(o.id));
    const trial = swap ? { ...state, removed: [...state.removed, swap.id] } : state;
    const rank = { yes: 0, check: 1, no: 2 };
    const rows = [...products.values()].filter((p) => !swap || SWAP[swap.label]?.includes(p.category)).map((product) => {
      const placement = swap ? undefined : state.placements.find((p) => p.productId === product.id);
      const spot = placement ?? (swap ? replaceSpot(state, products, swap, product.id) : findSpot(room, state, products, product.id, product.category === "lamp" ? desk : undefined));
      return { product, placement, fit: spot ? checkFit(room, trial, products, spot) : NO_SPOT };
    }).sort((a, b) => rank[a.fit.status] - rank[b.fit.status] || a.product.price - b.product.price);
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.product.category, [...(by.get(r.product.category) ?? []), r]);
    return [...by];
  }, [room, state, products, swap]);
  return (
    <div className="space-y-5 px-4 pt-4 pb-6">
      {swap && (
        <div className="flex items-center justify-between gap-2 rounded-[24px] bg-paper p-4">
          <p className="text-[15px]">{t("swapFor")} <b>{name(swap.label)}</b> <span className="num text-fog">≈ {dims(state.sizeEdits[swap.id] ?? swap.size)}</span>
            {!groups.length && <span className="block text-fog">{t("swapNone")}</span>}</p>
          <button onClick={onClear} className="min-h-11 shrink-0 rounded-full border border-ink/12 px-4 text-[14px]">{t("showAll")}</button>
        </div>
      )}
      {groups.map(([cat, rows]) => (
        <section key={cat}>
          <h3 className="mb-2 text-[17px]">{lang === "zh" ? name(cat) : cat[0].toUpperCase() + cat.slice(1)} <span className="num text-fog">{rows.length}</span></h3>
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
            {rows.map(({ product, placement, fit }) => (
              <ProductCard key={product.id} product={product} fit={fit} inList={state.list.includes(product.id)}
                onAdd={() => setState({ ...state, list: [...state.list, product.id] })}
                onShow={() => (placement ? onFocus(placement.id) : place(product.id, swap?.id))} />
            ))}
          </div>
        </section>
      ))}
      {!groups.length && !swap && <p className="text-[15px] text-fog">{t("thinking")}</p>}
    </div>
  );
}

export { LangContext };
