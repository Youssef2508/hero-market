# POS Benchmark Research

Purpose: learn how mature POS products solve the problems HeroMarket faces, to inform [GAP_ANALYSIS.md](GAP_ANALYSIS.md). Nothing here is copied; products are used as references for patterns only.

Research date: 2026-10-13. Sources are public help centres and documentation. Where only third-party or older material was available it is marked as such and weighted lower.

## 1. Sources reviewed

| Product | Type | Sources (quality) |
|---|---|---|
| Shopify POS | Commercial, cloud | [Give staff permissions with POS roles](https://help.shopify.com/manual/sell-in-person/setup/staff-permissions) (official); [Staff roles and permissions](https://www.shopify.com/retail/staff-roles-and-permissions) (official marketing); [Customizing receipts](https://help.shopify.com/manual/sell-in-person/setup/receipts/customize-receipts/) (official) |
| Square for Retail | Commercial, cloud | [Customise team member permissions](https://square.com/help/ie/en/article/5822-employee-permissions) (official); [Set inventory permissions](https://squareup.com/help/ie/en/article/8247-set-inventory-permissions-with-square-for-retail) (official) |
| Loyverse | Commercial, cloud/freemium | [Add text to printed receipts](https://help.loyverse.com/help/how-add-text-receipts), [Add logo to receipts](https://help.loyverse.com/help/how-add-logo-receipts) (official) |
| Odoo Point of Sale | Open core | [Feature page](https://www.odoo.com/app/point-of-sale-features) (official); community guide [odoo-users.readthedocs.io](https://odoo-users.readthedocs.io/en/stable/point_of_sale/overview/start.html) (older); access-rights add-ons such as [dev_pos_access_rights](https://apps.odoo.com/apps/modules/18.0/dev_pos_access_rights) (third party) |
| ERPNext / Frappe | Open source | [Point of Sale (v12 manual)](https://docs.frappe.io/erpnext/v12/user/manual/en/accounts/point-of-sales) (official, older version) |
| uniCenta oPOS | Open source desktop (Java) | [v3.70 guide mirror](https://github.com/Metawired/UnicentaPOS) (third-party mirror, 2014) |

## 2. Findings by capability

| Capability | Problem it solves | How mature products do it | Relevant to HeroMarket? | HeroMarket today | Complexity / risk |
|---|---|---|---|---|---|
| **Roles as permission bundles** | Different staff need different powers without per-person configuration | Shopify: every POS staff member must have a role; individual permissions cannot be assigned; a default role exists and cannot be deleted. Square: named permission sets with access levels (Standard / Advanced / Full) and per-access-point permissions | Yes – core requirement of the mission (§9) | Three hard-coded roles (`admin`, `manager`, `cashier`) checked only in React | Medium: catalogue + enforcement in a trusted layer; migrating existing users to roles |
| **Manager approval for sensitive actions** | Let cashiers proceed with a supervisor's PIN instead of a supervisor account | Shopify: a role can require a manager PIN for custom discounts, cash drawer, tax edits, refunds/exchanges, custom sales. Square: without "Manually enter custom amounts" a manager passcode is required | Yes | `ManagerApprovalModal` exists but no code path opens it (K-10) | Medium: needs per-action policy + server-verified approval token |
| **Granular inventory permissions** | Hide cost price, restrict stock counts | Square for Retail Plus: view unit cost, start/commit counts as separate permissions | Yes (cost price is visible on several screens) | Visible to managers/admins by role | Low once a permission catalogue exists |
| **PIN / passcode login** | Fast staff switching on shared terminals | Square and Shopify use per-staff passcodes on shared devices; Odoo has employee login with a per-employee PIN | Yes – HeroMarket already uses 4-digit PINs | PIN-only login, unique PINs, SHA-256 or legacy plain text, no lock-out | Low–medium: keep the workflow, harden storage and add attempt limiting |
| **Receipt header / footer / logo** | Branding and legal text without code changes | Loyverse: header and footer text and logo per store in back-office receipt settings; store name/address come from store settings. Odoo: receipt header/footer settings and logo. Shopify: receipt customisation in admin | Yes – mission §11 | Template hard-coded in `lib/printTemplates.js`; store name from `settings` | Medium: template model + preview + the existing print pipeline (HTML parsed by `printer.js`) |
| **Multiple receipt templates / paper sizes** | 58/80 mm thermal vs A4 invoices | uniCenta ships several editable receipt templates (older source); Odoo community modules add multiple receipt layouts | Yes | One 80 mm-style layout | Medium–high: must stay compatible with the thermal printing path |
| **Offline selling** | Keep selling when the network or server is down | Odoo: "keep working while offline… close session offline without loss of data" (official claim). ERPNext v12: invoices stored in the browser and synced about every minute; no documented conflict handling. Third-party add-ons add idempotency keys and conflict queues | Partly – HeroMarket has no internet dependency; with a central server the risk becomes LAN/server outage | Not applicable today (single local SQLite) | High: needs local queue, idempotent server API, conflict handling. Out of scope for this stage; documented as a known limitation |
| **Multiple terminals per session/store** | Several tills sharing products and stock | Odoo: several users can be connected to the same session; central server | Yes – reason for moving to PostgreSQL + a service | Not supported (one PC, one file) | High: transactions, row locking, server-generated IDs |
| **Store-level vs device-level settings** | Different printers per till, same prices everywhere | Loyverse: receipt text per store; Square/Shopify: device settings separate from store settings | Yes | Single `settings` table (store name, branch, printer) | Low–medium |

## 3. Conclusions used in the gap analysis

1. **Roles, not per-user flags.** Follow the Shopify/Square model: users get exactly one role; roles are bundles of named permissions from a fixed catalogue; one protected system role cannot be deleted. Custom roles are created by users holding a "manage roles" permission.
2. **Server-side enforcement** is the norm in all cloud products; HeroMarket must move permission checks out of React into the trusted service layer.
3. **Keep PIN login** (familiar, fast) but add attempt limiting and stronger storage; consider manager-PIN approval for refunds and price overrides as a follow-up (K-10).
4. **Receipt settings first, full designer second.** Every product exposes header, footer, logo and store details; field visibility and paper width are the next most common options. HeroMarket's designer should model these as data (no executable template code) and render through the existing print path.
5. **Do not claim offline resilience.** Mature products that support it invest heavily (local queues, idempotency, conflict review). HeroMarket will document LAN/server-outage behaviour honestly and design the checkout API to be idempotent so an offline queue can be added later.
