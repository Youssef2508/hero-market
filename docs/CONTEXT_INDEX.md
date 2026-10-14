# Context Index

This file acts as a central reference index for the **HeroMarket POS** codebase, outlining the directories, core modules, and system documentation.

---

## 1. Documentation Index
All project documentation files are structured inside the `docs/` folder:

| Document | Purpose |
|---|---|
| [PROJECT_BRIEF.md](PROJECT_BRIEF.md) | High-level requirements, project vision, and feature lists. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System topology, database CLI bridge, and printing design. |
| [DATABASE.md](DATABASE.md) | Full SQLite schemas, relations, ledgers, and database triggers. |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | UI patterns, Arabic RTL layout guides, and components styling. |
| [GIT_WORKFLOW.md](GIT_WORKFLOW.md) | Repository branching strategies, tagging, and versioning rules. |
| [TASKING.md](TASKING.md) | Current implementation checklist and future roadmap items. |
| [AI_HANDOFF.md](AI_HANDOFF.md) | Critical constraints, anti-patterns, and instructions for incoming AI agents. |
| [rules.md](rules.md) | Strict operational rules (blocking UI dialogs, portable environment path). |
| [multi_till_implementation_plan.md](multi_till_implementation_plan.md) | Preserved blueprint for implementing multi-till drawer features. |
| [ALL_FAWATER.md](ALL_FAWATER.md) | Reference log of imported supplier invoices. |

---

## 2. Directory Structure & Source Files Map

```
hero-market/
├── build/                 # Installers assets and icons
├── dist/                  # Compiled output installers (ignored)
├── docs/                  # Unified project documentation files
├── node-portable/         # Portable Node.js environment
├── out/                   # Transpiled Electron code (ignored)
├── pdf/                   # Generated shortages outputs (ignored)
├── resources/             # Electron builder resources (icons, etc.)
├── src/                   # Application source directory
│   ├── main/              # Main process (Node.js/Electron)
│   │   ├── db.js          # SQLite CLI instantiation & WAL mode
│   │   ├── index.js       # App ready lifecycle & IPC register handlers
│   │   └── printer.js     # Print task spooler / printer query handler
│   ├── preload/           # Preload process
│   │   └── index.js       # ContextBridge API exposing database & printer IPCs
│   └── renderer/          # Renderer process (React 19/Vite)
│       └── src/
│           ├── assets/    # Main stylesheets & assets
│           ├── components/# UI components (admin, modals, pos tabs)
│           ├── hooks/     # React state hooks & controller managers
│           └── lib/       # Shared JS utilities, mocks, and DAO modules
│               ├── db.js  # IPC db bridge handler (executeQuery)
│               └── dao/   # SQLite database Access Objects (individual models)
├── electron-builder.yml   # Build config (resource locations, version details)
└── electron.vite.config.mjs # Vite packaging plugin configuration
```

---

## 3. Key Core Modules Reference
*   **Database Access Layer:** Located under `src/renderer/src/lib/dao/`. Contains:
    *   `products.dao.js`: Product mutations and search query queries.
    *   `sales.dao.js`: Checkout operations (transactions) and invoices history.
    *   `shifts.dao.js`: Open/close shift commands and user verification.
    *   `clients.dao.js` & `suppliers.dao.js`: Debt management and client/supplier balances.
*   **Controller Hooks:** Located under `src/renderer/src/hooks/`. Contains:
    *   `usePOSController.js`: POS tab states, barcode listeners, checkout forms.
    *   `useAdminController.js`: Admin sub-tabs state coordinator.
    *   `useShift.js`: Shift checking and cashier verification state.
*   **Core UI Layouts:**
    *   `src/renderer/src/App.jsx`: Main interface router (POS Screen vs Admin Dashboard vs Shift Modal).
