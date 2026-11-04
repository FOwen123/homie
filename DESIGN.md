# Roomie TW — Design

> Soft daylight notebook: generous margins, one bold pen stroke. The pen stroke is the blue tape-measure line.

The look of the room engine in `PLAN.md`: a chat website where your own room, measured, is the hero, and every number shows how sure we are.

**Theme:** light only (v1).

## 1. Principles

1. **Your room is the picture.** The imagery is the user's video frames, their 3D room and real product photos. Nothing decorative competes with them.
2. **Honest numbers look different from guesses.** Every size shows value, ± and source (see §5.2). A number without ± never appears.
3. **One dense element per screen.** The near-black button is the only heavy thing; the rest is pale canvas, paper cards and type.
4. **Blue means measured.** Iris blue is reserved for dimension lines, measured values and selection in 3D. Don't use it as decoration.
5. **Phone first.** Most users arrive from LINE's in-app browser on an iPhone. Design at 390 px wide, then scale up.
6. **Traditional Chinese first.** zh-TW copy is primary, English secondary. NT$, cm, 坪.

## 2. Colors

| Name | Value | Token | Role |
|---|---|---|---|
| Sky Tint | `#ebf5ff` | `--color-sky-tint` | Page canvas; 3D viewer background |
| Bone White | `#fafdff` | `--color-bone-white` | Cards, chat bubbles from the engine, panels |
| Paper White | `#ffffff` | `--color-paper-white` | Modals, sheets, text on dark buttons |
| Mist Gray | `#f6f7f8` | `--color-mist-gray` | Secondary surfaces, the user's chat bubbles, "unknown" chips |
| Ink | `#0a0d12` | `--color-ink` | Headings, measured values, primary text |
| Charcoal | `#181d27` | `--color-charcoal` | Filled buttons (the only dense element) |
| Graphite | `#535862` | `--color-graphite` | Body text, estimated values |
| Fog | `#6b7079` | `--color-fog` | Helper text, source labels, "unknown" values. 4.9:1 contrast on cards |
| Iris Blue | `#0069e0` | `--color-iris` | Dimension lines, measured-value accents, 3D selection, focus rings, underlined links |
| Iris Gradient | `linear-gradient(rgb(71,157,255) 11.43%, rgb(0,105,224) 78.2%)` | `--gradient-iris` | 3px frame around the room preview only |
| Powder Blue | `#cce7ff` | `--color-powder-blue` | Selected object highlight, progress track |
| Lavender Wash | `#f1e6ff` | `--color-lavender-wash` | Taste / style tiles, inspiration photos |
| Mint Wash | `#d3f6e3` | `--color-mint-wash` | "Fits" badge background |
| Solar Wash | `#fff2be` | `--color-solar-wash` | "Check this" badge: tight fit, re-film request |
| Peach Wash | `#ffe4d6` | `--color-peach-wash` | "Won't fit" badge background |

**Status text colors.** Use them only on their matching wash, for contrast:

| Name | Value | Token | On |
|---|---|---|---|
| Fit Green | `#116a3e` | `--color-fit-yes` | Mint Wash |
| Check Amber | `#8a5300` | `--color-fit-check` | Solar Wash |
| No-Fit Red | `#b42318` | `--color-fit-no` | Peach Wash |

Shopee orange is never part of our UI. It appears only inside Shopee's own logo on a link.

## 3. Typography

| Family | Use | Weights | Notes |
|---|---|---|---|
| **General Sans** (free, Fontshare) | Display and headings | 500 only | Tracking −0.02em. |
| **Geist** (free) | UI, body, numbers | 500, 600 (10–12 px labels only) | Tracking −0.01em. Set `font-variant-numeric: tabular-nums` on all measurements and prices. |
| **PingFang TC → Noto Sans TC** | All Chinese text | 500 | Fallback in both stacks. **Tracking 0 for Chinese**, since negative tracking crowds the characters. |

```css
--font-display: 'General Sans', 'PingFang TC', 'Noto Sans TC', ui-sans-serif, system-ui, sans-serif;
--font-ui: 'Geist', 'PingFang TC', 'Noto Sans TC', ui-sans-serif, system-ui, sans-serif;
```

Type scale (mobile → ≥1024 px). Headings use display; the rest use UI.

| Role | Mobile | Desktop | Line height | Tracking (Latin) | Use |
|---|---|---|---|---|---|
| hero | 48px | 96px | 1.05 | −0.02em | Landing headline only |
| display | 36px | 56px | 1.1 | −0.02em | Section openers, "Here's your room" |
| heading-lg | 28px | 40px | 1.17 | −0.02em | Screen titles |
| heading | 22px | 28px | 1.25 | −0.02em | Card titles, room total area |
| subheading | 18px | 20px | 1.4 | −0.01em | Product names, chat headings |
| body-lg | 17px | 18px | 1.45 | −0.01em | Chat messages |
| body | 15px | 16px | 1.45 | −0.01em | Default |
| body-sm | 13px | 14px | 1.35 | −0.01em | Specs, source labels |
| caption | 11px | 12px | 1.35 | 0 | Badges, "AI-generated preview" |

