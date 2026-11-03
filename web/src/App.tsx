import { useEffect, useMemo, useState } from "react";
import { Chat, ShoppingList, freshPhotos } from "./components/Chat";
import { RoomViewer, type ViewMode } from "./components/RoomViewer";
import { MeasureChip, dims } from "./components/bits";
import { findSpot, productMap } from "./lib/fit";
import { LangContext, type Lang, useT } from "./lib/i18n";
import type { ChatTurn, Product, Room, RoomState } from "./lib/types";

const EMPTY: RoomState = { placements: [], removed: [], sizeEdits: {}, taste: {}, list: [] };
function useStored<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => { try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return init; } });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(v)); }, [key, v]);
  return [v, setV] as const;
}

export default function App() {
  const [lang, setLang] = useStored<Lang>("roomie:lang", navigator.language.startsWith("zh") ? "zh" : "en");
  useEffect(() => { document.documentElement.lang = lang === "zh" ? "zh-Hant-TW" : "en"; }, [lang]);
  const m = location.pathname.match(/^\/room\/([a-z0-9-]+)/);
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {m ? <RoomPage id={m[1]} /> : <Landing />}
    </LangContext.Provider>
  );
}

function LangToggle() {
  const t = useT();
  void t;
  return (
    <LangContext.Consumer>
      {({ lang, setLang }) => (
        <button onClick={() => setLang(lang === "zh" ? "en" : "zh")} className="min-h-11 rounded-full bg-bone-white px-4 text-[14px]" aria-label="language">
          {lang === "zh" ? "EN" : "中文"}
        </button>
      )}
    </LangContext.Consumer>
  );
}

function Landing() {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-full max-w-[1200px] flex-col px-4 py-6 md:px-10">
      <header className="flex items-center justify-between">
        <span className="font-display text-[22px]">Roomie</span>
        <LangToggle />
      </header>
      <section className="my-auto py-12">
        <h1 className="max-w-3xl text-[48px] leading-[1.05] md:text-[96px]">{t("tagline")}</h1>
        <p className="mt-5 max-w-xl text-[18px] text-graphite">{t("sub")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="/room/demo" className="inline-flex min-h-12 items-center rounded-full bg-charcoal px-6 text-[16px] text-paper-white shadow-button">{t("openDemo")}</a>
          <a href="https://testflight.apple.com/" className="inline-flex min-h-12 items-center rounded-full border border-ink/12 bg-bone-white px-6 text-[16px]">{t("scanOwn")}</a>
        </div>
        <p className="mt-6 max-w-xl text-[13px] text-fog">Muse Spark · SAM 3.1 · Muse Image · ARKit · Gaussian splat. Built for the Meta Global AI Developer Hackathon.</p>
      </section>
    </main>
  );
}

