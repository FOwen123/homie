import { useEffect, useMemo, useRef, useState } from "react";
import { Chat, ShopAll, ShoppingList, freshPhotos, photoKey } from "./components/Chat";
import { RoomViewer, type ViewMode } from "./components/RoomViewer";
import { MeasureChip, Segmented, dims } from "./components/bits";
import { findSpot, moveIn, productMap, replaceSpot, withMoves } from "./lib/fit";
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

/** The same top bar on every page: logo home, optional room facts, language. */
function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-3">
      <a href="/" className="shrink-0"><img src="/homie-logo.png" alt="Homie" className="h-7 w-auto" /></a>
      <div className="min-w-0 flex-1">{children}</div>
      <LangToggle />
    </header>
  );
}

// shortcut: no public TestFlight link yet, so the app button opens the build-it-yourself steps; set it once beta review passes
const TESTFLIGHT_URL: string | undefined = undefined;
const SCAN_STEPS = "https://github.com/FOwen123/desk#scan-your-own-room";

function Landing() {
  const t = useT();
  const [demo, setDemo] = useState<Room | null>(null);
  useEffect(() => { fetch("/rooms/demo/room.json").then((r) => r.json()).then(setDemo); }, []);
  const steps = [["step1", "step1Body"], ["step2", "step2Body"], ["step3", "step3Body"]] as const;
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-10">
      <Header />
      <section className="grid items-center gap-8 py-10 md:grid-cols-[1fr_1.1fr] md:gap-12 md:py-16">
        <div>
          <h1 className="text-[48px] leading-[1.05] md:text-[80px]">{t("tagline")}</h1>
          <p className="mt-5 max-w-xl text-[18px] text-graphite">{t("sub")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/room/demo" className="inline-flex min-h-12 items-center rounded-full bg-charcoal px-6 text-[16px] text-paper-white shadow-button">{t("openDemo")}</a>
            <a href="#try" className="inline-flex min-h-12 items-center rounded-full border border-ink/12 bg-bone-white px-6 text-[16px]">{t("scanOwn")}</a>
          </div>
        </div>
        <figure>
          <div className="iris-frame h-[360px] md:h-[480px]">
            <div className="relative h-full overflow-hidden rounded-[24px] bg-sky-tint">
              {demo && <RoomViewer room={demo} state={EMPTY} products={NO_PRODUCTS} mode="blocks" selected={null} onSelect={() => {}} />}
            </div>
          </div>
          <figcaption className="mt-3 text-[13px] text-fog">{t("demoCaption")}</figcaption>
        </figure>
      </section>
      <section className="py-10 md:py-16">
        <h2 className="text-[36px] leading-[1.1] md:text-[56px]">{t("howTitle")}</h2>
        <ol className="mt-8 grid gap-3 md:grid-cols-3 md:gap-6">
          {steps.map(([h, b], i) => (
            <li key={h} className="rounded-[24px] bg-bone-white p-6 md:rounded-[32px] md:p-10">
              <span className="num text-[13px] text-fog">0{i + 1}</span>
              <h3 className="mt-2 text-[22px] leading-[1.25] md:text-[28px]">{t(h)}</h3>
              <p className="mt-3 text-[15px] text-graphite">{t(b)}</p>
            </li>
          ))}
        </ol>
      </section>
      <section id="try" className="py-10 md:py-16">
        <h2 className="text-[36px] leading-[1.1] md:text-[56px]">{t("tryTitle")}</h2>
        <ol className="mt-6 max-w-2xl space-y-3 text-[17px]">
          <li>1. {t("try1")}</li>
          <li>2. {t("try2")}</li>
          <li>3. {t("try3")}</li>
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={TESTFLIGHT_URL ?? SCAN_STEPS} className="inline-flex min-h-12 items-center rounded-full bg-charcoal px-6 text-[16px] text-paper-white shadow-button">{t(TESTFLIGHT_URL ? "getApp" : "buildApp")}</a>
          <a href="/room/demo" className="inline-flex min-h-12 items-center rounded-full border border-ink/12 bg-bone-white px-6 text-[16px]">{t("openDemo")}</a>
        </div>
        <p className="mt-4 text-[13px] text-fog">{t("iphoneOnly")}</p>
      </section>
      <footer className="border-t border-ink/6 py-8 text-[13px] text-fog">Muse Spark · SAM 3.1 · Muse Image · ARKit. Built for the Meta Global AI Developer Hackathon.</footer>
    </main>
  );
}