The hero caps at 96px; this is a chat app, not a poster. Chat messages use 17px, not 16px, so iOS Safari doesn't zoom into inputs.

## 4. Space, shape, depth

- **Base unit 8px.** Scale: 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 120.
- **Mobile:** 16px page margin, 16–24px card padding, 12px gap. **Desktop:** max-width 1200px, 40px card padding, 24px gap, 80px between sections.
- **Radius:** cards 32px (24px on mobile), images and 3D viewer 24px, inputs 16px, small cards 16px, buttons, badges and chips 9999px. No sharp corners anywhere.
- **Depth:** the shift from canvas `#ebf5ff` to card `#fafdff` does the work. No shadow on cards. Two shadows only:
  - Button ring: `0 1px 2px rgba(10,13,18,.8), 0 0 0 1px #0a0d12`
  - Floating elements (chat composer, bottom sheet, 3D toolbar): `0 14px 20px 4px rgba(4,69,144,.08)`
- **Tap targets:** at least 44×44px.

## 5. Components

### 5.1 Buttons
- **Primary:** Charcoal fill, white text, pill, 12px 24px padding (mobile full width), Geist 16px/500, button ring shadow. One per screen: "上傳影片 Upload video", "Show me", "Open in Shopee".
- **Secondary:** Bone White fill, Ink text, 1px `#0a0d12` at 12% opacity border, pill.
- **Ghost:** text only, Graphite, for "Skip" or "Measure it myself".
- Never fill a button with Iris Blue.

### 5.2 Measurement chip (core component)
Shows one `Measurement` from `PLAN.md` §7. Geist tabular numbers, pill, body-sm.

| Source | Look | Example |
|---|---|---|
| measured | Ink value, Iris-blue dot | `● 182 cm ±3` |
| estimated | Graphite value, `≈` prefix, hollow dot | `○ ≈ 75 cm ±8` |
| user | Ink value, pencil icon | `✎ 210 cm` |
| listing | Ink value, tag icon, "store" label | `⌂ 120 × 60 × 75 cm · store` |
| unknown | Fog `—`, Mist background, tap to ask | `— 尚未量到 Not measured` |

Tapping a chip shows the method in a small sheet ("From ARKit planes, 4 frames"). Values are always cm. Area is shown in 坪 with m² secondary.

### 5.3 Fit badge
Pill, caption size, icon + short reason. Always backed by `FitResult` from code, never by the model.
- **Fits:** Mint Wash / Fit Green, "✓ 放得下 · 剩 14 cm"
- **Check:** Solar Wash / Check Amber, "! 很剛好 · 剩 2 cm" or "! 尺寸未標示 No size listed"
- **Won't fit:** Peach Wash / No-Fit Red, "✕ 樓梯 75 cm 搬不上去"

### 5.4 Product card
Bone White, 24px radius, 16px padding. Top: product photo (1:1, 16px radius, on Mist). Then: name (subheading, 2 lines max), price `NT$ 2,490` (heading, Ink, tabular), size chip (listing), fit badge, shop and rating (body-sm, Fog). Actions: "Show me" (primary) and "3D" plus a Shopee link (secondary). Shown in a horizontal snap carousel inside chat, 2–3 cards per slot.

### 5.5 Chat
- **Engine message:** Bone White bubble, 24px radius (8px on the corner nearest the avatar), body-lg Ink, max width 85%.
- **User message:** Mist Gray bubble, right-aligned.
- **Rich messages** (room summary, product carousel, photo preview) break out of the bubble to full width as cards.
- **Composer:** fixed bottom, Paper White, pill input (16px radius when multi-line), floating shadow, camera button for inspiration photos, send button in Charcoal.
- **Quick replies:** pill chips in Bone White: "便宜一點 Cheaper", "更多木頭 More wood", "保留我的椅子 Keep my chair".

### 5.6 Processing progress
Vertical list of the 5 steps from `PLAN.md` §5 (frames → scale → 3D → objects → sizes). Done: Ink text + Iris check. Current: Ink + a soft pulsing Powder Blue dot. Waiting: Fog. A thin Powder Blue track with an Iris fill sits on top. Show the latest keyframe thumbnail beside it so the wait feels like progress.

### 5.7 Approx. size, tap to correct
Partly seen sizes never block the user and never trigger a question. They use the estimated chip (§5.2) with a wider ± and a caption-size "約 approx." tag, e.g. `○ ≈ 86 × 50 cm ±15 · 約 approx.` Tapping it opens a small sheet with the method ("From ARKit points, 6 frames") and a numeric cm input; a saved value becomes a `user` chip (✎). The chat agent accepts the same correction in words ("my desk is 100 cm").

