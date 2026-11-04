# Homie — Design

> Drafting paper, one blue pen: warm paper, ink type, and a single iris-blue pen that only marks what we measured. Mockups: Spark file "Projects", page "Homie".

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
| Paper | `#f4f1eb` | `--color-paper` | Page canvas; the engine's chat bubbles; quick replies |
| Sand | `#ece8e0` | `--color-sand` | 3D viewer surface (with a faint 32px grid, `.grid-paper`) and step visuals |
| Paper White | `#ffffff` | `--color-paper-white` | Cards, the chat panel, sheets, floating controls |
| Mist Gray | `#f6f5f2` | `--color-mist-gray` | Behind product photos, "unknown" chips |
| Ink | `#14130f` | `--color-ink` | Headings, measured values, primary text |
| Charcoal | `#14130f` | `--color-charcoal` | Filled buttons, the user's chat bubbles, Homie's avatar |
| Graphite | `#57544c` | `--color-graphite` | Body text, estimated values |
| Fog | `#6e6a62` | `--color-fog` | Helper text, source labels, "unknown" values |
| Iris Blue | `#0069e0` | `--color-iris` | Dimension lines, measured-value accents, 3D selection, focus rings, underlined links |
| Powder Blue | `#cce7ff` | `--color-powder-blue` | Selected object highlight, progress track, pressed buttons |
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
| **Fraunces** (Google Fonts) | Latin display and headings (h1, h2) | 400 | Tracking −0.025em. |
| **Noto Serif TC** (Google Fonts) | Chinese display and headings | 600 | Fallback in the display stack; 600 because 400 reads thin. Tracking 0. |
| **Geist** (free) | UI, body | 500, 600 (10–12 px labels only) | Tracking −0.01em. Card titles (h3) use Geist, not the display face. |
| **Geist Mono** (Google Fonts) | Every size and price (the `.num` class) | 400 | Reads like annotations on a drawing; tabular. |
| **PingFang TC → Noto Sans TC** | Chinese text in UI and numbers | 500 | Fallback in the UI and mono stacks. **Tracking 0 for Chinese.** |

