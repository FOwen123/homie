import { useEffect, useMemo, useRef, useState } from "react";
import { Chat, ShopAll, ShoppingList, freshPhotos, photoKey } from "./components/Chat";
import { RoomViewer, type ViewMode } from "./components/RoomViewer";
import { FitBadge, MeasureChip, Segmented, Tabs, dims, ntd } from "./components/bits";
import { checkFit, findSpot, moveIn, productMap, replaceSpot, withMoves } from "./lib/fit";
import { LangContext, type Lang, useLang, useT } from "./lib/i18n";
import type { ChatTurn, FitResult, Product, Room, RoomState } from "./lib/types";

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
        <button onClick={() => setLang(lang === "zh" ? "en" : "zh")} className="min-h-11 rounded-full border border-ink/14 px-4 text-[14px]" aria-label="language">
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
      <a href="/" className="flex shrink-0 items-center gap-2" aria-label="Homie">
        <svg aria-hidden viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
        <span className="font-display text-[24px] leading-none" style={{ fontWeight: 400 }}>homie</span>
      </a>
      <div className="min-w-0 flex-1">{children}</div>
      <LangToggle />
    </header>
  );
}

// shortcut: no public TestFlight link yet, so the app button opens the build-it-yourself steps; set it once beta review passes
const TESTFLIGHT_URL: string | undefined = undefined;
const SCAN_STEPS = "https://github.com/FOwen123/desk#scan-your-own-room";

const HERO_LAMP = "sp28361311399"; // Xiaomi Smart Desk Lamp 2: a real catalog listing, fit checked by code on the demo room
const STEP_LAMP = "sp8812597921"; // Foldable LED Desk Lamp