const NO_PRODUCTS = new Map<string, Product>();

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
  const [tab, setTab] = useState<"chat" | "shop" | "list">("chat");
  const [editing, setEditing] = useState(false);
  const products = useMemo(() => productMap(catalog), [catalog]);
  // Undo: every change to the room (a drag, a nudge, a chat reply, a list edit) can be taken back, up to 50
  const [past, setPast] = useState<RoomState[]>([]);
  const prev = useRef(state), undoing = useRef(false);
  useEffect(() => {
    const before = prev.current; // read now: the updater below runs after prev moves on
    if (before !== state && !undoing.current) setPast((p) => [...p.slice(-49), before]);
    undoing.current = false;
    prev.current = state;
  }, [state]);
  const undo = () => {
    const last = past.at(-1);
    if (!last) return;
    undoing.current = true;
    setPast(past.slice(0, -1));
    setState(last);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement; // their own undo
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  useEffect(() => {
    fetch(`${url}/room.json`).then((r) => r.json()).then(setRoom);
    fetch("/catalog.json").then((r) => r.json()).then(setCatalog);
  }, [url]);
  useEffect(() => { if (!turns.length) setTurns([{ role: "assistant", text: t("greeting") }]); }, []); // eslint-disable-line
  useEffect(() => { // "Show me" on a not-yet-placed product: place it, then ask for a photo
    const h = (e: Event) => {
      if (!room) return;
      const here = withMoves(room, state);
      const { productId: pid, replace } = (e as CustomEvent).detail as { productId: string; replace?: string };
      const old = here.objects.find((o) => o.id === replace && !state.removed.includes(o.id));
      const desk = products.get(pid)?.category === "lamp" ? here.objects.find((o) => o.label === "desk" && !state.removed.includes(o.id)) : undefined;
      const spot = old ? replaceSpot(state, products, old, pid) : findSpot(here, state, products, pid, desk);
      if (!spot) return;
      setState({ ...state, removed: old ? [...state.removed, old.id] : state.removed, placements: [...state.placements, spot] });
      setSelected(spot.id);
      freshPhotos.add(photoKey(spot));
      setTurns([...turns, { role: "assistant", text: "", cards: [{ type: "photo", placementId: spot.id, productId: spot.productId }] }]);
      setTab("chat"); // the photo appears in the chat
    };
    window.addEventListener("roomie:place", h);
    return () => window.removeEventListener("roomie:place", h);
  }, [room, state, products, turns]);

  if (!room) return <div className="grid h-full place-items-center text-fog"><span className="pulse-dot h-3 w-3 rounded-full bg-powder-blue" /></div>;
  const shown = withMoves(room, state); // the room as the user rearranged it
  const obj = shown.objects.find((o) => o.id === selected);
  const placed = state.placements.find((p) => p.id === selected);
  const area = room.shell.width * room.shell.depth;

  return (
    <div className="flex h-full flex-col gap-3 px-3 pt-3 md:gap-6 md:px-6 md:pt-5">
      <Header>
        <span className="num inline-block max-w-full truncate rounded-full bg-bone-white px-3 py-1.5 text-[13px] text-graphite">
          {(area / 3.3058).toFixed(1)} 坪<span className="hidden sm:inline"> · {dims({ w: room.shell.width, d: room.shell.depth, h: room.shell.height })}</span>
        </span>
      </Header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-6 md:pb-6">
        <section className="relative h-[46svh] shrink-0 md:h-full md:flex-1">
          <div className="iris-frame h-full">
            <div className="relative h-full overflow-hidden rounded-[24px] bg-sky-tint">
              <RoomViewer room={room} state={state} products={products} mode={mode} selected={selected}
                onSelect={(sel) => { setSelected(sel); if (room.objects.some((o) => o.id === sel)) setTab("shop"); }} onLabel={setLabel}
                onMove={(id, pose) => setState(moveIn(state, id, pose))} />
              <div className="pointer-events-none absolute top-3 left-3 flex flex-col items-start gap-1.5">
              {room.judge && mode === "blocks" && (
                <div className="pointer-events-auto rounded-full bg-paper-white/90 px-3 py-1 text-[12px] text-graphite"
                  title={[...room.judge.rounds.map((r) => `round ${r.round}: ${r.scores.join(", ")}${r.kept ? "" : " (reverted)"}`), ...(room.judge.issues ?? []).flat().map((i) => `· ${i}`)].join("\n")}>
                  {t("aiChecked")} <span className="num text-ink">{(room.judge.final.reduce((a, b) => a + b, 0) / room.judge.final.length).toFixed(1)}/10</span> · {room.judge.rounds.length} {t("rounds")}
                </div>
              )}
                <p className="hidden rounded-full bg-paper-white/90 px-3 py-1 text-[12px] text-graphite md:block">{t("dragHint")}</p>
                {past.length > 0 && (
                  <button onClick={undo} title={`${t("undo")} (Ctrl+Z / ⌘Z)`} className="pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-full bg-paper-white/90 px-4 text-[14px] shadow-float">
                    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-2" /></svg>
                    {t("undo")}
                  </button>
                )}
              </div>
              {label && (obj || placed) && (
                <div className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full" style={{ left: label.x, top: label.y - 6 }}>
                  {obj ? <MeasureChip obj={obj} size={state.sizeEdits[obj.id] ?? obj.size} edited={!!state.sizeEdits[obj.id]} onClick={() => setEditing(true)} />
                    : placed && <span className="rounded-full bg-paper-white px-3 py-1.5 text-[13px] shadow-float">{products.get(placed.productId)?.title_en}</span>}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-3 flex justify-center">
                <Segmented label={t("viewMode")} value={mode} onChange={setMode} className="shadow-float"
                  items={(["blocks", "walk"] as const).map((k) => ({ key: k, label: t(k) }))} />
              </div>
            </div>
          </div>
          {editing && obj && <SizeSheet key={obj.id} obj={obj} state={state} setState={setState} close={() => setEditing(false)} />}
        </section>
        <aside className="flex min-h-0 flex-1 flex-col md:w-[440px] md:flex-none">
          <Segmented label={t("roomSections")} value={tab} onChange={setTab}
            items={[{ key: "chat", label: t("chatTab") }, { key: "shop", label: t("shop"), badge: catalog.length }, { key: "list", label: t("listTab"), badge: state.list.length }]} />
          <div className="-mx-3 min-h-0 flex-1 md:mx-0">
            {tab === "chat"
              ? <Chat roomId={id} room={shown} state={state} setState={setState} products={products} turns={turns} setTurns={setTurns} onFocus={setSelected} selected={obj?.id} />
              : tab === "shop" ? <ShopAll room={shown} state={state} setState={setState} products={products} onFocus={setSelected} swap={obj} onClear={() => setSelected(null)} />
              : <div className="p-4"><ShoppingList state={state} setState={setState} products={products} t={t} /></div>}
          </div>
        </aside>
      </div>
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
