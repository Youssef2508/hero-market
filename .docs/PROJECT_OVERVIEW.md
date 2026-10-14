# Project Overview

## Purpose

HeroMarket POS is the point-of-sale and back-office system of Hero Market (هيرو ماركت), a supermarket, running as a Windows desktop application on a PostgreSQL service. It started from an open-source point-of-sale code base (fetch-only `upstream` remote) and is developed in the private repository `Youssef2508/hero-market`.

## Users and roles (Verified – `src/server/auth/permissions.js`)

Access is defined by **roles built from 31 permissions** and checked by the service on every operation. The built-in roles:

| Role                      | Can do                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| مدير النظام `super_admin` | Everything; protected (at least one active account always remains)                                        |
| مدير المتجر `store_admin` | Everything except resetting the system                                                                    |
| مشرف `manager`            | All management screens and reports except users, roles, reset and multi-till close (the former "manager") |
| كاشير `cashier`           | Sell (cash, wallets, credit), discount, own shift and drawer audits, tills                                |
| أمين مخزن `inventory`     | Products, stock, damaged goods, reorder assistant, suppliers                                              |
| مراجع `auditor`           | Read-only reports, logs and records                                                                       |

Administrators create custom roles in الأدوار والصلاحيات. Accounts from the earlier version keep their access (`admin` → مدير النظام, `manager` → مشرف, `cashier` → كاشير).

## Implemented capabilities (summary – details in `FEATURE_INVENTORY.md`)

- Barcode/scale-label scanning, instant product search, cart editing, amount discount, five payment types, customer accounts with credit, loyalty points, delivery address, thermal receipts.
- Shift lifecycle with opening floats for three tills (drawer, Momkn machine, wallets), hourly drawer audits, reconciliation and printed shift report.
- Back office: products, reorder assistant, damaged goods, invoices and returns, customers, suppliers & purchases, cheques, expenses, users and roles, store settings, receipt designer (58/80 mm, A4/PDF, free placement of every element), event log, backup/restore, KPIs and analytics, cashier performance.

## Navigation (after redesign)

Sidebar groups: **البيع** (Cashier, Tills) · **نظرة عامة** · **التقارير** · **المخزون** · **الحسابات** · **الإدارة**. Before the redesign navigation was three header buttons plus a card grid of 17 management sections with a back button.

## Major workflows

See `USER_FLOWS.md`: login → (open shift) → sell → audit → close shift; returns; customer repayment; supplier purchase; stock maintenance.

## Boundaries

- Data in PostgreSQL behind the HeroMarket service. One till: the app runs its own private database ("this computer only"). Several tills: a store server ([DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md)).
- No internet use, no payment-provider integration, no tax engine (none invented).
- Client tills cannot sell while the store server or network is down (no offline queue yet).
- Windows desktop: PowerShell printing, Typst PDFs.

## Known limitations (high level)

See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) and [GAP_ANALYSIS.md](GAP_ANALYSIS.md):

- printing not yet verified on the store's printer;
- two owner decisions (close formula, supervisor approval);
- Electron major upgrade pending;
- plain HTTP between tills and server;
- unsigned installers.

## Confirmed vs assumed

- **Confirmed by running the app** (2026-10-14): start-up in all modes, upgrade import, login, selling, designer, every screen in both themes, accessibility scan, print path to PDF, restart after a crash.
- **Not yet confirmed**: printing on the physical thermal printer; NSIS upgrade over an installed 1.3; multi-till over a real LAN.
