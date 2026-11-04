# Room engine plan (name: Homie)

Status: planning. Last updated Wed 2026-11-04, 01:00 Taiwan time.
Hackathon: Meta Global AI Developer Hackathon. Submission due **Thu 2026-11-05, 10:00 Taiwan time**. Aim to submit by 09:00.

## 1. What we are building

A website where you upload a short video of your room. The engine measures the room and everything in it, learns your taste through chat and inspiration photos, then proposes real furniture from Shopee Taiwan that fits. You see each proposal in a 3D view of your room and in a realistic photo (a frame from your video, edited to add or swap the furniture). You buy through the Shopee links yourself.

LINE and WhatsApp come last. The engine and the website come first; a chat app only sends a link to the website.

## 2. Underlying goals

1. **For the user:** know what to buy so the room looks the way they want, be sure it fits, and spend minutes instead of evenings measuring and searching.
2. **For the hackathon:** win by showing something judges have not seen: *measured* on a base iPhone (no LiDAR), with a stated error against a tape measure, using several Meta models working together (Muse Spark, SAM 3.1, Muse Image, MapAnything).
3. **For the business later:** become the place where Taiwan renters plan rooms, earning from affiliate links first and then from pre-measured leads for furniture shops.

## 3. First principles

1. **The job is "buy the right thing", not "make a pretty render".** Every feature must move the user closer to a confident purchase.
2. **Trust comes from honest numbers.** Every size has a value, a ± and a source (measured / estimated / user-entered / listed by store / unknown). Never invent a number.
3. **Show the uncertainty, keep moving.** Sizes we only partly saw are shown with a wider ± and a small "approx." label; the engine never stops to quiz the user about sizes. The user can still correct any size in chat ("my desk is 100 cm").
4. **The model proposes, code enforces.** AI handles taste, language and messy listings. Plain code handles sizes, fit, budget and totals, every time.
5. **Video in, everything else derived.** One capture gives scale, 3D shape, objects, style and the frames for realistic photos.
6. **Design for no LiDAR.** Most phones in Taiwan have none, including ours (base iPhone 17). LiDAR is a bonus when present, never required.
7. **Channel-agnostic engine.** The engine returns plain data (JSON). The website, and later LINE and WhatsApp, only display it.
8. **Taiwan first.** Traditional Chinese search terms, NT$, cm and ping (坪), small rentals, no-drill rules, walk-up stairs and elevators, humidity, earthquake tip-over.

## 4. Decisions already made