### 5.8 3D room viewer
- Background Sky Tint, 24px radius, inside the iris-gradient 3px frame on the room summary only.
- Room point cloud or mesh in its real colors, lightly desaturated. Object boxes as 1.5px Graphite outlines; selected object gets an Iris outline and a Powder Blue fill at 30%.
- Dimension lines: 1.5px Iris with end ticks and a white pill label holding the measurement chip. This is the "single bold pen stroke".
- Proposed products appear at true size with an Iris outline until accepted.
- Three views in a floating segmented control at the bottom: **Overview** (俯視, dollhouse from above), **Walk in** (走進去, first person at 1.55 m eye height, starting just inside the door) and **Real** (真實, the scanned room from where the phone stood).
- A slim move strip on the right edge, the same in every view: forward/back (zoom in/out in Overview; disabled in Real), turn left/right, reset. Press and hold to keep moving; each button has a label for screen readers.
- Keyboard: the view takes focus (Tab) and shows the iris focus ring. Arrow keys or WASD move and turn. A hint chip top-left says so on laptops.
- Drag to look or orbit, two fingers pan and zoom in Overview.

### 5.9 Realistic photo preview
A frame from the user's video with the edited furniture, 24px radius, full width. A caption pill always sits in the top-left corner: "AI 生成預覽 AI-generated preview" on Paper White at 90%. A before/after slider uses a white 2px handle.

### 5.10 Taste tiles and inspiration
Lavender Wash tiles, 24px radius, for style words ("北歐 Nordic", "原木 Natural wood"). Uploaded inspiration photos sit in a 3-column grid of 16px-radius thumbnails. No more than two pastel washes in one view.

### 5.11 Shopping list
Paper card. One row per pick: thumbnail, name, NT$ price (right-aligned, tabular), Shopee link. Group rows by shop. A sticky footer shows the total `NT$ 12,860` (heading) and delivery and assembly notes in body-sm Graphite.

## 6. Imagery

- **Primary:** the user's room (video frames, 3D) and real product photos. Never crop products so their size is misleading.
- **Landing and empty states only:** soft clay-style 3D renders of single furniture objects (a lamp, a tape measure, a folded chair) in the pastel palette with one Iris accent, floating with no background. Generate them with Muse Image and keep them out of the working screens.
- No stock photography of staged rooms; it undercuts "your room, measured".

## 7. Motion

- Default ease `cubic-bezier(0.16, 1, 0.3, 1)`, 0.3–0.45s. Sheets and accordions 0.5s.
- Chat messages fade and rise 8px. Product carousels snap.
- Dimension lines draw from end to end (0.6s) when a room first loads: the signature moment for the demo video.
- Respect `prefers-reduced-motion`: no draw-on, no pulsing, instant transitions.

## 8. Do / Don't

**Do**
- Show ± and a source on every number; use `—` when it's unknown.
- Keep display and headings at weight 500.
- Use Charcoal for every filled button, and only one per screen.
- Keep Iris Blue for measurement, selection, focus and underlined links.
- Write zh-TW first, English second, in short phrases.
- Label every AI-edited image.

**Don't**
- Don't let the model's guess look like a measurement (no Ink, no blue dot for estimates).
- Don't use shadows on cards, or pure black `#000` text.
- Don't apply negative letter-spacing to Chinese.
- Don't use Shopee orange or red as UI colors; red appears only in the "won't fit" text.
- Don't put decorative 3D renders on working screens (room, chat, list).

## 9. Tailwind v4 tokens

```css
@theme {
  --color-sky-tint: #ebf5ff;
  --color-bone-white: #fafdff;
  --color-paper-white: #ffffff;
  --color-mist-gray: #f6f7f8;
  --color-ink: #0a0d12;
  --color-charcoal: #181d27;
  --color-graphite: #535862;
  --color-fog: #6b7079;
  --color-iris: #0069e0;
  --color-powder-blue: #cce7ff;
  --color-lavender-wash: #f1e6ff;
  --color-mint-wash: #d3f6e3;
  --color-solar-wash: #fff2be;
  --color-peach-wash: #ffe4d6;
  --color-fit-yes: #116a3e;
  --color-fit-check: #8a5300;
  --color-fit-no: #b42318;

  --font-display: 'General Sans', 'PingFang TC', 'Noto Sans TC', ui-sans-serif, system-ui, sans-serif;
  --font-ui: 'Geist', 'PingFang TC', 'Noto Sans TC', ui-sans-serif, system-ui, sans-serif;

  --radius-card: 32px;
  --radius-card-sm: 24px;
  --radius-image: 24px;
  --radius-input: 16px;

  --shadow-float: 0 14px 20px 4px rgba(4, 69, 144, 0.08);
  --shadow-button: 0 1px 2px rgba(10, 13, 18, 0.8), 0 0 0 1px #0a0d12;

  --ease-settle: cubic-bezier(0.16, 1, 0.3, 1);
}
```

Use the built-in `rounded-full` for pills. Use `--gradient-iris` as plain CSS on the room preview frame (`border-image` or a padded wrapper).
