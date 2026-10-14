# Project Overview

## Purpose

HeroMarket POS is the point-of-sale and back-office system of Hero Market (هيرو ماركت), a supermarket, running as a Windows desktop application on a PostgreSQL service. It started from an open-source point-of-sale code base (fetch-only `upstream` remote) and is developed in the private repository `Youssef2508/hero-market`.

## Users and roles (Verified – `users.role`)

| Role      | Can do                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| `cashier` | Sell, open/close own shift (simple close dialog), drawer audits, tills view, change own PIN  |
| `manager` | Everything a cashier can, plus all management screens except Users                           |
| `admin`   | Everything, including Users management, system reset and the advanced multi-till shift close |

## Implemented capabilities (summary – details in `FEATURE_INVENTORY.md`)

- Barcode/scale-label scanning, instant product search, cart editing, amount discount, five payment types, customer accounts with credit, loyalty points, delivery address, thermal receipts.
- Shift lifecycle with opening floats for three tills (drawer, Momkn machine, wallets), hourly drawer audits, reconciliation and printed shift report.
- Back office: products, reorder assistant, damaged goods, invoices and returns, customers, suppliers & purchases, cheques, expenses, users, event log, backup/restore, KPIs and analytics, cashier performance.

## Navigation (after redesign)

Sidebar groups: **البيع** (Cashier, Tills) · **نظرة عامة** · **التقارير** · **المخزون** · **الحسابات** · **الإدارة**. Before the redesign navigation was three header buttons plus a card grid of 17 management sections with a back button.

## Major workflows

See `USER_FLOWS.md`: login → (open shift) → sell → audit → close shift; returns; customer repayment; supplier purchase; stock maintenance.

## Boundaries

- Single machine, single SQLite file; no network sync, no web access, no payments integration.
- Windows-only binaries (`sqlite3.exe`, `typst.exe`, PowerShell printing).

## Known limitations (high level)

- Business logic and SQL live in the renderer; process-per-query DB access.
- Several pre-existing accounting caveats are documented in `docs/issues/` (inherited audit) and `TESTING_AND_KNOWN_ISSUES.md`.
- No automated UI tests in the inherited project; the redesign added a scripted browser QA pass (documented, not yet in CI).

## Confirmed vs assumed

- **Confirmed** by running the app: login, auto-resume, POS layout, admin sections render, console errors listed in known issues.
- **Assumed** from code only: thermal printing, PDF generation, restore.