| Topic | Decision |
|---|---|
| Input | A walk-around video (30–60 s). Photos optional. |
| Capture app | Option C: a small iOS capture app (`ios/RoomCapture`) records the video plus ARKit camera poses, intrinsics, detected planes and feature points (real scale without LiDAR), then hands it to the website. The website stays the main app. 2026-11-04: no TestFlight; the app is for our own demo. The public uses the website's upload page (`/upload`: drop a file, scan a QR code to open it on a phone, or film in the phone browser); the browser sends ~60 stills, not the video. |
| Accuracy | Run a test first and pick the method with the lowest error (see T1). iPhone app captures use ARKit. Plain videos (2026-11-05): **Muse alone** draws the floor plan from ~12 stills (`pipeline/muse_room.ts`, medium reasoning, 3-6 min; medium and high put nearly every piece on the right wall, low and minimal misplaced several): on the demo room 330 × 430 cm against ARKit's 266 × 386 (+24% / +11%); SAM cut-outs instead of Muse's box crops did not improve the blocks (builder scores 7.9-8.2 vs 8.1-8.3, `eval/sam_crops.ts`), with every piece on the right wall in the right order. MapAnything (images only, tried 2026-11-04) came out 339 × 645 (+27% / +67%) and split pieces, so it was dropped from the live path (still in `eval/`). Every plain-video size is shown as approx. |
| Processing | 2026-11-04: all processing runs on Modal (`pipeline/modal_app.py`): uploads, both pipelines (app captures: `process.ts`; plain videos: `process_video.ts`, no judge since its camera positions are guesses), room storage (volume) and status. The site reads visitors' rooms through the Pages Function `/rooms/*`. The Mac server (`pipeline/server.ts`) stays as a fallback. Fly.io was considered and rejected: its GPUs were retired on 2026-07-31. Raw uploads are deleted once a room is built; rooms are deleted after 30 days. Limits: 10 uploads per visitor and 40 a day in total, videos ≤ 90 s / 300 MB. |
| Agents | 2026-11-04: code runs the steps; agents do the seeing. One builder agent per object, all at once (`pipeline/parts.ts`): parts → render the blocks alone from the object's best view → Muse compares with the photo crop (score, problems, which visible face is the front, size estimate for approx pieces) → rebuild with that note, up to 2 times. The room judge (`pipeline/judge.ts`) picks views so every object is seen and can move, resize, recolor, rotate, push against the wall, face the room, or send an object back to its builder. Code rules win where they are reliable: a piece against a wall keeps its back on the wall (`pipeline/layout.py`). |
| Unclear sizes | Show them with a wider ± ("approx."), never block on them. The demo's point is that mapping, 3D and buying work end to end; a small error rate is acceptable and stated. |
| Taste | Chat plus inspiration photos the user uploads. |
| Views | (a) 3D view of the room, as realistic as we can make it. (b) Realistic photo = a frame from the video, edited with Meta's image model to add or swap furniture. 2026-11-04: the Real view (splat, then video photos) is removed; the 3D view is coloured blocks (no textures) and realism comes from (b). |
| Chat flow | 2026-11-04: default demo flow: the AI lists what the room needs (with target sizes) → the user agrees → it finds the best buy per item, places it as blocks sized from the listing → offers a real photo (Muse Image) → Shopee links. Any other request is answered as asked. Suggested-question chips, swapped for follow-ups after each reply. Live Apify search only when the catalog lacks a category, at most 1 run a day. |
| UI | A chat UI inside the website. The chat is a **personal AI shopping agent** that calls tools (room, search, place, move, fit, photo, list) and updates the 3D view live, not a fixed question script. LINE / WhatsApp later. |
| Buying | Shopee links; the user buys. Checkout opens each item on Shopee, one per tap (2026-11-04). No agent checkout: Shopee has no ordering API for third parties, and buying would mean driving the user's logged-in Shopee account and payment, against Shopee's terms and a payment-security risk. Revisit when agent payments (Visa / AP2) reach Taiwan. |
| Fit | Product sizes come from the listing (parsed by AI, with confidence) and are checked against the room by code. |
| Products | Shopee Taiwan via Apify scrapers for now, results cached. Budget cap: **US$3 total** (raised from 3 runs / US$1 on 2026-11-04); only well-rated, trusted listings enter the catalog; each run capped with Apify's `maxTotalChargeUsd`; usage checked via Apify's usage API before each run. Affiliate API or shop partnerships later. |
| SAM | Still needed: per-object outlines → per-object sizes, tracking across frames, clickable objects in 3D, clean cut-outs for edits. |
| Repo | This repo. History restarted for the new direction; old Desk code is backed up in `../desk-backup-before-reset.bundle`. Product name **Homie** (2026-11-04), site homie-tw.pages.dev (homie.pages.dev is taken). |

## 5. User flow (website v1)

