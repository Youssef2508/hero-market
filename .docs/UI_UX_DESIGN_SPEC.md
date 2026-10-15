# HeroMarket POS – UI/UX Design Specification

> This spec was written before the redesign and updated to match the shipped implementation. Token names below are the real CSS custom properties in `src/renderer/src/styles/tokens.css`.

## 1. Product principles

1. **The checkout path is the product.** Scan → see the line → see the total → choose payment → pay. Each step has one obvious place on screen and works from the keyboard.
2. **Calm, dense where it matters, never cramped.** Money and quantities get the largest, most stable type; secondary information recedes.
3. **One application.** Every screen uses the same shell, page header, toolbar, table, form, dialog and feedback patterns.
4. **Arabic first, RTL native.** Layout, reading order, icons that imply direction, and numbers are designed for RTL. Numbers are Latin digits with tabular figures (as stored and printed by the system).
5. **Motion explains, never delays.** Feedback is ≤ 200 ms and never blocks scanning or payment.
6. **Preserve behaviour.** Visual changes never alter business rules (see `BUSINESS_LOGIC.md`).

## 2. Brand

| Item            | Value                                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product name    | **HeroMarket POS** (Arabic UI label: «هيرو ماركت»)                                                                                                                                                         |
| Brandmark       | A rounded evergreen tile with a geometric **H** whose crossbar is a pair of retail shelves and an emerald "product" block resting on the upper shelf – H + aisle + goods. Files in `resources/brand/`.     |
| Wordmark        | "Hero" in weight 800, "Market" in 500, followed by a small "POS" tag                                                                                                                                       |
| Primary colours | Evergreen `#153B32`, Emerald `#159A72`                                                                                                                                                                     |
| Usage           | The mark sits on evergreen or on light neutrals; on dark backgrounds use the same tile (it carries its own background). Minimum size 16 px. Do not recolour the shelves or place the mark on busy imagery. |

## 3. Colour system

Semantic tokens; components must not use raw hex values.

| Token                                                               | Light                     | Dark                  | Use                                           |
| ------------------------------------------------------------------- | ------------------------- | --------------------- | --------------------------------------------- |
| `--bg`                                                              | `#F4F6F3`                 | `#0D1412`             | App background                                |
| `--surface`                                                         | `#FBFCFA`                 | `#141D1A`             | Panels, cards                                 |
| `--surface-raised`                                                  | `#FFFFFF`                 | `#19241F`             | Primary work surfaces (cart, dialogs, inputs) |
| `--surface-sunken`                                                  | `#EDF1EC`                 | `#0F1714`             | Table headers, insets, read-only fields       |
| `--surface-hover`                                                   | `#EEF3EF`                 | `#1D2A25`             | Row/item hover                                |
| `--border`                                                          | `#DCE3DD`                 | `#26332E`             | Default dividers                              |
| `--border-strong`                                                   | `#C3CDC5`                 | `#35463F`             | Inputs, emphasised outlines                   |
| `--text`                                                            | `#17231F`                 | `#E7EEEA`             | Primary text (14.9:1 / 15.8:1)                |
| `--text-2`                                                          | `#4A5953`                 | `#A9B7B0`             | Secondary text                                |
| `--text-3`                                                          | `#5F6E67`                 | `#8A9993`             | Muted / meta (≥ 4.9:1)                        |
| `--brand`                                                           | `#153B32`                 | `#153B32`             | Sidebar, brand surfaces                       |
| `--accent`                                                          | `#12825F`                 | `#34C391`             | Primary actions, selection                    |
| `--accent-hover`                                                    | `#0E6E50`                 | `#4BD3A2`             |                                               |
| `--on-accent`                                                       | `#FFFFFF`                 | `#06231A`             | Text on accent (4.8:1 / 7.4:1)                |
| `--accent-soft` / `--accent-text`                                   | `#E3F4EC` / `#0E6B4F`     | `#123329` / `#5FD3A6` | Selected states, positive money               |
| `--success`, `--warning`, `--danger`, `--info` (+ `-soft`, `-text`) | see `tokens.css`          |                       | Feedback and status                           |
| `--focus-ring`                                                      | `0 0 0 3px` emerald @ 40% | same, brighter        | Keyboard focus                                |

Rules: one accent; colour never the only carrier of meaning (icons/labels accompany status); destructive actions use `--danger` only at the point of commitment.

## 4. Typography

- Family: **Cairo Variable** (bundled locally via `@fontsource-variable/cairo`, offline-safe), fallback `Segoe UI, Tahoma, sans-serif`.
- Numbers: `font-variant-numeric: tabular-nums` on all money/quantity cells (`.num`, `.money`).

| Token          | Size / line-height | Weight | Use                                |
| -------------- | ------------------ | ------ | ---------------------------------- |
| `--fs-xs`      | 12 / 16            | 500    | Meta, badges                       |
| `--fs-sm`      | 13 / 20            | 500    | Table meta, helper text            |
| `--fs-md`      | 14 / 22            | 500    | Body, table cells, inputs          |
| `--fs-lg`      | 16 / 24            | 600    | Section titles, cashier line names |
| `--fs-xl`      | 20 / 28            | 700    | Page titles                        |
| `--fs-2xl`     | 26 / 32            | 700    | KPI values                         |
| `--fs-display` | 40 / 44            | 800    | Amount due on the cashier screen   |

## 5. Spacing, sizing, radius, elevation

