# Homie

**Film your room. Get it measured. Buy furniture that actually fits.**

Homie turns a one-minute walk-around video of your room into a 3D room with sizes, then a personal AI shopping agent proposes real Shopee Taiwan products, checks in code that they fit, places them in the 3D room, and shows them in a realistic photo of your own room. You buy through the Shopee links.

Live site: **https://homie-tw.pages.dev** · demo room: **https://homie-tw.pages.dev/room/demo** (works on phones and laptops; zh-TW / English).

Built for the Meta Global AI Developer Hackathon (indie track).

## What it does

1. **Capture**, two ways in:
   - **Any phone, on the website** (`/upload`): drop a video, scan a QR code to open the page on a phone, or film right in the phone browser. The browser cuts the video into ~60 stills and sends only those; the video never leaves the phone. On a GPU, **MapAnything** turns the stills into 3D points and cameras, and the scale comes from known-size objects (median of door height, bed length, desk height). These sizes are rougher and always shown as approx.
   - **Our iPhone app** (`ios/RoomCapture`, app name Homie, used for the demo): records video plus ARKit camera poses, intrinsics, detected planes and feature points, for measured sizes. Works on iPhones without LiDAR.
2. **Measure** (`pipeline/`): Muse Spark labels the furniture in keyframes, SAM 3.1 outlines each object, and the outlines are projected onto ARKit's surfaces to measure them. On our test room the bed came out 196 × 94 cm against 188 × 100 cm by tape measure, and the door at exactly 80 cm. Objects seen only partly are marked "approx." with a wider ±.
3. **Rebuild** with agents, all running at once: each piece's box is fitted to its SAM outlines and gets its own photo crop. One **builder agent per object** rebuilds it as simple coloured parts, then checks its own work: code draws the blocks alone from the object's best camera view, Muse compares them with the photo (score, problems, which face is the front, size estimate), and the object is rebuilt with that note, up to twice. Then a **room judge** renders the whole room from camera positions chosen so every object is seen, and moves, resizes, turns, pushes to the wall or sends an object back to its builder; code limits every fix and keeps a round only if the match improves. Plain code keeps pieces square to the walls and their backs against the wall they stand at. The room page shows it building live: Measuring → Finding objects → Building (7/13) → Checking.
4. **Shop** (`web/`): a Muse Spark agent with tools (search the catalog, place / move / remove items, fix sizes, render a photo, build the list). Ask "what does my room still need?" and it lists the gaps with target sizes; say yes and it finds the best buy for each, places it in 3D at the listing's size, and offers a real photo. You can drag or turn any piece (it turns red if it hits a wall, furniture or the door's swing) and undo with Ctrl+Z / ⌘Z. Fit, clearance, door and ceiling checks are deterministic code; the model proposes, code enforces. Muse Image edits a real video frame to show a chosen product in place, always labelled as an AI preview.

## Meta models used

| Model | Used for |
|---|---|
| `muse-spark-1.3` | object labels, the shopping agent (tool calling), the judge |
| `muse-spark-1.3-contributor` | parts models and catalog parsing for public product listings and our own demo room |
| `sam-3.1` | exact object outlines for measurement and cut-outs |
| MapAnything (Apache weights) | 3D points and cameras from a plain phone video (on a Modal GPU) |
| `muse-image-1.0` | realistic "your room with this product" previews |

## Run it

Requires Bun, uv, ffmpeg, Xcode + XcodeGen (for the app), and a Meta Model API key in `.env` (see `.env.example`).

```bash
# website + API functions locally (Cloudflare Pages emulator)
cd web && bun install && bun run build && bunx wrangler pages dev dist

# process a capture folder into a room bundle
bun pipeline/process.ts <capture_dir> web/public/rooms/<id>

# processing on Modal: uploads, the pipeline, MapAnything, room storage (Modal tokens and secret: see the file)
uv run --with modal modal deploy pipeline/modal_app.py

# fallback: processing server on a Mac (registers a Cloudflare tunnel with the site)
bun pipeline/server.ts
```

Public use has soft daily limits (chat, photos, uploads) and every chat request has a bounded size and output, so casual use can't drain the API credits. The limits are KV counters, not atomic: a burst of concurrent requests can pass a few extra; the real ceiling is the Meta account's credit. Uploads go to Modal; raw uploads are deleted once the room is built, and rooms (with the uploaded frames and furniture crops they keep) after 30 days. They are never committed.

## Scan your own room

Easiest: open **https://homie-tw.pages.dev/upload** on any phone and film. For measured sizes, use the iPhone app (not on the App Store; with a Mac and Xcode):

1. `cd ios && xcodegen generate && open Roomie.xcodeproj`, pick your team and iPhone, then Run.
2. Walk slowly around the room for about a minute, pointing at every wall and piece of furniture, then tap Stop.
3. Tap Upload. The site processes it (about 5 minutes) and the app opens your room.

Any iPhone with ARKit works; LiDAR is not needed.

## Limits, honestly

- A room from a plain video is rougher than one from the app: MapAnything's walls can come out bent and the room a bit too big, so every size is approx.
- Sizes for non-flat furniture (chairs, wardrobes) come from sparse ARKit points or a floor-ray estimate and are labelled approx.
- Most Shopee listings don't state dimensions in the title, so their sizes are estimated from the photo and fit badges say so.
- The product catalog is a cached sample of 77 Shopee Taiwan listings (storage, lamps, rugs).
