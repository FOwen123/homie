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
    <button onClick={onClick} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-paper-white px-3 py-1.5 text-[13px] shadow-float">
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
    <article className="flex w-64 shrink-0 snap-start flex-col gap-2 rounded-[24px] bg-bone-white p-4">
      <div className="aspect-square overflow-hidden rounded-2xl bg-mist-gray">
        <img src={product.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
      </div>
      <h4 className="line-clamp-2 text-[17px] leading-snug">{product.title}</h4>
      <div className="num font-display text-[22px]">{ntd(product.price)}</div>
      {product.size && (
        <span className="num inline-flex w-fit items-center gap-1 rounded-full bg-mist-gray px-2.5 py-1 text-[13px]">
          ⌂ {dims(product.size)} · {product.size_source === "listing" ? t("store") : `≈ ${t("approx")}`}
        </span>
      )}
      <FitBadge fit={fit} />
      <p className="text-[13px] text-fog">
        {[product.rating && `★ ${product.rating.toFixed(1)}`, product.reviews && `${product.reviews.toLocaleString("en-US")} ${t("reviews")}`,
          product.rank && `${t("bestSeller")} #${product.rank}`, product.shop].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <button onClick={onShow} className="min-h-11 rounded-full bg-charcoal px-4 text-[15px] text-paper-white shadow-button">{t("showMe")}</button>
        <button onClick={onAdd} disabled={inList} className="min-h-11 rounded-full border border-ink/12 bg-bone-white px-4 text-[15px] disabled:text-fog">
          {inList ? t("added") : t("add")}
        </button>
        <a href={product.url} target="_blank" rel="noreferrer" className="min-h-11 content-center text-[14px] text-iris underline">{t("openShopee")}</a>
      </div>
    </article>
  );
}

/** One look for every either/or control (view modes, panel tabs): charcoal pill marks the current one. */
export function Segmented<K extends string>({ items, value, onChange, label, className = "" }: {
  items: { key: K; label: string; badge?: number }[]; value: K; onChange: (k: K) => void; label: string; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`flex gap-1 rounded-full bg-paper-white p-1 ${className}`}>
      {items.map(({ key, label, badge }) => {
        const on = key === value;
        return (
          <button key={key} onClick={() => onChange(key)} aria-pressed={on}
            className={`inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] transition-colors ${on ? "bg-charcoal text-paper-white" : "text-graphite"}`}>
            {label}
            {badge !== undefined && <span className={`num rounded-full px-1.5 text-[12px] ${on ? "bg-paper-white/15" : "bg-mist-gray"}`}>{badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