```css
--font-display: 'Fraunces', 'Noto Serif TC', ui-serif, serif;
--font-ui: 'Geist', 'PingFang TC', 'Noto Sans TC', ui-sans-serif, system-ui, sans-serif;
--font-mono: 'Geist Mono', 'PingFang TC', 'Noto Sans TC', ui-monospace, monospace;
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
- **Depth:** the shift from Paper canvas to white cards does the work. No shadow on cards; product cards use a 1px ink border at 10%. Two shadows only:
  - Button: `0 1px 2px rgba(20,19,15,.6)` (save buttons in sheets)
  - Floating elements (3D controls, size chip, the phone's chat sheet): `0 10px 24px rgba(40,32,20,.08)`
- **Tap targets:** at least 44×44px.

## 5. Components

### 5.1 Buttons
- **Primary:** Charcoal fill, white text, pill, 12px 24px padding (mobile full width), Geist 16px/500, button ring shadow. One per screen: "上傳影片 Upload video", "Show me", "Open in Shopee".
- **Secondary:** no fill, Ink text, 1px ink border at 14–16% opacity, pill.
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
White, 22px radius, 1px ink border at 10%, 10px padding, 216px wide. Top: product photo (1:1, 14px radius, on Mist) with the fit badge over its top-left corner. Then: name (14px, 2 lines max), price `NT$ 2,490` (Geist Mono 17px), size line (listing, mono 11px). Actions: "Show me" (primary, fills the row) and a round "+" add-to-list button (✓ once added). The Shopee link lives in the shopping list. Shown in a horizontal snap carousel.

### 5.5 Chat
- **Panel:** white, 28px radius, 520px wide on desktop. On phones it is a sheet under the 3D view with a 28px top radius.
- **Tabs:** text tabs (Chat / Shop) with a 2px ink underline under the current one; the Shop tab shows the list count in mono. Shop holds the shopping list (with checkout) on top and every product that fits below.
- **Engine message:** Paper bubble, 22px radius (6px top-left, next to Homie's avatar: the house mark on a 28px ink circle), body-lg Ink, max width 85%.
- **User message:** Charcoal bubble, white text, right-aligned, 6px bottom-right corner.
- **Rich messages** (product carousel, photo preview, list) break out of the bubble to full width.
- **Composer:** pill input with a 1px ink border at 14%, camera button for inspiration photos, round Charcoal send button with an up arrow.
- **Quick replies:** one horizontal, swipeable row of Paper pill chips just above the composer, fading at the right edge; first-visit questions, then follow-ups that fit the last reply.

### 5.6 Processing progress
Before the room exists: an isometric empty room on the grid surface assembles itself. The walls fade in and a dashed Iris line pulses along the floor while measuring; Powder Blue blocks with Iris edges drop in as objects are found and each builder part finishes (the server's `3/8`). The blocks are placeholders for progress, never the user's furniture. A Paper White status bar sits at the bottom: an Iris progress ring (finished steps plus finished parts), the step name, the server's detail in mono Graphite, and "you can leave" in Fog. Once the room shows in 3D but is still building, only the status bar stays, at the top of the viewer.

### 5.7 Approx. size, tap to correct
Partly seen sizes never block the user and never trigger a question. They use the estimated chip (§5.2) with a wider ± and a caption-size "約 approx." tag, e.g. `○ ≈ 86 × 50 cm ±15 · 約 approx.` Tapping it opens a small sheet with the method ("From ARKit points, 6 frames") and a numeric cm input; a saved value becomes a `user` chip (✎). The chat agent accepts the same correction in words ("my desk is 100 cm").

### 5.8 3D room viewer
- Sand surface with a faint 32px grid (`.grid-paper`), 28px radius (24px on phones). No frame around it.
- Room mesh in its real colors. Selected object gets an Iris outline; proposed products appear at true size with an Iris outline until accepted.
- **Dimension lines** (Overview only): 1px Iris lines for the room's width (near floor edge), depth (side floor edge) and height (far corner), with extension lines and end ticks, each labelled by a white pill with an Iris border and the value in mono cm. This is the "single bold pen stroke". A label that would fall under the move buttons hides.
- Two views in a segmented control (white pill, the current view on a Paper pill): bottom-right on desktop, top-left on phones. **Overview** (俯視, dollhouse from above) and **Walk in** (走進去, first person at 1.55 m eye height, starting just inside the door). Realism comes from Muse Image photos, not a third view.
- A slim move strip on the right edge, the same in both views: forward/back (zoom in/out in Overview), turn left/right, reset, and **Light**: a bulb with a three-axis gizmo (like Blender) that moves the light, so the shadows follow, plus a brightness slider (top-right on desktop, bottom on phones).
- Undo (復原) sits bottom-left once anything changed, above the keyboard hint; Ctrl+Z / ⌘Z does the same. Press and hold to keep moving; each button has a label for screen readers.
- Keyboard: the view takes focus (Tab) and shows the iris focus ring. Arrow keys or WASD move and turn.
- Drag to look or orbit, two fingers pan and zoom in Overview.

### 5.9 Realistic photo preview
A frame from the user's video with the edited furniture, 24px radius, full width. A caption pill always sits in the top-left corner: "AI 生成預覽 AI-generated preview" on Paper White at 90%. A before/after slider uses a white 2px handle.

### 5.10 Taste tiles and inspiration
Sand tiles, 24px radius, for style words ("北歐 Nordic", "原木 Natural wood"). Uploaded inspiration photos sit in a 3-column grid of 16px-radius thumbnails. No more than two pastel washes in one view.

### 5.11 Shopping list
Paper card at the top of the Shop tab. One row per pick: thumbnail, name, NT$ price (right-aligned, tabular), Shopee link. A primary "Check out on Shopee" button opens one item per tap (browsers block several tabs at once) and counts through them ("Next item 2/3"); payment happens on Shopee. Group rows by shop. A sticky footer shows the total `NT$ 12,860` (heading) and delivery and assembly notes in body-sm Graphite.

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

The live values are in `web/src/index.css` (`@theme`); the tables above match them.

```css
@theme {
  --color-paper: #f4f1eb;
  --color-sand: #ece8e0;
  --color-paper-white: #ffffff;
  --color-mist-gray: #f6f5f2;
  --color-ink: #14130f;
  --color-charcoal: #14130f;
  --color-graphite: #57544c;
  --color-fog: #6e6a62;
  --color-iris: #0069e0;
  --color-powder-blue: #cce7ff;
  --color-mint-wash: #d3f6e3;
  --color-solar-wash: #fff2be;
  --color-peach-wash: #ffe4d6;
  --color-fit-yes: #116a3e;
  --color-fit-check: #8a5300;
  --color-fit-no: #b42318;

  --font-display: 'Fraunces', 'Noto Serif TC', ui-serif, serif;
  --font-ui: 'Geist', 'PingFang TC', 'Noto Sans TC', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'PingFang TC', 'Noto Sans TC', ui-monospace, monospace;

  --radius-card: 32px;
  --radius-card-sm: 24px;
  --radius-image: 24px;
  --radius-input: 16px;

  --shadow-float: 0 10px 24px rgba(40, 32, 20, 0.08);
  --shadow-button: 0 1px 2px rgba(20, 19, 15, 0.6);

  --ease-settle: cubic-bezier(0.16, 1, 0.3, 1);
}
```

Use the built-in `rounded-full` for pills.