function Landing() {
  const t = useT();
  const [demo, setDemo] = useState<Room | null>(null);
  const [catalog, setCatalog] = useState<Product[]>([]);
  useEffect(() => {
    fetch("/rooms/demo/room.json").then((r) => r.json()).then(setDemo);
    fetch("/catalog.json").then((r) => r.json()).then(setCatalog);
  }, []);
  const products = useMemo(() => productMap(catalog), [catalog]);
  const fitOf = (pid: string) => { // the same check the room page runs: a free spot by the desk, then checkFit
    const product = products.get(pid);
    if (!demo || !product) return null;
    const spot = findSpot(demo, EMPTY, products, pid, demo.objects.find((o) => o.label === "desk"));
    return spot && { product, fit: checkFit(demo, EMPTY, products, spot) };
  };
  const hero = fitOf(HERO_LAMP), step = fitOf(STEP_LAMP);
  const chips = demo ? (["bed", "desk", "wardrobe"] as const).map((l) => demo.objects.find((o) => o.label === l)).filter((o) => !!o) : [];
  const steps = [["step1", "step1Body"], ["step2", "step2Body"], ["step3", "step3Body"]] as const;
  const button = "inline-flex min-h-14 items-center rounded-full px-7 text-[16px]";
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-4 md:px-10">
      <Header>
        <nav className="hidden justify-end gap-8 pr-4 text-[15px] text-graphite md:flex">
          <a href="#how">{t("howTitleShort")}</a><a href="/room/demo">{t("roomDemo")}</a><a href="#try">{t("navScan")}</a>
        </nav>
      </Header>
      <section className="grid items-center gap-10 py-10 lg:grid-cols-[540px_1fr] lg:gap-14 md:py-14">
        <div className="flex flex-col gap-7">
          <p className="num flex items-center gap-2 text-[12px] tracking-[0.06em] text-graphite"><span className="h-2 w-2 rounded-full bg-iris" />{t("heroKicker")}</p>
          <h1 className="whitespace-pre-line text-[44px] leading-[1.14] md:text-[68px]">{t("tagline")}</h1>
          <p className="max-w-[460px] text-[18px] leading-[1.55] text-graphite md:text-[19px]">{t("sub")}</p>
          <div className="flex flex-wrap gap-3">
            <a href="/room/demo" className={`${button} bg-charcoal text-paper-white`}>{t("openDemo")} →</a>
            <a href="#try" className={`${button} border border-ink/16`}>{t("scanOwn")}</a>
          </div>
          <dl className="flex gap-6 pt-2 text-[13px] text-graphite">
            {([["1 min", "stat1"], ["iPhone", "stat2"], ["± cm", "stat3"]] as const).map(([v, k], i) => (
              <div key={k} className={`flex flex-col-reverse gap-0.5 ${i ? "border-l border-ink/12 pl-6" : ""}`}>
                <dt>{t(k)}</dt><dd className={`num text-[20px] ${i === 2 ? "text-iris" : "text-ink"}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <figure className="relative">
          <div className="grid-paper relative h-[380px] overflow-hidden rounded-[32px] md:h-[600px]">
            {demo && <RoomViewer room={demo} state={EMPTY} products={NO_PRODUCTS} mode="blocks" selected={null} onSelect={() => {}} />}
          </div>
          {hero && <FitCard {...hero} className="absolute top-4 left-4 lg:top-7 lg:left-auto lg:right-16" />}
          <figcaption className="mt-3 text-[13px] text-fog">{t("demoCaption")}</figcaption>
        </figure>
      </section>
      <section id="how" className="py-10 md:py-16">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <h2 className="text-[32px] leading-[1.2] md:text-[44px]">{t("howTitle")}</h2>
          <p className="max-w-[380px] text-[15px] leading-[1.5] text-graphite">{t("howNote")}</p>
        </div>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {steps.map(([h, b], i) => (
            <li key={h} className="flex flex-col gap-5 rounded-[28px] bg-paper-white p-3 pb-7">
              <div className="relative h-[240px] overflow-hidden rounded-[20px] bg-sand">
                {i === 0 ? <CaptureScreen /> : i === 1 ? (
                  <div className="flex h-full flex-col items-start justify-center gap-2.5 px-5">
                    {chips.map((o) => <MeasureChip key={o.id} obj={o} size={o.size} />)}
                  </div>
                ) : step && <div className="grid h-full place-items-center"><FitCard {...step} /></div>}
              </div>
              <div className="flex flex-col gap-2 px-4">
                <span className="num text-[12px] text-iris">0{i + 1}</span>
                <h3 className="text-[22px]">{t(h)}</h3>
                <p className="text-[15px] leading-[1.55] text-graphite">{t(b)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section id="try" className="py-10 md:py-16">
        <h2 className="text-[32px] leading-[1.2] md:text-[44px]">{t("tryTitle")}</h2>
        <ol className="mt-6 max-w-2xl space-y-3 text-[17px]">
          <li>1. {t("try1")}</li>
          <li>2. {t("try2")}</li>
          <li>3. {t("try3")}</li>
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={TESTFLIGHT_URL ?? SCAN_STEPS} className={`${button} bg-charcoal text-paper-white`}>{t(TESTFLIGHT_URL ? "getApp" : "buildApp")}</a>
          <a href="/room/demo" className={`${button} border border-ink/16`}>{t("openDemo")}</a>
        </div>
        <p className="mt-4 text-[13px] text-fog">{t("iphoneOnly")}</p>
      </section>
      <footer className="flex flex-col justify-between gap-2 border-t border-ink/8 py-8 text-[13px] text-fog md:flex-row">
        <span>Muse Spark · SAM 3.1 · Muse Image · ARKit</span><span>{t("builtFor")}</span>
      </footer>
    </main>
  );
}

/** A catalog product with its code-checked fit, as a small floating card. */
function FitCard({ product, fit, className = "" }: { product: Product; fit: FitResult; className?: string }) {
  const { lang } = useLang();
  return (
    <div className={`flex w-[280px] items-center gap-3 rounded-[20px] bg-paper-white p-2.5 shadow-float ${className}`}>
      <img src={product.image} alt="" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-xl bg-mist-gray object-cover" />
      <div className="flex min-w-0 flex-col items-start gap-1">
        <span className="line-clamp-1 text-[13px]">{(lang === "en" && product.title_en) || product.title}</span>
        <span className="num text-[14px]">{ntd(product.price)}</span>
        <FitBadge fit={fit} />
      </div>
    </div>
  );
}

/** The iPhone capture app while recording (ios/RoomCapture/RoomCaptureApp.swift), redrawn: status box,
 *  ARKit's yellow feature points and the red Stop button. Its strings stay English, like the app. */
function CaptureScreen() {
  const dots = [[34, 142], [58, 135], [81, 126], [102, 119], [131, 113], [178, 112], [231, 112], [292, 118], [318, 127], [344, 135], [371, 143],
    [122, 88], [118, 61], [279, 92], [282, 66], [166, 72], [214, 58], [240, 84], [70, 178], [140, 168], [205, 182], [262, 166], [320, 186], [105, 206], [238, 214]];
  return (
    <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-[#45403a] via-[#2b2824] to-[#1f1d1a]">
      <svg viewBox="0 0 390 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" fill="none">
        <path d="M0 150 L120 112 L280 112 L390 150 M120 112 V0 M280 112 V0" stroke="rgba(255,255,255,0.08)" strokeWidth={1.5} />
        {dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.5} fill="#ffd60a" />)}
      </svg>
      <div className="num absolute top-3 left-3 flex flex-col gap-0.5 rounded-[7px] bg-black/60 px-2.5 py-2 text-[10px] leading-[1.35] text-white">
        <span className="text-[#34c759]">Tracking: Normal</span>
        <span>Planes: 2 floor/table · 4 wall</span>
        <span className="text-[#ff3b30]">● REC 34 s · 2040 frames</span>
      </div>
      <div className="absolute bottom-4 left-1/2 grid h-11 w-28 -translate-x-1/2 place-items-center rounded-full bg-[#ff3b30] text-[19px] font-bold text-white">Stop</div>
    </div>
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
    <div className="flex h-full flex-col gap-3 px-3 pt-2 md:gap-4 md:px-6 md:pt-4">
      <Header>
        <span className="flex min-w-0 items-center gap-2 text-[15px] md:border-l md:border-ink/14 md:pl-4">
          <span className="hidden truncate sm:inline">{t(id === "demo" ? "roomDemo" : "roomMine")}</span>
          <span className="num truncate text-[13px] text-graphite">
            {(area / 3.3058).toFixed(1)} 坪 · {area.toFixed(1)} m²<span className="sr-only"> · {dims({ w: room.shell.width, d: room.shell.depth, h: room.shell.height })}</span>
          </span>
        </span>
      </Header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-4 md:pb-6">
        <section className="relative h-[46svh] shrink-0 md:h-full md:flex-1">
          <div className="grid-paper relative h-full overflow-hidden rounded-[24px] md:rounded-[28px]">
            <RoomViewer room={room} state={state} products={products} mode={mode} selected={selected}
              onSelect={(sel) => { setSelected(sel); if (room.objects.some((o) => o.id === sel)) setTab("shop"); }} onLabel={setLabel}
              onMove={(id, pose) => setState(moveIn(state, id, pose))} />
            <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col items-start gap-2 md:bottom-5 md:left-5">
              {past.length > 0 && (
                <button onClick={undo} title={`${t("undo")} (Ctrl+Z / ⌘Z)`} className="pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-full bg-paper-white px-4 text-[14px] shadow-float">
                  <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-2" /></svg>
                  {t("undo")}
                </button>
              )}
              <p className="num hidden text-[11px] text-fog md:block">{t("dragHint")}</p>
            </div>
            {label && (obj || placed) && (
              <div className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full" style={{ left: label.x, top: label.y - 6 }}>
                {obj ? <MeasureChip obj={obj} size={state.sizeEdits[obj.id] ?? obj.size} edited={!!state.sizeEdits[obj.id]} onClick={() => setEditing(true)} />
                  : placed && <span className="rounded-full bg-paper-white px-3 py-1.5 text-[13px] shadow-float">{products.get(placed.productId)?.title_en}</span>}
              </div>
            )}
            <div className="absolute top-3 left-3 md:top-auto md:right-5 md:bottom-5 md:left-auto">
              <Segmented label={t("viewMode")} value={mode} onChange={setMode} className="shadow-float"
                items={(["blocks", "walk"] as const).map((k) => ({ key: k, label: t(k) }))} />
            </div>
          </div>
          {editing && obj && <SizeSheet key={obj.id} obj={obj} state={state} setState={setState} close={() => setEditing(false)} />}
        </section>
        <aside className="-mx-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[28px] bg-paper-white shadow-float md:mx-0 md:w-[520px] md:flex-none md:rounded-[28px] md:shadow-none">
          <Tabs label={t("roomSections")} value={tab} onChange={setTab}
            items={[{ key: "chat", label: t("chatTab") }, { key: "shop", label: t("shop"), badge: catalog.length }, { key: "list", label: t("listTab"), badge: state.list.length }]} />
          <div className="min-h-0 flex-1">
            {tab === "chat"
              ? <Chat roomId={id} room={shown} state={state} setState={setState} products={products} turns={turns} setTurns={setTurns} onFocus={setSelected} selected={obj?.id} />
              : tab === "shop" ? <ShopAll room={shown} state={state} setState={setState} products={products} onFocus={setSelected} swap={obj} onClear={() => setSelected(null)} />
              : <div className="h-full overflow-y-auto p-4"><ShoppingList state={state} setState={setState} products={products} t={t} /></div>}
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
