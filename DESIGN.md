# Design system

Sea Glass identity as shipped. Sources: `assets/sea-glass.css` (tokens and components; header says generated from `src/tokens.json`, do not hand-edit), `assets/health.css` (app skin plus the Impeccable refine layer). Product context: `PRODUCT.md`.

## Identity

- Frosted, translucent glass surfaces over a soft, hue-shifted ambient canvas.
- Two glass recipes only: **Clear** (quiet chrome) and **Regular** (sheets, scrolled bars, tooltips).
- One brand hue (215) with analogous offsets for the background orbs.

## Color

Theme set by `[data-sf-theme="dark"]`, with `color-scheme` matched.

| Role | Light | Dark |
|---|---|---|
| Canvas | `#edf0f3` | `#151d2a` |
| Ink / strong ink | `#202b36` / `#152331` | `#e8f0fa` / `#f5f8fd` |
| Muted | `#4e5b69` (health skin: `#434f5c`) | `#c5cfdb` |
| Positive | `#255c4b` | `#a9e4cb` |
| Negative | `#9a4049` | `#ffbfc4` |
| Focus | hsl(215 80% 31%) | hsl(215 85% 78%) |

**Hue system:** `--sf-hue: 215`, `--sf-saturation: 82%`. Accent, accent-soft and selection fills derive from hue and saturation. `[data-sf-neutral="true"]` forces saturation to 0%. Orbs use hue +70, +35, -35 and +65. Health skin maps `--teal` to hue 74% 34% (light) and 85% 76% (dark). `--amber` is `#7d4c0c` light and `#f0c88a` dark.

## Typography

- Family: Google Sans, then the system UI stack. Falls back offline.
- Base 15px / 1.5. Scale tokens: 12, 13, 15, 16, 20, 28px, plus display `clamp(38px, 4.8vw, 68px)`.
- App sizes: h2 26px / 650; brand 20px; section eyebrow 17px / 630.
- Numerals: hero 40-54px, kcal 40px, stat values 28px, all at weight 500. Readouts use `tabular-nums`.
- Labels: 12-13px at weight 610-650. Headings use `text-wrap: balance`; paragraphs use `pretty`.

## Spacing, radii, size

- Space scale (px): 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radii (px): sm 10, md 14, lg 20, xl 26; controls and chips 999.
- Controls: 40, 48, 56px. Touch minimum 44px. Icons 22px (18 small, 26 large).
- Cards: 20px padding. Page gutter 16px, max width 820px.

## Glass material

| Recipe | Alpha light / dark | Blur | Saturation |
|---|---|---|---|
| Regular | .32 / .48 | 22px | 1.35 |
| Clear | .08 / .16 | 8px | 1.14 |

- Fill is a reflection gradient over `--sf-glass-fill`. Borders are none; an inset optical edge replaces them.
- Sticky header escalates Clear to Regular when scrolled (`data-sf-scroll-glass`).
- Sheets, tooltip and nav use Regular or Clear per the rules above.
- Shadows: `--sf-shadow` (surfaces) and `--sf-shadow-control` (buttons).

## Motion

Tokens: immediate 130ms, quick 200ms, normal 280ms, spatial 440ms, reveal 560ms. Ease `cubic-bezier(.16, 1, .3, 1)`.

Authored moments:

1. **Staggered card entrance:** `.panel.on` children rise 10px, 440ms, with 40ms steps capped at 200ms.
2. **Nav lens:** a sliding pill (`.nav .lens`) moves and resizes over 440ms; per-button background is removed.
3. **Count-up:** CSS defines only the `.kcal .cu` hook (weight inherit). No keyframes in the stylesheets.
4. **Meal entrance:** `.ml.in` fades in, rises 8px and scales from 98.5%, 440ms.
5. **Chart reveal:** `#chart svg.ch` wipes in left to right over 900ms.
6. **Skeleton:** `.skl i` shimmer, 1.3s linear loop.

Supporting motion: macro bars and progress fill over 560ms; buttons scale to 98% on press.

## Components

- **Hero:** accent-gradient card, xl radius, 18px padding, large figure, two-stat row below a rule.
- **Cards and mini tiles:** `.card` (glass, lg radius); `.mini` tiles on the card fill.
- **Folded details cards:** `details.fold`; summary at least 44px; chevron rotates 180° on open; body inset 20px.
- **Food composer:** `.fin` textarea 48px, grows to 92px on focus or content; 48px send button.
- **Chips:** pill, 44px, selected state uses selection fill. Single scrolling row with edge mask, or wrapped in `.chips`.
- **7-day strip:** `.strip`, seven `.dt` columns with 8px bars. States: logged (teal), amber at 70% opacity, today (outline).
- **Progress track:** `.trk`, 10px bar, teal fill, 3px ink plan marker.
- **Macro bars:** `.bar`, 9px; `.hit` adds a glow and turns the value green.
- **Bottom nav:** fixed, four equal columns, 56px buttons, selected lens pill.
- **Sheets:** `.mod`, bottom-anchored, 86vh max; centered card at 620px and up.

## Accessibility

- **Reduced motion:** transitions 0.01ms; panel, sheet, meal, skeleton and chart animations off; lens transition off.
- **Reduced transparency:** sheets and tooltip fall back to solid canvas; scrim becomes solid 60%. `data-glass="on"` overrides the device setting.
- **Forced colors:** buttons, nav, switch, chips and tabs get `CanvasText` borders.
- **Focus:** 2px outline, 3px offset, `--sf-focus`; hidden on mouse focus only.
- **Targets:** 44px minimum; primary controls 48px.
- **Chart text:** axis labels 16 viewBox units on phones (about 10px rendered), 12 on wider screens.
- **Skip link:** `.sf-skip-link` appears on focus.

## Known gaps

- `--nav` is set twice in `health.css` (96px, then 112px). The later value applies.
- Light muted text is darkened in the health skin, not in `sea-glass.css`.