- Spacing scale (`--sp-1…--sp-10`): 4, 8, 12, 16, 20, 24, 32, 40 px.
- Control heights: `--ctl-sm` 32, `--ctl-md` 40, `--ctl-lg` 48, cashier pay button 56.
- Radius: `--r-sm` 6 (controls), `--r-md` 10 (cards, panels), `--r-lg` 14 (dialogs). Pills only for badges/chips.
- Elevation: `--shadow-1` (cards), `--shadow-2` (popovers), `--shadow-3` (dialogs). Dark theme relies on borders more than shadows.

## 6. Layout and navigation

```
┌──────────────────────────────────────────────┬────────────┐
│ Topbar: page title · breadcrumb   [shift] [user] │  Sidebar   │
├──────────────────────────────────────────────┤  (brand,   │
│ Page content (PageHeader → toolbar → body)   │  groups,   │
│                                              │  theme)    │
└──────────────────────────────────────────────┴────────────┘
```

- **Sidebar** on the right (RTL start). Expanded 240 px; compact 72 px icon rail with tooltips. Compact is automatic below 1200 px window width and can be toggled; the choice is remembered.
- **Groups**: البيع (Cashier, Tills) · نظرة عامة (Overview) · التقارير (Performance, Advanced reports, Cashier evaluation, Product report) · المخزون (Products, Reorder assistant, Damaged goods) · الحسابات (Invoices & returns, Customers, Suppliers, Cheques, Expenses) · الإدارة (Shifts, Users*, Event log, Backup). Management groups are shown only to `admin`/`manager`; Users only to `admin` – identical to the original permissions.
- **Topbar**: page title + group breadcrumb; shift status chip; periodic drawer count; open/close shift; user menu (change PIN, lock/sign out).
- **Page pattern**: `PageHeader` (title, description, primary action) → toolbar (search/filters) → content cards/tables → pagination.

## 7. Cashier screen

```
┌ Cart column ─────────────────────────────┬ Checkout panel (360px) ┐
│ [▮ Scanner input (focus)] [🔍 Search F2] │  المطلوب  1,234.50     │
│ ┌ Cart table ──────────────────────────┐ │  subtotal / discount  │
│ │ # | الصنف + barcode | سعر | كمية ± | إجمالي | × │ │  Payment methods grid │
│ │ ...                                  │ │  Discount | Paid      │
│ └──────────────────────────────────────┘ │  Change due           │
│ items · qty · [shortages] [clear Esc]    │  Customer (+delivery) │
│ F1 pay · F2 search · F3 qty · F4 · Esc   │  [ تأكيد الدفع F1 ][🖨]│
└──────────────────────────────────────────┴────────────────────────┘
```

- Scanner input is the visual and focus anchor; it auto-focuses exactly as before.
- Cart rows show name (primary), barcode (mono, secondary), unit price, quantity stepper (input + −/+), line total; newly added/incremented lines flash briefly and scroll into view.
- Amount due uses `--fs-display`; change due is coloured only when positive.
- Payment methods are a 3-column segmented grid with icons + labels and a strong selected state; credit/split keep their "customer required" guard.
- Pay button is pinned to the bottom of the checkout panel, always visible at 1000×630.
- Low stock moves to a "النواقص" button with count, opening a popover with print/PDF actions.

## 8. Components (implemented in `components/ui` and `styles/components.css`)

Button (`primary | secondary | ghost | danger | success`, sizes sm/md/lg, icon-only requires `aria-label`), IconButton, Field (label + control + hint/error), Input/Select/Textarea, SearchInput, SegmentedControl, Badge (neutral/accent/success/warning/danger/info), StatCard, Card/Panel with header, PageHeader, DataTable styles (`.table`), EmptyState, Spinner/LoadingState, Dialog (`.modal-overlay` + `.modal-content` + `.modal-header/body/footer`), Toast, Kbd, Tooltip (native `title` + CSS for the rail), ThemeToggle.

States: hover (surface-hover), active (pressed scale 0.98 for buttons), focus-visible (focus ring, never removed), disabled (40% opacity + not-allowed), selected (accent-soft + accent border), error (danger border + message).

## 9. Motion

| Use                                                            | Duration / easing                         |
| -------------------------------------------------------------- | ----------------------------------------- |
| Hover/press                                                    | 120 ms `--ease-out`                       |
| Dialog enter                                                   | 160 ms fade + 8 px rise                   |
| Popover/dropdown                                               | 120 ms fade + 4 px                        |
| Row added flash                                                | 900 ms background fade (no layout shift)  |
| Sidebar compact/expand                                         | 180 ms width                              |
| Theme switch                                                   | 160 ms colour transition on surfaces only |
| All motion is disabled under `prefers-reduced-motion: reduce`. |

## 10. Themes

- `data-theme="light|dark"` on `<html>`. Preference stored in `localStorage['heromarket.theme']` (`light`, `dark` or absent = follow system). An inline script in `index.html` applies it before first paint (no flash). The toggle lives in the sidebar footer and the lock screen.

## 11. Accessibility

- WCAG AA contrast for all text tokens (ratios above).
- Visible focus on every interactive element; logical tab order; Enter submits PIN and dialogs' primary action where it did before.
- Icon-only controls have `aria-label` and `title`.
- Dialogs use `role="dialog"`, `aria-modal`, and a labelled title.
- Hit targets ≥ 32 px (≥ 40 px on the cashier screen).
- Reduced motion respected.

## 12. Do / Don't

Do: use tokens, one primary action per area, labels with icons, tabular numbers.
Don't: raw hex in components, emoji as icons, nested cards, decorative gradients, glassmorphism, huge radii, animations on the payment path.
