# HeroMarket POS – Engineering Documentation

Current, source-verified documentation for HeroMarket POS (Arabic RTL supermarket point of sale, Electron + React + a PostgreSQL service). The older `docs/` folder and the root audit reports are inherited from the original code base and kept for reference only.

Statements are marked **Verified** (read in code or observed in the running app), **Implemented** (added by the redesign), or **Assumed** (inferred, not exercised) where it matters.

## Start here

| If you want to…                                | Read                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Understand what the product is and who uses it | [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)                                                         |
| Set up a machine, run the app, run the checks  | [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md)                                                       |
| Find where something lives                     | [REPOSITORY_MAP.md](REPOSITORY_MAP.md)                                                             |
| Change the UI                                  | [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md), [UI_UX_DESIGN_SPEC.md](UI_UX_DESIGN_SPEC.md) |
| Change a business rule                         | [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md), [DATA_MODEL.md](DATA_MODEL.md) first                       |
| Ship a release                                 | [SECURITY_AND_RELEASE.md](SECURITY_AND_RELEASE.md), [CI_CD.md](CI_CD.md)                           |

## All documents

| Document                                                   | Contents                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)                 | Purpose, roles, capabilities, boundaries                               |
| [ARCHITECTURE.md](ARCHITECTURE.md)                         | Processes, IPC, database access, printing, startup sequence            |
| [REPOSITORY_MAP.md](REPOSITORY_MAP.md)                     | Every top-level path and renderer folder; where to change what         |
| [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md)               | All screens and operations, with roles and entry points                |
| [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md)                     | Checkout, payments, credit, returns, shifts, tills, stock rules        |
| [DATA_MODEL.md](DATA_MODEL.md)                             | Tables, columns, triggers, migrations                                  |
| [API_AND_INTEGRATIONS.md](API_AND_INTEGRATIONS.md)         | `window.api` IPC surface, printing, PDF, external binaries             |
| [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md)       | Before/after structure, shell, design-system layers, contracts kept    |
| [UI_UX_DESIGN_SPEC.md](UI_UX_DESIGN_SPEC.md)               | Brand, tokens, typography, components, screens, motion, accessibility  |
| [USER_FLOWS.md](USER_FLOWS.md)                             | Step-by-step flows: login, selling, returns, shifts, back office       |
| [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md)               | Prerequisites, databases, running, checks, packaging, Git workflow     |
| [TESTING_AND_KNOWN_ISSUES.md](TESTING_AND_KNOWN_ISSUES.md) | Test suites, baseline vs final results, QA method, known defects       |
| [DOCKER.md](DOCKER.md)                                     | The Linux validation image and why the app itself is not containerised |
| [CI_CD.md](CI_CD.md)                                       | CI jobs, release workflow, Dependabot, branch protection               |
| [SECURITY_AND_RELEASE.md](SECURITY_AND_RELEASE.md)         | Security model, secrets rules, advisories, release and rollback        |
| [DECISIONS.md](DECISIONS.md)                               | Decision log (D-001…) with reasons and consequences                    |
| [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md)   | Redesign milestones and per-screen verification checklist              |

## Keeping these documents true

- Update the relevant document in the same pull request as the code change.
- A behaviour change needs an entry in `DECISIONS.md` (what changed, why, consequences).
- New defects found while working go into `TESTING_AND_KNOWN_ISSUES.md` with a `K-` number, even if not fixed.
