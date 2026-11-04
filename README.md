# Roomie

**Film your room. Get it measured. Buy furniture that actually fits.**

Roomie turns a one-minute iPhone walk-around into a measured 3D room, then a personal AI shopping agent proposes real Shopee Taiwan products, checks in code that they fit, places them in the 3D room, and shows them in a realistic photo of your own room. You buy through the Shopee links.

Live demo: **https://roomie-tw.pages.dev/room/demo** (works on phones and laptops; zh-TW / English).

Built for the Meta Global AI Developer Hackathon (indie track).

## What it does

1. **Capture** (`ios/RoomCapture`, app name Roomie): records video plus ARKit camera poses, intrinsics, detected planes and feature points. Works on iPhones without LiDAR. One tap uploads it.
2. **Measure** (`pipeline/`): Muse Spark labels the furniture in keyframes, SAM 3.1 outlines each object, and the outlines are projected onto ARKit's surfaces to measure them. On our test room the bed came out 196 × 94 cm against 188 × 100 cm by tape measure, and the door at exactly 80 cm. Objects seen only partly are marked "approx." with a wider ±.
3. **Rebuild**: Muse rebuilds every object from simple coloured parts at its measured size, like an architect's block model. A **judge loop** renders the blocks from the real camera positions, asks Muse what doesn't match the real frames, applies its fixes, and keeps them only if the match improves.
4. **Realistic view**: a Gaussian splat of the room, fitted on Apple Silicon with [msplat](https://github.com/rayanht/msplat) from the same frames and ARKit poses, viewed in the browser with [Spark](https://sparkjs.dev).
5. **Shop** (`web/`): a Muse Spark agent with tools (search the catalog, place / move / remove items, fix sizes, render a photo, build the list). Fit, clearance, door and ceiling checks are deterministic code; the model proposes, code enforces. Muse Image edits a real video frame to show a chosen product in place, always labelled as an AI preview.

## Meta models used

| Model | Used for |
|---|---|
| `muse-spark-1.3` | object labels, the shopping agent (tool calling), the judge |
| `muse-spark-1.3-contributor` | parts models and catalog parsing for public product listings and our own demo room |
| `sam-3.1` | exact object outlines for measurement and cut-outs |
| `muse-image-1.0` | realistic "your room with this product" previews |

## Run it

Requires Bun, uv, ffmpeg, Xcode + XcodeGen (for the app), and a Meta Model API key in `.env` (see `.env.example`).

```bash
# website + API functions locally (Cloudflare Pages emulator)
cd web && bun install && bun run build && bunx wrangler pages dev dist

# process a capture folder into a room bundle
bun pipeline/process.ts <capture_dir> web/public/rooms/<id>

# processing server for uploads (registers a Cloudflare tunnel with the site)
bun pipeline/server.ts
```

Public use has soft daily limits (chat, photos, uploads) and every chat request has a bounded size and output, so casual use can't drain the API credits. The limits are KV counters, not atomic: a burst of concurrent requests can pass a few extra; the real ceiling is the Meta account's credit. Uploaded rooms are published to the site but never committed.

## Scan your own room

The capture app is not on the App Store or TestFlight yet. With a Mac and Xcode:

1. `cd ios && xcodegen generate && open Roomie.xcodeproj`, pick your team and iPhone, then Run.
2. Walk slowly around the room for about a minute, pointing at every wall and piece of furniture, then tap Stop.
3. Tap Upload. The site processes it (about 5 minutes) and the app opens your room.

Any iPhone with ARKit works; LiDAR is not needed.

## Limits, honestly

- Sizes for non-flat furniture (chairs, wardrobes) come from sparse ARKit points or a floor-ray estimate and are labelled approx.
- Most Shopee listings don't state dimensions in the title, so their sizes are estimated from the photo and fit badges say so.
- The product catalog is a cached sample of 77 Shopee Taiwan listings (storage, lamps, rugs).
