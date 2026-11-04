// The build steps shown over a room while the processing server works on it (DESIGN.md §5.6). App.tsx polls the status.
import { useT, type Key } from "../lib/i18n";
import type { RoomStatus } from "../lib/types";

const STEPS: { stage: string; label: Key }[] = [
  { stage: "measure", label: "stMeasure" }, { stage: "objects", label: "stObjects" }, { stage: "build", label: "stBuild" }, { stage: "check", label: "stCheck" },
];

export function Building({ status }: { status: RoomStatus }) {
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
  const at = Math.max(0, STEPS.findIndex((s) => s.stage === status.stage)); // queued: the first step waits
  return (
    <div className="rounded-[24px] bg-paper-white p-5 shadow-float">
      <ol className="grid grid-cols-4 gap-2" aria-label={STEPS.map((s) => t(s.label)).join(" → ")}>
        {STEPS.map((s, i) => (
          <li key={s.stage} aria-current={i === at ? "step" : undefined} className={`h-1.5 rounded-full ${i < at ? "bg-iris" : i === at ? "pulse-dot bg-powder-blue" : "bg-mist-gray"}`}>
            <span className="sr-only">{t(s.label)}</span>
          </li>
        ))}
      </ol>
      <p className="num mt-3 text-[14px] text-ink">
        {t(STEPS[at].label)}
        {(status.detail || status.state === "queued") && <span className="text-graphite"> · {status.detail || t("queued")}</span>}
      </p>
      <p className="mt-1 text-[13px] text-fog">{t("leaveLink")}</p>
    </div>
  );
}
