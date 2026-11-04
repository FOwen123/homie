// The upload page (/upload): any phone video is checked here, cut into ~1 still a second (at most 60) in the
// browser, and only those stills go to the processing server, with a signed ticket. The video never leaves the phone.
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useT, type Key } from "../lib/i18n";

const MAX_SECONDS = 90;
const MAX_BYTES = 300 * 1024 * 1024;
const MAX_STILLS = 60;
type Phase = { kind: "idle" } | { kind: "preparing" | "uploading"; pct: number } | { kind: "error"; msg: Key };

/** Upright JPEG stills spread over the video (the browser applies the phone's rotation). */
async function stills(file: File, onPct: (p: number) => void) {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = URL.createObjectURL(file);
  try {
    await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = bad; });
    await v.play().catch(() => undefined); // iOS draws nothing for a video that never played
    v.pause();
    const n = Math.min(MAX_STILLS, Math.max(8, Math.floor(v.duration)));
    const s = Math.min(1, 1920 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * s);
    c.height = Math.round(v.videoHeight * s);
    const g = c.getContext("2d")!;
    const out: Blob[] = [];
    for (let k = 0; k < n; k++) {
      const seeked = new Promise((ok) => { v.onseeked = ok; });
      v.currentTime = ((k + 0.5) * v.duration) / n;
      await seeked;
      g.drawImage(v, 0, 0, c.width, c.height);
      out.push(await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("no frame"))), "image/jpeg", 0.85)));
      onPct((k + 1) / n);
    }
    return out;
  } finally {
    URL.revokeObjectURL(v.src);
  }
}

/** Length of a video in seconds, read from its metadata only. */
function seconds(file: File) {
  return new Promise<number>((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(v.src);
      if (Number.isFinite(v.duration)) resolve(v.duration);
      else reject(new Error("no duration"));
    };
    v.onerror = () => { URL.revokeObjectURL(v.src); reject(new Error("unreadable")); };
    v.src = URL.createObjectURL(file);
  });
}

export function Upload() {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [qr, setQr] = useState<string>();
  const phone = matchMedia("(pointer: coarse)").matches;

  useEffect(() => {
    if (!phone) QRCode.toDataURL(`${location.origin}/upload`, { margin: 1, width: 160, color: { dark: "#0a0d12", light: "#fafdff" } }).then(setQr);
  }, [phone]);

  const fail = (status?: number) => setPhase({ kind: "error", msg: status === 429 ? "errBusy" : status === 503 ? "errOffline" : "errFailed" });

  const upload = async (file: File) => {
    setPhase({ kind: "preparing", pct: 0 });
    const frames = await stills(file, (pct) => setPhase({ kind: "preparing", pct })).catch(() => null);
    if (!frames) return setPhase({ kind: "error", msg: "errNoLength" });
    setPhase({ kind: "uploading", pct: 0 });
    const ticket = await fetch("/api/upload-ticket", { method: "POST" }).catch(() => null);
    if (!ticket?.ok) return fail(ticket?.status);
    const { url, ticket: token } = (await ticket.json()) as { url: string; ticket: string };
    const form = new FormData();
    frames.forEach((b, k) => form.append("frames", b, `f${String(k).padStart(3, "0")}.jpg`));
    const xhr = new XMLHttpRequest(); // fetch has no upload progress
    xhr.open("POST", url);
    xhr.setRequestHeader("x-homie-ticket", token);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setPhase({ kind: "uploading", pct: e.loaded / e.total }); };
    xhr.onerror = () => fail();
    xhr.onload = () => {
      let id: string | undefined;
      try { id = (JSON.parse(xhr.responseText) as { id?: string }).id; } catch { id = undefined; }
      if (xhr.status < 300 && id) location.assign(`/room/${encodeURIComponent(id)}`);
      else fail(xhr.status);
    };
    xhr.send(form);
  };

  const pick = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_BYTES) return setPhase({ kind: "error", msg: "errTooBig" });
    const len = await seconds(file).catch(() => null);
    if (len === null) return setPhase({ kind: "error", msg: "errNoLength" });
    if (len > MAX_SECONDS) return setPhase({ kind: "error", msg: "errTooLong" });
    void upload(file);
  };

  const busy = phase.kind === "uploading" || phase.kind === "preparing";
  const pct = Math.round((busy ? phase.pct : 0) * 100);
  return (
    <section className="mx-auto max-w-2xl py-6 md:py-12">
      <h1 className="text-[36px] leading-[1.1] md:text-[56px]">{t("upTitle")}</h1>
      <ul className="mt-4 space-y-1 text-[16px] text-graphite">
        <li>{t("upTip1")}</li>
        <li>{t("upTip2")}</li>
        <li>{t("upTip3")}</li>
      </ul>
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]); }}
        className="mt-8 rounded-[32px] bg-bone-white p-8 text-center md:p-12">
        <p className="text-[16px] text-graphite">{t("dropHere")}</p>
        <button onClick={() => input.current?.click()} disabled={busy}
          className="mt-4 min-h-12 rounded-full bg-charcoal px-6 text-[16px] text-paper-white shadow-button disabled:opacity-40">{t("uploadVideo")}</button>
        <input ref={input} type="file" accept="video/*" capture="environment" className="sr-only" aria-hidden tabIndex={-1}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pick(f); }} />
        {busy && (
          <div className="mt-6">
            <p className="num text-[14px] text-graphite">{t(phase.kind === "preparing" ? "preparing" : "uploading")} {pct}%</p>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mt-2 h-2 overflow-hidden rounded-full bg-powder-blue">
              <div className="h-full bg-iris transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {phase.kind === "error" && <p role="alert" className="mt-6 text-[15px]">{t(phase.msg)}</p>}
      </div>
      <p className="mt-6 text-[14px] text-fog">{t("upPrivacy")}</p>
      {qr && (
        <figure className="mt-10 flex items-center gap-5">
          <img src={qr} alt="" width={160} height={160} className="rounded-[16px]" />
          <figcaption className="text-[15px] text-graphite">{t("qrHint")}</figcaption>
        </figure>
      )}
    </section>
  );
}
