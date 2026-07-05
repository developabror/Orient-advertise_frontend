---
name: frontend-design
description: Use this skill whenever building any UI in this project — components, pages, landing pages, dashboards, navs, heroes, cards, buttons, forms, layouts, or anything visual. Enforces the Antimetal design system with two modes (dark navy hero gradient #001033 → #0050f8 → #5fbdf7, and light product canvas #f8f9fc on white cards), pill buttons, sharp inputs, blue-tinted shadows, and the chartreuse #d0f100 reserved for CTA fills only. Read before writing any HTML, JSX, CSS, or Tailwind in this repo.
---

# Frontend Design — Antimetal System

This is the **single source of truth** for visual design. Every component built must conform to these tokens. Deviation requires explicit justification.

## Visual Modes (only two)

1. **Dark Navy Hero** — used **once per page**, top fold only.
   - Background: `linear-gradient(180deg, #001033 0%, #0050f8 55%, #5fbdf7 100%)`
2. **Light Product Canvas** — every other section.
   - Background: `#f8f9fc` (canvas) with `#ffffff` cards floating on top.

---

## Color Tokens

| Token | Hex | Usage |
|---|---|---|
| `--color-midnight-navy` | `#1b2540` | All text, all foreground (replaces `#000000`) |
| `--color-deep-cosmos` | `#001033` | Hero/dark surfaces only |
| `--color-chartreuse-pulse` | `#d0f100` | **CTA button fill ONLY** — never decorative |
| `--color-ice-veil` | `#e0f6ff` | Dark-mode ghost button border + text |
| `--color-ghost-canvas` | `#f8f9fc` | Light page background |
| `--color-pure-surface` | `#ffffff` | Card / elevated surfaces |
| `--color-slate-ink` | `#6b7184` | Secondary / muted text |
| Border ring | `rgba(0,39,80,0.04)` | Applied as `0 0 0 1px` outer box-shadow — **not** a CSS border |

### Hero Gradient
```css
background: linear-gradient(180deg, #001033 0%, #0050f8 55%, #5fbdf7 100%);
```

---

## Typography

- **UI font**: `Inter Variable` (system substitute for `abcdFont`).
  - Weights used: `400`, `450`, `480`.
  - Letter-spacing: `-0.016em` (display) → `-0.005em` (body).
- **Display font**: `Fraunces` or `Freight Display` (substitute for `ivarTextFont`).
  - Weight: `400`. Sizes: `32px+`. Tracking: `-0.010em`.
  - `font-feature-settings: "ss04", "ss06";`

### Type Scale
| Name | Size | Common weight |
|---|---|---|
| caption | `13px` | 450 |
| body | `16px` | 450 |
| subheading | `18px` | 480 |
| heading-sm | `22px` | 480 |
| heading | `28px` | 480 |
| heading-lg | `40px` | 400 (display font) |
| display | `48px` | 400 (display font) |

---

## Spacing — 4px base scale

`4, 8, 12, 16, 20, 24, 28, 32, 56, 60, 72, 96, 160, 232` px.

Do not introduce values outside this list.

---

## Radii

| Surface | Radius |
|---|---|
| Buttons | `9999px` (always pill) |
| Cards | `20px` |
| Badges | `16px` |
| Small cards | `6px` |
| **Inputs** | `0px` (sharp — intentional contrast) |

---

## Shadows — blue-tinted, never black

```css
/* Card */
box-shadow:
  rgba(0,39,80,0.03) 0px 56px 72px -16px,
  rgba(0,39,80,0.03) 0px 32px 32px -16px,
  rgba(0,39,80,0.04) 0px 6px 12px -3px,
  rgba(0,39,80,0.04) 0px 0px 0px 1px;

/* Badge */
box-shadow:
  rgba(0,39,80,0.08) 0px 6px 16px -3px,
  rgba(0,39,80,0.04) 0px 0px 0px 1px;

/* CTA Button */
box-shadow:
  rgba(24,37,66,0.32) 0px 1px 3px 0px,
  rgba(24,37,66,0.44) 0px 12px 24px -12px,
  rgba(219,247,255,0.48) 0px 0.5px 0.5px 0px inset;
```

---

## Component Specs

### Chartreuse CTA (primary action)
- bg `#d0f100`, text `#1b2540`
- pill (`9999px`), height `40px`, padding `0 24px`
- CTA shadow stack
- Hover: `transform: translateY(-1px)` only — no color shift

### Dark Ghost Button (used in dark hero)
- bg transparent, border + text `#e0f6ff`
- pill, inset white glow `0 0 0 1px rgba(255,255,255,0.04) inset` ×4 layered

### Light Ghost Button (used in light sections)
- bg transparent, border + text `#1b2540`
- pill, subtle `0 0 0 1px rgba(0,39,80,0.08)` shadow

### Feature Card
- bg `#ffffff`, radius `20px`
- card shadow stack
- internal padding `20px` minimum

### Badge Pill
- radius `16px`, bg `#ffffff`, text `#1b2540` `14px`
- badge shadow

### Nav
- bg `#001033`, sticky, height `64px`
- left: logo
- center: links `#fafeff`, size `15px`, weight `450`
- right: dark ghost button + chartreuse CTA

---

## Layout Rules

- Max-width: `1200px`, centered with `margin-inline: auto`.
- Section vertical gap: `80px`.
- Card padding: `20px`.
- In light mode: **only two surfaces** — `#f8f9fc` canvas + `#ffffff` cards. No third tone.

---

## Hard Rules (validate before shipping)

1. **ONE dark section** per page (hero only). All other sections are light.
2. **NEVER** use `#000000`. All foreground = `#1b2540`.
3. **NEVER** use black-based shadows. Always `rgba(0,39,80,...)` (or `rgba(24,37,66,...)` for CTA).
4. **NEVER** round inputs. Inputs are always `0px` radius.
5. `#d0f100` is **reserved for CTA button fills**. Never as background, accent, or text.
6. Cards/badges use **1px outer box-shadow** as their border substitute — not CSS `border:`.
7. Buttons are always pills (`9999px`).
8. Section spacing: `80px` between sections, no exceptions.

---

## CSS Variables — paste into `:root`

```css
:root {
  --color-midnight-navy: #1b2540;
  --color-deep-cosmos: #001033;
  --color-chartreuse-pulse: #d0f100;
  --color-ice-veil: #e0f6ff;
  --color-ghost-canvas: #f8f9fc;
  --color-pure-surface: #ffffff;
  --color-slate-ink: #6b7184;

  --shadow-card:
    rgba(0,39,80,0.03) 0px 56px 72px -16px,
    rgba(0,39,80,0.03) 0px 32px 32px -16px,
    rgba(0,39,80,0.04) 0px 6px 12px -3px,
    rgba(0,39,80,0.04) 0px 0px 0px 1px;
  --shadow-badge:
    rgba(0,39,80,0.08) 0px 6px 16px -3px,
    rgba(0,39,80,0.04) 0px 0px 0px 1px;
  --shadow-cta:
    rgba(24,37,66,0.32) 0px 1px 3px 0px,
    rgba(24,37,66,0.44) 0px 12px 24px -12px,
    rgba(219,247,255,0.48) 0px 0.5px 0.5px 0px inset;

  --radius-button: 9999px;
  --radius-card: 20px;
  --radius-badge: 16px;
  --radius-input: 0px;

  --gradient-hero: linear-gradient(180deg, #001033 0%, #0050f8 55%, #5fbdf7 100%);
}
```
