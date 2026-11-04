// Small DESIGN.md components: measurement chip (§5.2, §5.7), fit badge (§5.3), product card (§5.4).
import type { FitResult, Product, RoomObject, Size } from "../lib/types";
import { LABEL_ZH, useLang, useT } from "../lib/i18n";

const cm = (m: number) => Math.round(m * 100);
export const dims = (s: Size) => `${cm(s.w)} × ${cm(s.d)} × ${cm(s.h)} cm`;
export const ntd = (n: number) => `NT$ ${n.toLocaleString("en-US")}`;

export function MeasureChip({ obj, size, edited, onClick }: { obj: RoomObject; size: Size; edited?: boolean; onClick?: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const approx = obj.source === "approx" && !edited;
  return (
    <button onClick={onClick} className="inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full bg-paper-white px-3.5 py-1.5 text-[13px] shadow-float">
      <span className="text-graphite">{lang === "zh" ? LABEL_ZH[obj.label] ?? obj.label : obj.label}</span>
      {edited ? <span aria-hidden>✎</span> : approx ? <span aria-hidden className="h-2 w-2 rounded-full border border-graphite" /> : <span aria-hidden className="h-2 w-2 rounded-full bg-iris" />}
      <span className={`num ${approx ? "text-graphite" : "text-ink"}`}>{approx && "≈ "}{dims(size)}{!edited && ` ±${obj.pm_cm}`}</span>
      {approx && <span className="text-[11px] text-fog">{t("approx")}</span>}
    </button>
  );
}

export function FitBadge({ fit }: { fit: FitResult }) {
  const { lang } = useLang();
  const style = { yes: "bg-mint-wash text-fit-yes", check: "bg-solar-wash text-fit-check", no: "bg-peach-wash text-fit-no" }[fit.status];
  const icon = { yes: "✓", check: "!", no: "✕" }[fit.status];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] ${style}`}>{icon} {lang === "zh" ? fit.reason_zh : fit.reason_en}</span>;
}

export function ProductCard({ product, fit, inList, onShow, onAdd }: { product: Product; fit: FitResult; inList: boolean; onShow: () => void; onAdd: () => void }) {
  const t = useT();
  return (
    <article className="flex w-[216px] shrink-0 snap-start flex-col gap-2 rounded-[22px] border border-ink/10 bg-paper-white p-2.5">
      <div className="relative aspect-square overflow-hidden rounded-[14px] bg-mist-gray">
        <img src={product.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
        <div className="absolute inset-x-2 top-2"><FitBadge fit={fit} /></div>
      </div>
      <h4 className="line-clamp-2 px-0.5 text-[14px] leading-snug">{product.title}</h4>
      <div className="num px-0.5 text-[17px]">{ntd(product.price)}</div>
      {product.size && (
        <span className="num px-0.5 text-[11px] text-graphite">
          ⌂ {dims(product.size)} · {product.size_source === "listing" ? t("store") : `≈ ${t("approx")}`}
        </span>
      )}
      <div className="mt-auto flex gap-1.5 pt-1">
        <button onClick={onShow} className="min-h-11 flex-1 rounded-full bg-charcoal px-4 text-[14px] text-paper-white">{t("showMe")}</button>
        <button onClick={onAdd} disabled={inList} aria-label={inList ? t("added") : t("add")} title={inList ? t("added") : t("add")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ink/14 text-[18px] disabled:text-fog">{inList ? "✓" : "+"}</button>
      </div>
    </article>
  );
}

/** One look for the view switch (Overview / Walk in): the current one sits on a sand pill. */
export function Segmented<K extends string>({ items, value, onChange, label, className = "" }: {
  items: { key: K; label: string }[]; value: K; onChange: (k: K) => void; label: string; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`flex gap-1 rounded-full bg-paper-white p-1 ${className}`}>
      {items.map(({ key, label }) => {
        const on = key === value;
        return (
          <button key={key} onClick={() => onChange(key)} aria-pressed={on}
            className={`inline-flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-full px-4 text-[14px] transition-colors ${on ? "bg-paper text-ink" : "text-graphite"}`}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Panel tabs (Chat / Products / List): text with an ink underline under the current one. */
export function Tabs<K extends string>({ items, value, onChange, label }: {
  items: { key: K; label: string; badge?: number }[]; value: K; onChange: (k: K) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-6 border-b border-ink/8 px-5 md:px-6">
      {items.map(({ key, label, badge }) => {
        const on = key === value;
        return (
          <button key={key} onClick={() => onChange(key)} aria-pressed={on}
            className={`-mb-px inline-flex min-h-13 items-center gap-1.5 border-b-2 text-[15px] ${on ? "border-ink text-ink" : "border-transparent text-fog"}`}>
            {label}
            {badge !== undefined && <span className="num text-[12px]">{badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