1. **Capture.** Open the capture app (or upload a video on the website). Walk the room slowly for 30–60 s. Upload.
2. **Processing (a few minutes).** The room page opens at once and the room builds in front of you: Measuring → Finding objects → Building (7/13) → Checking (round 2: 6/10). Chat opens once the boxes are in; you can leave and come back to the link.
3. **Your room.** The chat shows "Here's your room": the 3D view and the objects with sizes and ± (partly seen ones marked "approx.").
4. **Talk to the agent.** Free chat: "I need a desk lamp and more storage under NT$3,000", "make it more Japanese", inspiration photos. The agent asks only what it needs (often budget) and acts through tools.
5. **Proposals.** For each slot ("a desk for the window wall") the chat shows 2–3 real products: photo, price in NT$, size, a fit badge ("fits, 14 cm spare"; "won't fit up a 75 cm stairwell") and a Shopee link.
6. **See it.** Tap "Show me" → a realistic photo of your room with that item. Tap "3D" → the item appears in the 3D view at true size.
7. **Refine.** Chat: "cheaper", "more wood", "keep my chair". The plan updates.
8. **Shopping list.** All picks, per-store links, NT$ total, delivery and assembly notes.

## 6. Architecture

```
iOS capture app (Swift, ARKit)          Website (React + TypeScript + Tailwind, three.js)
  video + per-frame poses/intrinsics      chat UI · 3D viewer · realistic photos · shopping list
  + planes                                         │
        │ upload                                   │ JSON API
        ▼                                          ▼
┌────────────────── Engine API (TypeScript, Bun; host to decide) ─────────────────────┐
│ rooms · jobs · chat turns · proposals · fit · catalog search                         │
│ storage: local files for now (video, frames, renders, room memory, sessions)        │
└──────┬───────────────────────┬──────────────────────────┬────────────────────────────┘
       │                       │                          │
       ▼                       ▼                          ▼
 GPU service (Python)     Meta Model API              Apify (Shopee TW scrapers)
 MapAnything (Apache),    muse-spark-1.3 (planner,    → cached product table
 Depth Anything 3         labels, style, listing
 metric (fallback)        parsing), sam-3.1 (masks,
                          tracking), muse-image-1.0
                          (photo edits)
```

Planned folders:

- `ios/`: capture app (rebuild from the backup's ARKit code where useful).
- `engine/`: Bun API server (no Cloudflare Worker; host to decide).
- `gpu/`: Python service for MapAnything and Depth Anything 3, deployed to a GPU host (Modal, Hugging Face Endpoint or Baseten; to decide).
- `web/`: the website.
- `eval/`: accuracy test data, scripts and results.

## 7. Data model (first draft)

- **Measurement**: `{ value_cm, plus_minus_cm, source: measured | estimated | user | listing | unknown, method }`
- **Room**: walls (each with length, height, openings), floor polygon, ceiling height, doors and windows, entry route (front door width, stairs or elevator size), coverage map (which parts were seen).
- **RoomObject**: `id, label (zh + en), category, mask refs per frame, box in 3D, width/depth/height as Measurements, keep | replace | unsure, style notes`.
- **TasteProfile**: style words (zh + en), colors, materials, budget NT$, constraints (no-drill, pets, kids), inspiration image refs.
- **Product**: `source (shopee), url, title, price_NT$, images, shop, rating, dims as Measurements (from listing, with confidence), category`.
- **Slot**: a need in the plan ("desk, window wall, 100–120 cm wide").
- **Proposal**: `slot, product, placement (position + rotation in room), FitResult, render refs`.
- **FitResult**: `fits: yes | no | unknown, clearances, entry route check, reasons`.

## 8. Tests that de-risk the build (run first)

Each test has a pass bar. If one fails, we change the plan before building on it.

| # | Test | How | Pass |
|---|---|---|---|
| T1 | **Measurement accuracy** (the core claim) | Tape-measure ~7 items in our room (3 walls, bed, desk, door, window). Record one walk-around with the capture app. Measure each item with: (a) ARKit planes, (b) ARKit poses + SAM 3.1 masks (footprint on the floor plane, height from frames), (c) reference-object scale from the door only (simulates a plain web video), (d) optional: Depth Anything 3 metric on the Mac. MapAnything later. | Best method: median error ≤5%, no item worse than 10%. Output: error table and chart per item and method. |
| T2 | **Object sizes via SAM** | SAM 3.1 masks on frames → lift into the T1 3D model → box size per object. | Bed, desk and door within 10%. |
| T3 | **Shopee product data** | Apify scraper, Taiwan, 10 furniture searches in Traditional Chinese (e.g. 白色書櫃 寬60). Muse parses sizes from title, specs and description. | ≥60% of results have usable W×D×H; parsed sizes match the listing text on a 20-item spot check. Note cost and speed. |
| T4 | **Realistic photo edit** | `muse-image-1.0` edits on 3 frames from the video: add a lamp, swap the chair, add a rug. | The room stays recognisably ours (walls, light, perspective); the item looks plausible. Latency noted. |
| T5 | **3D view on phones** | Load the T1 3D result in the web viewer on iPhone Safari, LINE's in-app browser and a laptop. | Opens in under 5 s, rotates smoothly (≥30 fps), stays under ~30 MB. |
| T6 | **End-to-end latency** | Full run from upload to first proposal. | Under 3 minutes, with visible progress. |

## 9. Work items

Each item lists what "done" means. Details get added under each item as we go.

### Phase 0 – Setup
- [ ] 0.1 Restart repo history with this plan. **Done:** GitHub `main` has one commit; backup bundle verified.
- [ ] 0.2 Decide the GPU host and get an account. **Done:** a hello-world GPU function responds.
- [ ] 0.3 Apify account and token; Meta API key stored as a secret (never in the repo).

### Phase 1 – Capture and accuracy (T1, T2)
- [ ] 1.1 iOS capture mode: record video, save per-frame pose, intrinsics and timestamps, plus detected planes, as one package. **Done:** a 60 s capture uploads, and the package opens in a script with frame count and poses.
- [ ] 1.2 Tape-measure ground truth for the test room (`eval/ground_truth.json`).
- [ ] 1.3 Method A: ARKit planes and raycast measurements.
- [ ] 1.4 Method B: MapAnything (Apache weights) with ARKit poses on the GPU service.
- [ ] 1.5 Method C: Depth Anything 3 metric on keyframes.
- [ ] 1.6 Method D: reference-object scale (door height).
- [ ] 1.7 Eval script and report: error per item per method. **Done:** table and chart committed in `eval/`; winner chosen.

### Phase 2 – Room memory
- [ ] 2.1 Keyframe selection (sharp, well spread).
- [ ] 2.2 Muse Spark labels objects and style per keyframe; SAM 3.1 outlines and tracks them.
- [ ] 2.3 Lift masks into 3D → object boxes and sizes, as Measurements.
- [ ] 2.4 Walls, floor, ceiling, doors and windows from planes and 3D.
- [ ] 2.5 Coverage checks → each size gets a ± that widens when the object was only partly seen (no blocking questions).
- [ ] 2.6 Store the Room as JSON. **Done:** the API returns Room JSON for our test room, matching T1 within the chosen method's error.

### Phase 3 – Website shell
- [ ] 3.1 Upload page and job progress.
- [ ] 3.2 Chat UI: streaming agent messages, tool-result cards (products, fit badges, photos), image upload for inspiration.
- [ ] 3.3 3D viewer: point cloud or mesh of the room, object boxes, click to select, products at true size.
- [ ] 3.4 Shareable room link. **Done:** the link opens on phone and laptop (T5).

### Phase 4 – Taiwan catalog
- [ ] 4.1 Apify fetch, US$3 total, Traditional Chinese queries covering the main furniture categories; cache results to a local file (T3).
- [ ] 4.2 Muse extracts dimensions, material and color from each listing, with confidence.
- [ ] 4.3 Search function: slot + taste → ranked products.

### Phase 5 – Planner and fit
- [ ] 5.1 Shopping agent: Muse with tools get_room, search_products, place_item, move_item, remove_item, check_fit, render_photo, set_taste, shopping_list. Taste and budget come from the conversation and photos → TasteProfile.
- [ ] 5.2 Planner (Muse): room + taste → slots with size ranges and zh search terms.
- [ ] 5.3 Fit engine (code): wall space, clearance, door swing, entry route (door, stairs, elevator), no-drill and tip-over flags.
- [ ] 5.4 Refinement turns ("cheaper", "keep my chair") update the plan.

### Phase 6 – Realistic photos
- [ ] 6.1 Pick the best frame for the slot's wall.
- [ ] 6.2 `muse-image-1.0` edit with the product photo and placement prompt; SAM mask for swaps (T4).
- [ ] 6.3 Show it in chat with "AI-generated preview" labelling.

### Phase 7 – Demo and submission
- [ ] 7.1 Clean demo room capture; cached products so the demo never depends on a live scraper.
- [ ] 7.2 3-minute video: problem → capture → measured room (with the T1 accuracy slide) → chat → proposals → realistic photo → shopping list.
- [ ] 7.3 README, make the repo public, list contributors, submit the form.

### Later (after the hackathon)
- LINE Official Account and WhatsApp: send the room link, product carousels, price-drop alerts, "paste a Shopee link → does it fit?".
- App Clip so iPhone users capture without installing.
- LiDAR path for Pro phones (RoomPlan) as a precision bonus.
- Shopee affiliate API or shop partnerships; momo, PChome, IKEA, NITORI.
- Voting on proposals in a LINE group.
- Agent checkout when Visa / AP2 support reaches Taiwan.
- Shop dashboard: pre-measured leads.

Current focus (Wed 02:00): the 3D model from the video and the website's UX/UI. Shopee and chat apps come after.

## 10. Hackathon cut (by Thu 09:00 Taiwan time)

About 32 hours from this plan. In priority order:

1. T1 accuracy result (even if only methods A and B). This is the headline.
2. Room memory for one room: objects with sizes, plus "please re-film" requests.
3. Website: upload or a pre-processed demo room, chat, product cards with Shopee links, fit badges.
4. Realistic photo edit for at least one proposal.
5. 3D view with the room and products at true size.
6. Video, README, public repo, submission.

If time runs short, cut 5 before 4. A pre-processed demo room with cached products is fine, as long as the video says so.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Accuracy worse than 10% | T1 first; fall back to the best method plus "measure one thing" prompts; show ± honestly. |
| MapAnything setup or GPU cost | DA3 metric or ARKit-only as fallbacks; one GPU host only. |
| Shopee scrapers break or lack sizes | Cache everything; AI size extraction with confidence; mark "no size on listing". |
| Scraping terms | Small cached sample for the demo; move to the affiliate API later. |
| Image edits change the room | Use SAM masks to limit the edited area; label previews as AI-generated. |
| 3D view too heavy for phones | Downsample the point cloud; show boxes plus the photo view. |
| Time | Hackathon cut above; reuse the old ARKit and Muse/SAM code from the backup. |

## 12. Open questions

- GPU host: Modal, Hugging Face Endpoints or Baseten?
- Product name.
- Which Apify scraper gives the best Taiwan data for the price (decided by T3)?

## Appendix: what we learned from Rumi and PIXX-AR (HackMIT 2026)

- **Rumi**: LiDAR + Apple RoomPlan → layout, mesh, photos and depth in one package → web 3D editor (React Three Fiber) with layout, photo-textured surfaces and an AI "simulated room". Exa + OpenAI for products. No chat app, no checkout. Code: https://github.com/IBS27/rumi
- **PIXX-AR**: one photo → Gemini style analysis → SerpAPI Google Shopping → product cut-outs on the photo at true size, scaled from a reference the user taps; WebXR AR only on Android; doorway and stairs fit; simulated Visa agent checkout. Code: https://github.com/ygadipalli/hackmit
- Shared lessons: the model proposes, code enforces; keep listed / estimated / unknown sizes separate; product dimensions are the hardest data.
