# Room engine (name: Homie, homie-tw.pages.dev)

A website where a Taiwan renter uploads a walk-around video of their room. The engine measures the room and everything in it, learns their taste through chat and inspiration photos, and proposes real Shopee Taiwan furniture that fits, shown in a 3D view of the room and in realistic photos (frames from the video edited with Meta's image model). The user buys through the Shopee links. Built for the Meta Global AI Developer Hackathon: submission due **Thu 2026-11-05 10:00 Taiwan time**, so the repo goes public then.

- `PLAN.md` holds goals, first principles, decisions, tests (T1–T6) and work items. Read it before changing direction, adding a feature or picking the next task, and update it when a decision changes.
- `DESIGN.md` holds the visual design system. Read it before building or changing any UI.

**Current focus:** the 3D model of the room from the video, and the website's UX/UI. Shopee comes next; LINE and WhatsApp come last (they only send a link to the website).

## Layout

- `ios/RoomCapture/`: Swift capture app. Records video plus ARKit camera poses, intrinsics, planes and feature points. Its only job is to hand a capture to the website.
- `eval/`: accuracy tests and research scripts. Outputs go to `eval/out/` (git-ignored).
- `pipeline/`: capture → room bundle (`process.ts` runs every step). `modal_app.py` hosts processing on Modal (uploads, MapAnything for plain videos via `video_capture.py` + `rescale.py`, room storage, status); `server.ts` is the Mac fallback through a Cloudflare tunnel.
- `web/`: the website (Vite + React + three.js) and its API (Cloudflare Pages Functions in `web/functions/`).

## Stack

- **Bun + TypeScript** for all JavaScript work: the engine, the website and scripts. Use `bun install`, `bun add`, `bun run` and `bunx`; each package keeps a `bun.lock`.
- **Python** only for numerical scripts in `eval/`, run through uv with dependencies inline (`uv run --with numpy python eval/…`), so nothing is installed globally.
- **iOS:** the Xcode project is generated. Edit `ios/project.yml`, run `xcodegen generate` in `ios/`, build with `xcodebuild`, install with `xcrun devicectl` on the test phone "Hao" (base iPhone 17, **no LiDAR**).
- **Hosting:** Cloudflare Pages (static site + Pages Functions); room processing and visitors' rooms on Modal (`pipeline/modal_app.py`), read through the Pages Function `/rooms/*`. Cloudflare Workers were removed from the project.

## Models and paid services

- Meta Model API at `https://api.meta.ai/v1`: `muse-spark-1.3` (labels, style, planning, listing parsing), `sam-3.1` (object outlines, decoded with `@meta-sam/parser`), `muse-image-1.0` (photo edits). The rules require Meta models; prefer them for every AI step.
- **Apify** (Shopee scraper): US$3 in total (raised from US$1 on 2026-11-04). Only well-rated, trusted listings go into the catalog (thresholds in `pipeline/catalog.ts`). Set `maxTotalChargeUsd` on every run and check usage with `GET /v2/users/me/limits` first. Cache results to a file and reuse them.
- **Modal**: hosts processing (`pipeline/modal_app.py`, tokens in `.env`, secret "homie"); MapAnything on an A100 for plain videos, about US$0.05 a run. Keep test runs on the Mac under ~2 GB of memory (one at a time).
- Ask the user before adding any other paid service, or spending beyond these caps.

## Secrets

Keys live in `.env` (git-ignored); `.env.example` lists every name and where to get it. Scripts load `.env` themselves. Keep key values out of commands' output, logs, commits and chat. When a new secret is needed, add its name to `.env.example` and ask the user to fill in `.env`.

## Measurement rules

- Every size carries a value, a ± and a source: measured, estimated, user, listing or unknown. Never invent a number; when a size is unclear or a part of the room is missing, the engine asks the user to re-film or tape-measure it.
- The model proposes, code enforces: fit, clearance, budget and totals are plain deterministic code.
- Prove accuracy against the user's tape measurements (`PLAN.md` T1) before building on a method.

## Capture format (ios/RoomCapture output)

- One folder per capture: `video.mov`, `frames.jsonl`, `features.jsonl`, `planes.json`, `meta.json`.
- Coordinates are ARKit world space in meters, y up, gravity aligned. Transforms and intrinsics are stored column-major (`np.array(x).reshape(4,4).T`).
- Video frame *i* = line *i* of `frames.jsonl`. Feature points are saved on every 10th frame.
- Pixels are in sensor (landscape) orientation, matching the intrinsics. Decode with `ffmpeg -noautorotate`; rotate 90° clockwise (`transpose=1`) only for images that people or Muse see, and map results back.
- Pull captures from the phone with `xcrun devicectl device copy from --domain-type appDataContainer --domain-identifier com.owen.RoomCapture --source Documents/captures`.