function RoomPage({ id }: { id: string }) {
  const t = useT();
  const url = `/rooms/${id}`;
  const [room, setRoom] = useState<Room | null>(null);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [state, setState] = useStored<RoomState>(`roomie:${id}:state`, EMPTY);
  const [turns, setTurns] = useStored<ChatTurn[]>(`roomie:${id}:chat`, []);
  const [mode, setMode] = useState<ViewMode>("blocks");
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState<{ x: number; y: number } | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [tab, setTab] = useState<"chat" | "list">("chat");
  const [editing, setEditing] = useState(false);
  const products = useMemo(() => productMap(catalog), [catalog]);

  useEffect(() => {
    fetch(`${url}/room.json`).then((r) => r.json()).then(setRoom);
    fetch("/catalog.json").then((r) => r.json()).then(setCatalog);
  }, [url]);
  useEffect(() => { if (!turns.length) setTurns([{ role: "assistant", text: t("greeting") }]); }, []); // eslint-disable-line
  useEffect(() => { // "Show me" on a not-yet-placed product: place it, then ask for a photo
    const h = (e: Event) => {
      if (!room) return;
      const pid = (e as CustomEvent).detail as string;
      const desk = products.get(pid)?.category === "lamp" ? room.objects.find((o) => o.label === "desk" && !state.removed.includes(o.id)) : undefined;
      const spot = findSpot(room, state, products, pid, desk);
      if (!spot) return;
      setState({ ...state, placements: [...state.placements, spot] });
      setSelected(spot.id);
      freshPhotos.add(spot.id);
      setTurns([...turns, { role: "assistant", text: "", cards: [{ type: "photo", placementId: spot.id, productId: spot.productId }] }]);
    };
    window.addEventListener("roomie:place", h);
    return () => window.removeEventListener("roomie:place", h);
  }, [room, state, products, turns]);

  if (!room) return <div className="grid h-full place-items-center text-fog"><span className="pulse-dot h-3 w-3 rounded-full bg-powder-blue" /></div>;
  const obj = room.objects.find((o) => o.id === selected);
  const placed = state.placements.find((p) => p.id === selected);
  const area = room.shell.width * room.shell.depth;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <section className="relative h-[46svh] shrink-0 p-3 md:h-full md:flex-1 md:p-6">
        <div className="iris-frame h-full">
          <div className="relative h-full overflow-hidden rounded-[24px] bg-sky-tint">
            <RoomViewer room={room} roomUrl={url} state={state} products={products} mode={mode} selected={selected} onSelect={setSelected} onLabel={setLabel} resetKey={resetKey} />
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
              <div className="pointer-events-auto rounded-full bg-paper-white/90 px-3 py-1.5 text-[13px]">
                <a href="/" className="font-display">Roomie</a> · <span className="num">{(area / 3.3058).toFixed(1)} 坪 · {dims({ w: room.shell.width, d: room.shell.depth, h: room.shell.height })}</span>
              </div>
              {room.judge && (
                <div className="pointer-events-auto absolute top-14 left-3 rounded-full bg-paper-white/90 px-3 py-1 text-[12px] text-graphite"
                  title={room.judge.rounds.map((r) => `round ${r.round}: ${r.scores.join(", ")}${r.kept ? "" : " (reverted)"}`).join("\n")}>
                  {t("aiChecked")} <span className="num text-ink">{(room.judge.final.reduce((a, b) => a + b, 0) / room.judge.final.length).toFixed(1)}/10</span> · {room.judge.rounds.length} {t("rounds")}
                </div>
              )}
              <div className="pointer-events-auto"><LangToggle /></div>
            </div>
            {label && (obj || placed) && (
              <div className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full" style={{ left: label.x, top: label.y - 6 }}>
                {obj ? <MeasureChip obj={obj} size={state.sizeEdits[obj.id] ?? obj.size} edited={!!state.sizeEdits[obj.id]} onClick={() => setEditing(true)} />
                  : placed && <span className="rounded-full bg-paper-white px-3 py-1.5 text-[13px] shadow-float">{products.get(placed.productId)?.title_en}</span>}
              </div>
            )}
            <div className="absolute inset-x-0 bottom-3 flex justify-center">
              <div className="flex gap-1 rounded-full bg-paper-white p-1 shadow-float">
                {(["blocks", "real"] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} className={`min-h-10 rounded-full px-4 text-[14px] ${mode === m ? "bg-charcoal text-paper-white" : "text-graphite"}`}>{t(m)}</button>
                ))}
                <button onClick={() => setResetKey((k) => k + 1)} className="min-h-10 rounded-full px-4 text-[14px] text-graphite">{t("reset")}</button>
              </div>
            </div>
          </div>
        </div>
        {editing && obj && <SizeSheet key={obj.id} obj={obj} state={state} setState={setState} close={() => setEditing(false)} />}
      </section>
      <aside className="flex min-h-0 flex-1 flex-col md:w-[440px] md:flex-none md:py-6 md:pr-6">
        <div className="flex gap-1 px-4 pt-1 md:px-1">
          {(["chat", "list"] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={`min-h-10 rounded-full px-4 text-[14px] ${tab === k ? "bg-bone-white text-ink" : "text-graphite"}`}>
              {k === "chat" ? "Roomie" : `${t("list")} (${state.list.length})`}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {tab === "chat"
            ? <Chat roomId={id} room={room} state={state} setState={setState} products={products} turns={turns} setTurns={setTurns} onFocus={setSelected} />
            : <div className="p-4"><ShoppingList state={state} setState={setState} products={products} t={t} /></div>}
        </div>
      </aside>
    </div>
  );
}

function SizeSheet({ obj, state, setState, close }: { obj: Room["objects"][number]; state: RoomState; setState: (s: RoomState) => void; close: () => void }) {
  const t = useT();
  const s = state.sizeEdits[obj.id] ?? obj.size;
  const [v, setV] = useState({ w: Math.round(s.w * 100), d: Math.round(s.d * 100), h: Math.round(s.h * 100) });
  return (
    <div className="absolute inset-x-3 bottom-3 z-10 rounded-[24px] bg-paper-white p-4 shadow-float md:inset-x-6 md:bottom-6">
      <p className="text-[13px] text-fog">{t("measuredFrom")}: {obj.source === "measured" ? "SAM 3.1 + ARKit planes" : "ARKit points (approx.)"} · ±{obj.pm_cm} cm</p>
      <p className="mt-2 text-[15px]">{t("fixSize")}</p>
      <div className="mt-2 flex gap-2">
        {(["w", "d", "h"] as const).map((k) => (
          <input key={k} type="number" inputMode="numeric" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
            className="num min-h-11 w-20 rounded-2xl bg-mist-gray px-3 text-[17px]" aria-label={k} />
        ))}
        <button onClick={() => { setState({ ...state, sizeEdits: { ...state.sizeEdits, [obj.id]: { w: v.w / 100, d: v.d / 100, h: v.h / 100 } } }); close(); }}
          className="min-h-11 rounded-full bg-charcoal px-4 text-[15px] text-paper-white shadow-button">{t("save")}</button>
        <button onClick={close} className="min-h-11 px-2 text-[15px] text-graphite">✕</button>
      </div>
    </div>
  );
}
