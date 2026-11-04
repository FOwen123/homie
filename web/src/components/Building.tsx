// The build progress shown while the processing server works on a room (DESIGN.md §5.6). App.tsx polls the status.
import { useT, type Key } from "../lib/i18n";
import type { RoomStatus } from "../lib/types";

const STEPS: { stage: string; label: Key }[] = [
  { stage: "measure", label: "stMeasure" }, { stage: "objects", label: "stObjects" }, { stage: "build", label: "stBuild" }, { stage: "check", label: "stCheck" },
];

// Placeholder blocks in an isometric room; they stand for progress, not for the user's furniture. Faces: top, left, right.
const PIECES = [
  ["-110,60 -60,35 -20,55 -70,80", "-110,60 -70,80 -70,95 -110,75", "-70,80 -20,55 -20,70 -70,95"],
  ["60,10 100,30 80,40 40,20", "40,20 80,40 80,70 40,50", "80,40 100,30 100,60 80,70"],
  ["-30,0 10,-20 30,-10 -10,10", "-30,0 -10,10 -10,-40 -30,-50", "-10,10 30,-10 30,-60 -10,-40"],
  ["70,85 100,70 120,80 90,95", "70,85 90,95 90,110 70,100", "90,95 120,80 120,95 90,110"],
  ["-10,95 10,85 30,95 10,105", "-10,95 10,105 10,112 -10,102", "10,105 30,95 30,102 10,112"],
];

/** The full view before the room exists (`overlay` false), or only the status bar over a room still building. */
export function Building({ status, overlay = false }: { status: RoomStatus; overlay?: boolean }) {
  const t = useT();
  if (status.state === "failed") {
    return (
      <div className="rounded-[24px] bg-paper-white p-5 shadow-float">
        <p className="text-[15px]">{t("buildFailed")}</p>
        {status.error && <p className="mt-1 text-[13px] text-graphite">{status.error}</p>}
        <a href="/upload" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-charcoal px-5 text-[15px] text-paper-white shadow-button">{t("uploadAgain")}</a>
      </div>
    );
  }
  const queued = status.state === "queued";
  const at = Math.max(0, STEPS.findIndex((s) => s.stage === status.stage)); // queued: the first step waits
  const parts = at === 2 ? status.detail?.match(/^(\d+)\/(\d+)$/) : null; // "progress build 3/8" from parts.ts
  const partsDone = parts && +parts[2] ? +parts[1] / +parts[2] : 0;
  const done = queued ? 0 : (at + partsDone) / 4; // finished steps, plus finished parts while building
  const blocks = queued || at === 0 ? 0 : at === 1 ? 1 : at === 2 ? 1 + Math.round(4 * partsDone) : 5;

  const bar = (
    <div className={`flex items-center gap-3.5 rounded-[18px] bg-paper-white px-4 py-3.5 shadow-float ${overlay ? "md:max-w-md" : "absolute inset-x-4 bottom-4 md:inset-x-auto md:left-1/2 md:w-[420px] md:-translate-x-1/2"}`}>
      <svg aria-hidden viewBox="0 0 40 40" className="h-10 w-10 shrink-0 -rotate-90">
        <circle cx="20" cy="20" r="16" fill="none" strokeWidth="4" className="stroke-mist-gray" />
        <circle cx="20" cy="20" r="16" fill="none" strokeWidth="4" strokeLinecap="round" pathLength={1} strokeDasharray={1}
          strokeDashoffset={1 - Math.max(0.03, done)} className="stroke-iris transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none" />
      </svg>
      <div role="status" className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">
          {t(queued ? "queued" : STEPS[at].label)}
          {!queued && status.detail && <span className="num font-normal text-graphite"> · {status.detail}</span>}
          <span className="sr-only"> ({at + 1}/4: {STEPS.map((s) => t(s.label)).join(" → ")})</span>
        </p>
        <p className="text-[13px] text-fog">{t("leaveLink")}</p>
      </div>
    </div>
  );
  if (overlay) return bar;
  return (
    <>
      <svg aria-hidden viewBox="0 0 560 400" className="absolute inset-0 h-full w-full pb-20">
        <g transform="translate(280 150)">
          <g className={`transition-opacity duration-500 ${queued ? "opacity-15" : at === 0 ? "opacity-55" : ""}`}>
            <polygon points="0,150 170,65 0,-20 -170,65" className="fill-paper-white stroke-ink/20" />
            <polygon points="-170,65 0,-20 0,-120 -170,-35" className="fill-mist-gray stroke-ink/20" />
            <polygon points="0,-20 170,65 170,-35 0,-120" className="fill-sand stroke-ink/20" />
          </g>
          {!queued && at === 0 && <line x1="-170" y1="65" x2="0" y2="150" strokeWidth="1.5" strokeDasharray="4 4" className="pulse-dot stroke-iris" />}
          {PIECES.map(([top, left, right], i) => (
            <g key={i} className={`transition duration-500 ease-out motion-reduce:transition-none ${i < blocks ? "opacity-100" : "-translate-y-4 opacity-0"}`}>
              <polygon points={top} className="fill-powder-blue stroke-iris" />
              <polygon points={left} className="fill-[#b6d9fb] stroke-iris" />
              <polygon points={right} className="fill-[#9fcaf5] stroke-iris" />
            </g>
          ))}
        </g>
      </svg>
      {bar}
    </>
  );
}
