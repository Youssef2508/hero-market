# MASTER ENGINEERING MISSION — HERO MARKET POS

## Complete Codebase Audit, Database Migration, Architecture Evaluation, Feature Development, Security Hardening, UX Transformation, Automated Testing, and Production Readiness

You are acting as the principal software architect, senior full-stack engineer, database architect, application security engineer, product engineer, UI/UX designer, DevOps engineer, and QA lead for HeroMarket POS.

You have access to the existing project, development environment, source code, and the work already performed in this conversation.

Your objective is to turn the existing project into a professional, maintainable, production-oriented supermarket POS and management platform.

This is an implementation mission, not a request to produce a report, a mockup, or a list of recommendations.

You must inspect the real codebase, evaluate its suitability for production, preserve its existing data and important behavior, identify missing capabilities, implement the appropriate improvements, test them, inspect the running application, and maintain a complete record of the work.

**Do not start over. Do not discard previous progress. Do not treat this as a greenfield project.**

Continue from the actual state of the current project and preserve every valid piece of work already completed.

---

# 1. Canonical Project, Repository, and Environment

## Local workspace

`D:\Youssef\Brands\HeroMarket`

This is the canonical working directory.

All source changes, documentation, application assets, test code, infrastructure configuration, and project-specific development tooling must be maintained here.

## Permanent private GitHub repository

`https://github.com/Youssef2508/hero-market`

This is the permanent destination for our development work.

The original upstream project is:

`https://github.com/3bkader-gpt/elnagdi-pos`

The upstream repository is the project's origin of reference, not the destination for our development pushes.

Inspect the actual Git configuration and carefully establish the correct remote configuration. Preserve useful original Git history and all existing local modifications.

If `origin` exists, inspect it before changing it. Preserve the original public repository as an `upstream` remote when appropriate.

Never force-push, discard unrelated files, reset uncommitted work, or overwrite existing private repository history merely to simplify setup.

Use the private repository as the permanent remote for future work.

Prefer descriptive feature branches, focused commits, meaningful messages, reviewed diffs, and validated changes. Keep incomplete work identifiable and never claim that work was pushed unless the push actually succeeded.

If authentication, repository permissions, or another external dependency prevents a remote operation, continue with independent work and document the blocker.

## Development environment

I work on Windows using Claude inside Antigravity.

Discover the tools, terminals, browser integrations, file access, and automation capabilities actually available in this environment. Do not assume that every feature of the standalone Claude Code CLI is available.

Use the current working environment and preserve the existing application's ability to run locally for manual testing.

---

# 2. Preserve and Resume Existing Work

Before making significant changes, inspect the current project, the active conversation context, the source tree, the Git working tree, the current branch, the running application, and the documentation already created.

Create or update:

`.docs/IMPLEMENTATION_PROGRESS.md`

Also maintain:

`.docs/PAUSED_TASK_STATE.md`

Use these files as a durable checkpoint for the entire project.

Record completed milestones, partially completed work, current implementation details, modified files, existing failures, test results, database migration status, UI/UX work, branding work, Docker/CI/CD configuration, and the exact next unfinished task.

Preserve all useful work already done.

Do not recreate documentation unnecessarily, rewrite functioning components without reason, discard existing database files, or replace an existing implementation simply because a fresh implementation would be easier to generate.

If the application is currently running, preserve that baseline and diagnose the current state before restarting or changing services.

When context is lost or a long-running task must resume, use the checkpoint and repository state to reconstruct the true status. Never rely solely on memory or an optimistic progress summary.

## Execution policy

Work autonomously through the task.

Do not stop after creating an audit report, a plan, a few components, or the initial UI redesign.

Do not ask me to execute routine development commands you can execute yourself.

Only stop or request a decision when a genuine external blocker exists, an irreversible/destructive action would risk important data, a required credential or permission is unavailable, or a business decision cannot safely be inferred.

Whenever possible, preserve progress and continue with independent tasks while resolving blockers.

Maintain accurate progress documentation throughout execution.

---

# 3. First Deliverable: Understand and Document the Entire Existing System

Create a verified, comprehensive documentation system under:

`D:\Youssef\Brands\HeroMarket\.docs`

Inspect the source code, configuration, dependencies, database, runtime behavior, existing workflows, and tests.

Document actual behavior, not assumptions based on filenames or README descriptions.

At minimum, maintain the following documentation:

- `README.md` — documentation index and project overview.
- `PROJECT_OVERVIEW.md` — purpose, users, capabilities, and current limitations.
- `ARCHITECTURE.md` — actual system architecture and module boundaries.
- `REPOSITORY_MAP.md` — meaningful directories and file responsibilities.
- `FEATURE_INVENTORY.md` — implemented, partially implemented, missing, broken, and unverified capabilities.
- `BUSINESS_LOGIC.md` — verified business rules and workflow behavior.
- `DATA_MODEL.md` — database schema, entities, relationships, constraints, and indexes.
- `API_AND_INTEGRATIONS.md` — actual APIs, IPC channels, service interfaces, and integrations.
- `FRONTEND_ARCHITECTURE.md` — screens, components, state, navigation, design tokens, and rendering architecture.
- `USER_FLOWS.md` — actual user journeys and their error and recovery paths.
- `DEVELOPMENT_SETUP.md` — reproducible development setup and startup instructions.
- `DATABASE_ARCHITECTURE.md` — selected production database and final database-access design.
- `DATABASE_MIGRATION.md` — source inventory, migration procedure, validation, and rollback.
- `UI_UX_DESIGN_SPEC.md` — implemented design system and user-experience principles.
- `TESTING_AND_KNOWN_ISSUES.md` — testing strategy, baseline failures, defects, and regressions.
- `SECURITY_AND_RELEASE.md` — security controls and release practices.
- `DOCKER.md` — the actual containerization strategy and commands.
- `CI_CD.md` — implemented CI workflows and release automation.
- `DECISIONS.md` — significant architectural, technical, and product decisions.
- `IMPLEMENTATION_PROGRESS.md` — ongoing task status.
- `PAUSED_TASK_STATE.md` — durable resume checkpoint.
- `GAP_ANALYSIS.md` — full production-readiness gap analysis.
- `PRODUCTION_READINESS.md` — final readiness assessment and evidence.

Add other focused documents whenever necessary.

Every document must describe the actual system and refer to real file paths, classes, functions, endpoints, schemas, configuration keys, or tests where relevant.

Clearly distinguish verified facts, reasonable inferences, assumptions, unknowns, and known defects.

Keep the documentation synchronized with the final implementation.

---

# 4. Comprehensive Product and Production-Readiness Audit

Perform a systematic review of the entire system, not just the current cashier screen.

Inspect the frontend, backend, database, business logic, security boundaries, integrations, testing infrastructure, deployment configuration, observability, and operational workflows.

## 4.1 Feature audit

Inventory every existing module and determine whether it is implemented correctly, partially implemented, broken, missing, duplicated, or unverified.

Inspect applicable capabilities such as:

- Product and category management.
- SKU, barcode, product search, and scanning.
- Product variants and units of measure.
- Price management, discounts, and promotions.
- Sales, invoices, payments, and transaction history.
- Cart management and sale cancellation.
- Returns, refunds, and exchanges.
- Inventory, stock movements, stock adjustments, and low-stock alerts.
- Purchasing, suppliers, and receiving goods.
- Customers and customer history.
- Cashier accounts, shifts, cash movements, and reconciliation.
- Administrative settings.
- Users, roles, and permissions.
- Reports and analytics.
- Invoice/receipt design and printing.
- Audit trails and administrative activity.
- Database backup and recovery.
- Data import/export.
- Application configuration and system health.
- Notifications, background processing, and integrations.
- Any additional modules actually present in the source code.

Do not assume that these features already exist.

Trace important features from their frontend entry point through the application logic and persistence layer.

A visible screen with nonfunctional controls is not a completed feature.

## 4.2 Backend and frontend architecture audit

Determine whether the existing framework, runtime, libraries, and architecture are appropriate for long-term commercial use.

Evaluate:

- Frontend framework and build system.
- Backend framework and runtime.
- Database and database driver.
- API architecture and contracts.
- Authentication and authorization.
- State management and data fetching.
- Form validation.
- Component organization and reuse.
- Database access patterns.
- Error handling.
- Logging and observability.
- Testing tools.
- Dependency health and maintenance.
- Build reproducibility.
- Deployment and update strategy.
- Native Windows integration where relevant.
- Integration with printers and barcode scanners.
- Multi-terminal operation.
- Offline behavior and network failure handling.

Do not recommend a technology solely because it is fashionable.

Evaluate alternatives using explicit criteria: functional suitability, security, maintainability, compatibility, reliability, performance, deployment complexity, licensing, migration cost, developer productivity, and long-term operational requirements.

Create a decision matrix in `.docs/GAP_ANALYSIS.md`.

If a framework is suitable, retain it.

If a framework or runtime is genuinely inappropriate for the target production environment, plan and execute a controlled migration when the benefit justifies the cost and risk.

**A framework change is permitted, but it is never an excuse to lose data or change the user's established workflows unnecessarily.**

Before a major stack migration, record the reason, alternatives, migration stages, compatibility risks, rollback plan, and acceptance criteria in `.docs/DECISIONS.md`.

Prefer incremental replacement and compatibility adapters over a risky wholesale rewrite when practical.

Do not rewrite the application merely for stylistic preference.

---

# 5. Research Established POS Products and Industry Practices

Research relevant existing supermarket POS systems, particularly mature commercial products and well-maintained open-source projects.

Investigate their public documentation, feature matrices, role-management patterns, receipt customization, inventory workflows, cashier UX, deployment models, reliability mechanisms, and administrative capabilities.

Use browser or web research tools available in the current environment where practical.

Prefer official documentation, source repositories, architectural guides, and other credible technical sources.

Record the most relevant sources and findings in:

`.docs/POS_BENCHMARK_RESEARCH.md`

For each relevant capability, identify:

- What problem it solves.
- Whether it is relevant to HeroMarket.
- Whether equivalent functionality already exists.
- How mature POS systems typically approach it.
- What implementation complexity it introduces.
- What dependencies or operational risks it creates.

Use this research to inform the feature-gap analysis.

Do not blindly copy another application's design, code, branding, or business rules. Respect licenses and applicable usage restrictions.

Do not invent requirements merely to make the feature list longer.

Prioritize practical improvements that make the system more reliable, usable, secure, and operationally complete.

---

# 6. Create a Prioritized Gap Analysis and Execute It

Document every meaningful production-readiness gap in:

`.docs/GAP_ANALYSIS.md`

Classify findings into categories such as:

- Critical security or data-integrity defects.
- Core operational blockers.
- Missing essential functionality.
- Reliability and recovery gaps.
- Architectural shortcomings.
- UX and accessibility problems.
- Performance bottlenecks.
- Developer-experience and deployment issues.
- Lower-priority improvements.

Each finding must include:

- A unique identifier.
- Description and evidence.
- Affected modules.
- Why it matters.
- Severity.
- Priority.
- Dependencies.
- Proposed remediation.
- Test strategy.
- Implementation status.
- Verification evidence.

Use a consistent prioritization scheme, for example P0 through P3.

Do not label every cosmetic improvement critical.

## Implementation rule

After the gap analysis, implement the appropriate findings in a controlled sequence.

Do not stop at presenting the gaps.

At the same time, do not start hundreds of speculative features without a coherent architecture. Resolve critical security and data-integrity issues first, then core functionality, architecture, UX, performance, and lower-priority improvements.

Maintain a traceable relationship between requirements, code changes, tests, and documented results.

For significant new functionality, define acceptance criteria before implementation.

---

# 7. Production Database: Replace SQLite and Preserve All Existing Data

I explicitly do not want SQLite to remain the target operational database for HeroMarket POS.

Select a proper non-SQLite relational database based on the actual application architecture and real supermarket deployment requirements.

PostgreSQL is the primary candidate, particularly for centralized operation, concurrent cashier terminals, transactional consistency, and reliable relational data management.

However, inspect the actual application and document the decision rather than choosing a database without considering the deployment architecture.

Evaluate:

- Multiple cashier terminals.
- Concurrent sales and inventory updates.
- Transaction consistency.
- Data durability.
- Local network availability.
- Internet-independent operation.
- Windows deployment.
- Security and access control.
- Backup, restore, and recovery.
- Database administration.
- Docker and CI compatibility.
- Maintenance and migration cost.

SQLite must not remain the normal operational database after a verified transition to the selected target.

## 7.1 Preserve every existing record

Inspect every relevant SQLite database, seed dataset, schema, migration, and local data file.

Identify which database is actually used by the running application.

Back up the original database before migration, and keep the original files recoverable.

Migrate the existing schema and all applicable data, including test and development data.

Preserve, as applicable:

- All tables and columns.
- Existing records.
- Primary keys and identifiers.
- Foreign-key relationships.
- Unique constraints and required indexes.
- Product barcodes and stock data.
- Sales and invoice history.
- Payments and transaction records.
- Customers and suppliers.
- Settings and reference data.
- Timestamps and relevant historical information.
- Monetary values and their original meaning.
- Other persisted entities and relationships.

Do not substitute a new seed database for the actual existing dataset.

Do not silently drop fields, change values, generate replacement identifiers, or omit records for convenience.

Account for SQL dialect, identity/sequence behavior, data types, constraints, and timestamp differences.

Use deterministic migration scripts or an appropriate migration framework.

Make the import safe to retry, or safely detect that it has already completed, without duplicating records.

Use transactions or staged migration mechanisms to avoid incomplete imports.

Never destroy or overwrite an existing target database without inspecting it and obtaining explicit authorization if the operation could destroy meaningful data.

## 7.2 Verify source-to-target data parity

Before switching the application to the new database, perform and document:

- Table/schema comparisons.
- Per-table record counts.
- Primary-key preservation.
- Foreign-key integrity checks.
- Unique constraint verification.
- Row-level data comparison.
- Monetary and timestamp comparison.
- Sequence/identity validation.
- Representative query comparisons.
- Application-level read/write tests.

Use canonicalized records, deterministic hashes, or other suitable comparison methods where appropriate. Normalize only genuine storage-format differences that do not change semantic values.

Do not rely solely on identical row counts.

Switch the application's normal operational configuration only after the staged target has passed the appropriate validation.

Keep a recoverable source database and rollback procedure.

## 7.3 Database architecture and offline operation

Determine whether the application is desktop Electron, browser-based, or another architecture.

If centralized PostgreSQL is appropriate, ensure cashier clients interact through an appropriate trusted backend or service boundary.

Do not expose database credentials to frontend JavaScript or untrusted renderer code.

Do not assume that installing PostgreSQL on each workstation creates a shared database.

Document how a real supermarket would deploy the database service and connect authorized terminals over the local network.

Distinguish internet outages from local server or network outages.

Do not claim that offline transaction processing or disaster recovery is solved unless the corresponding behavior is implemented and tested.

## 7.4 Database migration deliverables

Create and maintain:

- `.docs/DATABASE_ARCHITECTURE.md`
- `.docs/DATABASE_MIGRATION.md`
- Updated `.docs/DATA_MODEL.md`
- Updated `.docs/DEVELOPMENT_SETUP.md`
- Updated `.docs/DOCKER.md`
- Updated `.docs/TESTING_AND_KNOWN_ISSUES.md`

Do not commit passwords, private databases, local backups, database dumps containing sensitive data, or real secrets.

---

# 8. Preserve User-Facing Behavior During Backend or Framework Migrations

If the database, backend framework, frontend framework, or runtime must change, treat it as a controlled migration.

My requirement is that infrastructure and internal implementation changes should not introduce confusing changes to the cashier's established workflows.

Preserve:

- Existing records and identifiers.
- Sales history and relationships.
- Important screens and workflows, except where a verified usability improvement is intended.
- Barcode-scanning behavior.
- Keyboard shortcuts.
- Product search.
- Existing calculations and validation rules.
- Receipt printing and relevant hardware integration.
- Existing user expectations about how sales are processed.

Before migration, capture baseline workflows and results.

After migration, execute the same workflows against the new stack and compare the results.

Where the existing API or UI contract can be preserved, preserve it.

Use compatibility adapters, migration layers, or incremental replacement if these reduce risk.

Do not leave two conflicting implementations of the same business logic.

Do not retain obsolete frameworks or SQLite as normal operational dependencies merely to avoid completing a necessary migration.

If a full rewrite is unavoidable, preserve functional parity through explicit requirements, data migration, and tests.

Any user-visible difference should be intentional and justified, with the visual redesign being the primary planned change.

---

# 9. Build the Correct Roles and Permissions Model

Perform a dedicated access-control and administration review using established POS products and security best practices as references.

I need meaningful separation between administrators and cashiers, with the ability for authorized administrators to create additional roles and configure their permissions.

This must be a genuine authorization system, not a frontend-only collection of hidden buttons.

## 9.1 Default role model

Evaluate and implement appropriate default roles, adapted to the existing application's actual capabilities.

Potential roles include:

- Super Administrator.
- Store Administrator.
- Store Manager.
- Cashier.
- Inventory/Purchasing Operator.
- Auditor or Read-Only User.

Do not force every role onto a single store or a multi-store architecture without assessing the real requirement.

Create appropriate default roles based on the supported modules.

## 9.2 Dynamic role management

Provide an administration interface that allows authorized administrators to:

- Create custom roles.
- Edit role names and descriptions.
- View and configure permissions.
- Assign permissions by module and action.
- Assign roles to users.
- Review existing role assignments.
- Revoke access where authorized.
- See the effective permissions of a role.
- Understand the potential impact of a permission change.

Permission categories should correspond to actual application capabilities.

Where applicable, distinguish actions such as:

- View.
- Create.
- Edit.
- Delete.
- Approve.
- Cancel.
- Refund.
- Export.
- Print.
- Manage settings.
- Manage users.
- Manage roles and permissions.

Use the actual feature inventory to determine the complete permission catalog.

Avoid an unmanageable list of unrelated Boolean flags without a coherent model.

## 9.3 Enforce authorization correctly

Enforce access rules in the trusted backend or service layer for every protected operation.

The frontend should also reflect permissions by hiding, disabling, or adapting controls where appropriate, but frontend visibility must never be the security boundary.

Prevent unauthorized access through direct API calls, manipulated UI state, IPC calls, or crafted requests.

Implement safe administrative invariants, where appropriate:

- Prevent removal of the last usable super-administrator.
- Prevent unauthorized self-escalation.
- Prevent a role from granting permissions beyond the actor's authority.
- Protect essential system permissions from accidental lockout.
- Revoke access promptly when roles or assignments change.
- Log sensitive permission changes.
- Verify authorization server-side for both read and write operations.

Avoid hardcoding all authorization logic into scattered conditionals.

Use centralized permission checks and testable policies.

Document the exact model in `.docs/SECURITY_AND_RELEASE.md` and `.docs/ARCHITECTURE.md`.

Do not create a default production administrator with a hardcoded public password.

Provide a secure bootstrap/provisioning process and safe initial account setup.

---

# 10. Professional Administration and Settings

Review the current administration capabilities and identify everything an operator reasonably needs to configure.

Implement the missing settings that are appropriate to the verified business model.

Potential settings include:

- Store name, logo, address, contact information, and branding.
- Currency, locale, date/time format, and number formatting.
- Supported languages and default interface language.
- Tax and pricing configuration where relevant.
- Receipt/invoice templates.
- Printer configuration.
- Scanner-related configuration where supported.
- Cashier and user management.
- Roles and permissions.
- Inventory alerts.
- Checkout behavior.
- Product display and search preferences.
- Theme preference.
- Security settings.
- Backup and restore controls.
- System health and operational diagnostics.
- Relevant integrations.

Do not turn every technical option into an exposed setting.

Restrict sensitive settings according to permissions.

Use validation, clear explanations, sensible defaults, and confirmation dialogs for consequential operations.

Separate store-specific configuration from machine-specific configuration where the architecture requires it.

Document which settings are global, per store, per device, or per user.

---

# 11. Fully Customizable Invoice and Receipt Designer

This is a required product capability to evaluate and implement.

The administrator should be able to control the appearance and structure of the receipt/invoice without modifying source code for every change.

First inspect the existing invoice-generation and printing implementation, its hardware requirements, and the supported output formats.

Then build a template-management and customization experience appropriate to the actual application.

## 11.1 Template capabilities

Where technically appropriate, support configuration of:

- Receipt/invoice template name.
- Store logo and header.
- Store information and contact details.
- Language and localized labels.
- Document title.
- Header and footer sections.
- Product names and item details.
- Barcode or SKU visibility.
- Quantity, unit price, discounts, and totals.
- Taxes and other amounts only where supported by the existing business model.
- Payment details.
- Cash received and change due where applicable.
- Transaction/invoice number.
- Date, time, and cashier information.
- Customer details where applicable.
- Custom footer messages.
- Visibility and ordering of supported fields.
- Alignment and typography settings.
- Supported formatting and separator styles.
- Supported color configuration for outputs that can render color.

Avoid advertising features that a particular printer cannot reproduce.

## 11.2 Paper formats and printing

Inspect actual printing integrations and support appropriate formats, potentially including:

- 58 mm thermal receipts.
- 80 mm thermal receipts.
- A4 invoice output where applicable.
- Print preview and supported PDF/export output.

Verify output dimensions and pagination.

Do not assume all thermal printers support full color, arbitrary fonts, or the same paper-width behavior.

Implement appropriate output adapters for the supported formats where necessary.

Preserve existing printing behavior until the new version has been validated.

## 11.3 Live preview and safe template management

Provide a live or near-live preview using representative test data.

Support saving, editing, duplicating, and selecting templates as appropriate.

Where practical, allow administrators to restore a default template.

Validate template settings before applying them.

Use safe field identifiers and a supported formatting system rather than arbitrary executable code embedded in templates.

Ensure the chosen template is actually used by the real receipt-generation path.

Test that generated output corresponds to the preview.

Do not accidentally change sale data, prices, totals, or transaction behavior when only the visual template has changed.

Document the template structure and extension points.

---

# 12. Comprehensive Business-Logic Review

Review all implemented business rules and identify ambiguous, missing, contradictory, unsafe, or untested behavior.

Trace critical operations from user interaction to persistence.

At minimum, inspect applicable areas such as:

- Product lookup and barcode uniqueness.
- Units, quantities, and precision.
- Cart calculations.
- Pricing and discounts.
- Rounding and monetary precision.
- Sale completion and transaction boundaries.
- Payment recording.
- Inventory reservation and stock deduction.
- Concurrent stock updates.
- Sale cancellation.
- Returns and refunds.
- Cash movements.
- Shift reconciliation.
- Purchasing and received-stock updates.
- Supplier balances where applicable.
- Invoice numbering.
- Historical record consistency.
- Reports and aggregate calculations.
- Authorization of sensitive transactions.

Do not invent tax rules, legal requirements, refund policies, stock policies, or accounting behavior without evidence.

Where a material business policy cannot be established from the code or documented requirements, identify it as a decision required from the product owner.

Do not block unrelated technical work while waiting for such a decision.

Preserve established behavior unless it is demonstrably defective or a deliberate change is documented.

For every corrected business-logic defect, provide a reproducible test showing the expected result.

## Transactional integrity

Use database transactions for operations whose related changes must succeed or fail together.

For example, a completed sale may require atomic persistence of the sale, line items, payment records, and relevant inventory movements.

Inspect the actual workflow and implement the correct transactional boundaries.

Address duplicate submissions, retries, concurrent requests, and appropriate idempotency guarantees where needed.

Do not let visual redesign or client-side calculations become the source of truth for financial operations.

Use trusted server-side calculations for critical totals and enforce consistency in the appropriate service and database layers.

---

# 13. Full Frontend and UI/UX Transformation

The application must become a cohesive, polished product branded **HeroMarket POS**.

The current UI is only a baseline.

Perform a fundamental, system-wide redesign covering all existing major screens.

Do not simply replace colors or add a generic sidebar.

## 13.1 Brand identity

Create an original, professional HeroMarket logo and application icon.

Use real asset files and integrate them into the supported application surfaces, window branding, and packaging configuration where applicable.

Maintain a consistent identity throughout navigation, dialogs, settings, reports, and print-template management.

Verify the actual icon integration rather than merely generating the asset.

## 13.2 Design system

Establish centralized design tokens and reusable components for:

- Colors and semantic states.
- Typography.
- Spacing.
- Borders and elevation.
- Responsive dimensions.
- Focus indicators.
- Buttons and inputs.
- Tables and forms.
- Dialogs and menus.
- Notifications.
- Loading, empty, and error states.
- Animations and transitions.

Use one consistent icon system.

Keep Arabic typography highly readable, and provide correct RTL behavior.

The interface must look professionally designed rather than AI-generated from a collection of generic dashboard cards.

Avoid excessive white surfaces, arbitrary gradients, inconsistent spacing, tiny text, excessive rounded corners, cluttered controls, and decorative animations without purpose.

## 13.3 Application shell and navigation

Implement a clear, persistent navigation structure.

Use an Arabic RTL-first layout with primary navigation in an appropriate position, grouped destinations, recognizable icons, consistent labels, and a clear selected state.

Create a predictable application shell across the existing screens.

Keep related administrative functions in clear groups and make settings easy for authorized administrators to discover.

Do not create fake pages just to populate the sidebar.

## 13.4 Cashier experience

Treat the checkout screen as the primary workflow.

Optimize:

- Barcode scanning.
- Product search.
- Cart visibility.
- Quantity editing.
- Price and line-total readability.
- Payment-method selection.
- Total amount due.
- Cash received and change due.
- Sale confirmation.
- Receipt handling.
- Keyboard shortcuts.
- Error recovery.

Preserve working scanner and keyboard behavior.

Use the minimum amount of friction consistent with safe transaction handling.

Test the layout at approximately 1000 × 630 and 1366 × 768, along with practical resized window dimensions.

Avoid unnecessary scrolling and modal interruptions.

## 13.5 Light and dark themes

Implement a real application-wide theme toggle.

Support light and dark themes through centralized semantic tokens.

Persist the user's explicit theme selection across restarts or reloads through an appropriate mechanism.

Respect system preference when the user has not explicitly chosen a theme, where practical.

Test all existing screens, dialogs, forms, tables, notifications, and focus states in both modes.

Avoid visual flashing or unreadable states during theme changes.

## 13.6 Motion and interactions

Use restrained, deliberate animation for meaningful transitions and feedback.

Examples include subtle hover/press responses, smooth theme switching, well-designed modal transitions, and non-disruptive product-added feedback.

Respect reduced-motion preferences.

Do not delay sale completion or interfere with barcode scanning.

## 13.7 Usability and accessibility

Evaluate keyboard navigation, focus order, visible focus, text contrast, screen resizing, accessible names, forms, status messages, and error feedback.

Aim for WCAG 2.2 AA where applicable, while documenting any exceptions associated with the desktop runtime or third-party components.

Conduct actual interaction-based usability checks instead of judging the interface exclusively from screenshots.

---

# 14. Security Audit and Hardening

Perform a threat-informed security review of the actual architecture.

Inspect applicable areas including:

- Authentication and session management.
- Role-based authorization.
- Password storage.
- Secret management.
- Input validation.
- SQL injection and parameterized queries.
- Cross-site scripting where applicable.
- CSRF where applicable.
- IPC and renderer/main-process boundaries in Electron.
- API authentication and authorization.
- Unsafe file handling and path traversal.
- Deserialization and command execution risks.
- Dependency vulnerabilities.
- Insecure defaults.
- Logging of secrets or sensitive data.
- Local data exposure.
- Backup protection.
- Application update and release security.
- Administrative actions and audit trails.

For Electron applications, inspect the applicable security configuration, including renderer isolation, context isolation, Node integration, IPC validation, content security policy, and navigation restrictions.

For web or backend services, apply the controls appropriate to the actual stack.

Do not disable security controls just to make functionality work.

Do not expose database credentials to untrusted code.

Implement server-side authorization, safe validation, least privilege, secure secrets handling, and appropriate auditability.

Use static analysis, dependency auditing, and secret scanning where supported.

Prioritize actual exploitable risks rather than adding meaningless security configuration.

Document findings, remediation, residual risk, and the tests that verify fixes.

---

# 15. Operational Reliability and Performance

Assess how the system behaves under actual supermarket operating conditions.

Inspect:

- Application startup and recovery.
- Database connection failures.
- Transaction errors.
- Temporary network loss.
- Server or database restart.
- Concurrent cashier operations.
- Duplicate payment/sale submissions.
- Slow queries.
- Large product catalogs.
- Large transaction histories.
- Long-running reports.
- Memory leaks and excessive resource use.
- Background tasks.
- Printer unavailability.
- Backup and restoration.
- Application updates and compatibility.

Improve the identified bottlenecks using measured evidence.

Use appropriate indexing, pagination, batching, caching, and query optimization where justified.

Do not introduce caching that can make prices, permissions, stock, or financial information dangerously stale.

Implement useful, privacy-aware logging and diagnostics.

Provide meaningful user-facing error states and recoverable behavior.

Do not claim complete offline resilience if the architecture depends on an unavailable centralized server.

For a multi-terminal local supermarket deployment, document the expected local network and server behavior, including limitations during network or server outages.

---

# 16. Comprehensive Testing Strategy

Testing is a mandatory part of this project.

Create a test strategy that covers every meaningful class of risk supported by the application architecture.

Do not interpret "all types of testing" as running every conceivable tool regardless of relevance. Instead, identify every applicable testing category, implement the appropriate tests, execute them, and document the results.

At minimum, evaluate the following categories.

## 16.1 Unit testing

Test business rules, calculations, validation, authorization policies, and important utilities independently.

Include positive cases, negative cases, boundary values, rounding, invalid input, and relevant edge cases.

## 16.2 Integration testing

Test interactions between services, persistence, database transactions, migrations, APIs, IPC, and external interfaces where applicable.

Run database-backed tests against the actual selected target database for relevant integration paths.

## 16.3 API and contract testing

Where applicable, test endpoint behavior, schemas, validation, authentication, authorization, error responses, and compatibility between frontend and backend contracts.

For non-HTTP interfaces, test the corresponding actual contracts.

## 16.4 End-to-end testing

Automate important real user workflows.

Prioritize:

- Application startup.
- Authentication.
- User and role administration.
- Product search and barcode input.
- Cart operations.
- Checkout and sale completion.
- Receipt preview or printing.
- Inventory workflows.
- Existing administrative workflows.
- Theme switching.
- Settings.
- Application recovery after restart.

Use a disposable development/test environment.

Do not connect test automation to production financial services or real production data.

## 16.5 Regression testing

Capture baseline behavior before meaningful changes.

After database, framework, backend, or frontend changes, verify previously working features and key workflows.

Do not consider visual parity a substitute for business-function parity.

## 16.6 Component and visual regression testing

Where supported, test reusable UI states and capture screenshots for important pages and themes.

Compare relevant screenshots before and after the redesign.

Use visual checks to detect clipping, alignment issues, missing controls, unintended theme changes, and responsive-layout regressions.

## 16.7 Accessibility testing

Use applicable automated accessibility tools and manual keyboard/focus checks.

Inspect semantic markup, contrast, form labels, keyboard traps, reduced-motion behavior, and understandable error feedback.

## 16.8 Performance testing

Measure relevant application startup, important screen rendering, search queries, database operations, and representative workflows.

Use load or stress testing where appropriate for a centralized multi-terminal architecture.

Define workload assumptions based on evidence and label estimates clearly.

Do not load-test production databases or external services without explicit authorization.

## 16.9 Security testing

Perform applicable static analysis, dependency auditing, secret scanning, authorization tests, input-handling tests, and safe vulnerability checks.

Test privilege escalation prevention and verify that unauthorized direct requests fail even when frontend restrictions are bypassed.

Use controlled environments and avoid destructive tests against important data.

## 16.10 Data migration and recovery testing

Validate schema migrations, source-to-target data parity, constraints, transaction behavior, backups, restoration, and recoverability.

Where relevant, test backup restoration into a disposable environment.

Do not claim disaster recovery is verified without actually performing an appropriate recovery test.

## 16.11 Concurrency and transaction testing

Where relevant, verify concurrent operations such as two cashiers updating stock or submitting sales.

Test duplicate requests, transaction rollbacks, and consistency of related records.

Do not allow the same inventory movement or sale to be applied twice because of retries.

## 16.12 Cross-platform and packaging testing

Test the actual supported operating systems and packaged targets.

For Windows desktop applications, verify the appropriate Windows build, startup, native dependencies, application assets, and installer or portable package where supported.

Do not claim cross-platform support merely because the source code compiles on one platform.

## 16.13 Reliability and resilience testing

Where practical, simulate recoverable failures such as database unavailability, interrupted requests, unavailable printers, and application restarts.

Verify that committed data remains intact and that the application communicates failures clearly.

Use disposable environments for destructive scenarios.

## 16.14 Test quality requirements

Use meaningful assertions and deterministic fixtures.

Do not write tests that merely confirm that a function returned without throwing.

Do not weaken validation, skip important tests, or change expected results solely to obtain green builds.

Do not claim that a test was executed when it was only written.

Document blocked tests separately, including why they were blocked.

Use coverage measurements where available to identify untested critical areas, but do not treat a high coverage percentage as proof of correctness.

Create or update `.docs/TESTING_AND_KNOWN_ISSUES.md` with an explicit matrix showing each applicable testing category, implementation status, execution status, results, and limitations.

---

# 17. Docker, CI/CD, and Professional Development Workflow

Implement an appropriate DevOps foundation for the actual application.

## Docker

Determine which components benefit from containerization.

For a desktop Electron application, retain an appropriate native Windows development and execution workflow.

Use Docker for the centralized database, appropriate backend services, test dependencies, or reproducible CI environments where it provides real value.

Create maintainable Dockerfiles and Compose configuration as justified by the architecture.

Include persistent storage, health checks, safe environment configuration, and appropriate startup dependencies.

Do not embed secrets in container images.

## GitHub Actions

Implement applicable CI workflows under `.github/workflows/`.

Run real, reproducible jobs for supported linting, type checking, tests, database-backed integration tests, builds, and relevant security checks.

Use compatible runners, especially for Windows-specific builds and native dependencies.

Use minimum necessary workflow permissions and safe dependency caching.

Validate workflow syntax and actual executable commands.

## Delivery

Where applicable:

- Pull requests trigger relevant validation.
- Merges into the stable branch trigger post-merge checks.
- Versioned tags trigger validated release builds.
- Successful Windows packaging can produce documented release artifacts.

Do not deploy a local desktop application to an unrelated cloud service merely to claim continuous delivery.

Do not automatically publish untested builds as production releases.

Document required branch-protection settings and missing repository permissions.

## Verification

A workflow YAML file is not proof that CI/CD works.

Distinguish local checks, successful commits, successful pushes, executed remote workflows, passing checks, and published release artifacts.

Update `.docs/DOCKER.md` and `.docs/CI_CD.md` with the implemented workflow and exact commands.

---

# 18. Data Protection and Change Management

Data preservation is a non-negotiable requirement.

Before any significant database or persistence change:

- Establish a recoverable backup.
- Verify the source database and its contents.
- Identify the target database and its current contents.
- Validate the migration in a staged environment.
- Verify data parity and constraints.
- Test application workflows against the migrated data.
- Preserve rollback instructions.
- Keep the source database until the target is verified and accepted.

Never casually overwrite an existing database.

Never silently regenerate historical IDs or replace records with seed data.

Never commit databases containing sensitive data, private backups, credentials, or secrets.

Never claim the absence of data loss without appropriate validation evidence.

For framework migrations, preserve the same persisted business information and test the application against the migrated data.

Before destructive actions or changes that cannot be safely reversed, stop and obtain explicit authorization.

---

# 19. Implementation Roadmap and Controlled Execution

The task is large. Execute it in a dependency-aware order while maintaining a working checkpoint.

## Phase A — Baseline and discovery

- Inspect the actual workspace, current conversation context, and Git state.
- Record baseline build and test results.
- Launch and inspect the existing application.
- Inventory databases, data, modules, integrations, and architecture.
- Establish the documentation and checkpoint.

## Phase B — Architecture and gap analysis

- Complete the codebase and feature inventory.
- Research relevant POS products and industry practices.
- Evaluate the existing and alternative technology stacks.
- Identify critical security and data-integrity risks.
- Produce the prioritized gap analysis and decision records.

## Phase C — Data and architectural foundation

- Select the appropriate non-SQLite production database.
- Back up and migrate existing database contents.
- Verify data parity.
- Establish the necessary backend/service boundaries.
- Implement and verify required schema migrations and database integration tests.
- Resolve the most consequential architecture problems.

## Phase D — Core system correctness

- Fix demonstrated business-logic defects.
- Strengthen authentication, authorization, transaction integrity, validation, and error handling.
- Implement the necessary user/role/permission management.
- Implement the required settings and invoice/receipt customization.
- Add other high-priority production features identified in the gap analysis.

## Phase E — Brand and complete UI/UX redesign

- Implement the HeroMarket brand identity and application assets.
- Establish the design system.
- Redesign the application shell and navigation.
- Redesign all existing major screens.
- Implement Light/Dark Mode.
- Improve interaction feedback, animation, accessibility, and responsive layouts.
- Preserve essential workflow behavior.

## Phase F — Verification and refinement

- Perform browser-based interaction and visual QA.
- Execute functional and regression tests.
- Run database integrity checks.
- Exercise relevant security, reliability, concurrency, and recovery tests.
- Fix issues and retest.
- Verify packaging and startup.

## Phase G — Production engineering

- Complete appropriate Docker and CI/CD configuration.
- Validate build, test, and deployment workflows.
- Review repository hygiene and permissions.
- Confirm backups, documentation, release procedures, and operational instructions.

## Phase H — Final readiness assessment

- Update all documentation.
- Reconcile the original gap analysis against implemented work.
- Review remaining risks and unimplemented features.
- Verify the final repository state.
- Produce an evidence-based completion report.

Reorder tasks when dependencies require it. Document meaningful deviations.

Do not repeatedly restart discovery after each checkpoint. Reuse verified documentation and the actual implementation state.

---

# 20. Mandatory Browser-Based Visual and Functional Verification

Inspect the actual application in a working browser or the appropriate desktop runtime.

Use the browser automation and inspection capabilities actually available in Antigravity.

Capture and inspect important screens in both themes.

Interact with controls instead of only reading source code.

Inspect application logs, browser-console output where relevant, failed requests, runtime exceptions, and database errors.

At minimum, verify:

- Startup and navigation.
- The cashier workflow.
- Product entry and search.
- Payment flow in a test environment.
- Administrative settings.
- User, role, and permission management.
- Invoice/receipt customization.
- Light and dark themes.
- RTL behavior.
- Printer-related flows where available.
- Error and empty states.
- Application behavior after restart.
- Any other high-priority features introduced by the gap analysis.

Use iterative refinement:

1. Launch.
2. Inspect.
3. Capture.
4. Interact.
5. Diagnose.
6. Fix.
7. Retest.

Do not claim visual inspection if it did not occur.

If browser automation or physical hardware is unavailable, state that limitation and perform the remaining checks through the strongest practical alternative.

---

# 21. Definition of Production Readiness

The system should not be described as production-ready merely because the UI looks polished or the project builds successfully.

Evaluate readiness across separate dimensions:

- Data integrity and database migration.
- Core business correctness.
- Authentication and authorization.
- Security controls.
- Functional completeness.
- UI/UX and accessibility.
- Reliability and recovery.
- Performance and concurrency.
- Testing depth.
- Packaging and deployment.
- Backup and restoration.
- CI/CD.
- Documentation.
- Operational support and known limitations.

Create an evidence-based readiness matrix in `.docs/PRODUCTION_READINESS.md`.

For each dimension, record its status, evidence, unresolved issues, severity, and recommended next action.

Distinguish:

- Verified and passing.
- Implemented but not fully verified.
- Partially implemented.
- Blocked by tooling or access.
- Not implemented.
- Not applicable.

Do not promise zero bugs or absolute security. Instead, eliminate identified defects to the extent practical, test the relevant behavior, and be explicit about residual risks.

A feature is not complete because a screen exists; it must be connected to the appropriate logic and persistence, authorized correctly, and tested.

A migration is not complete because the destination database starts; its data and application behavior must be validated.

A release pipeline is not complete because workflow files exist; actual runs and relevant build artifacts must be verified.

---

# 22. Final Repository and Delivery Requirements

Maintain the local project in:

`D:\Youssef\Brands\HeroMarket`

Use the private repository:

`https://github.com/Youssef2508/hero-market`

Review the final Git diff for accidental database dumps, secrets, generated binaries, local paths, irrelevant files, and unrequested destructive changes.

Ensure lockfiles and reproducible configuration are maintained.

Push validated work to the correct private branch if authenticated access and permissions permit.

Never claim a push or remote test succeeded without checking its result.

Keep the development environment runnable for manual testing.

Provide exact commands for:

- Starting the selected database.
- Applying schema migrations.
- Importing legacy data where applicable.
- Starting the application.
- Running the tests.
- Building the application.
- Running the appropriate Docker services.
- Restoring a backup.
- Producing a supported release build.

Use the actual scripts, ports, paths, and commands from the final implementation.

---

# 23. Final Handoff

When the mission reaches its strongest practical completion, deliver a concise but evidence-based report.

Include:

### A. Architecture

- The final technology stack.
- Which technologies changed and why.
- Which original architectural elements were preserved.
- Remaining architectural risks.

### B. Database

- Selected database and deployment model.
- Source files and backups.
- Schema migration details.
- Actual migrated record counts and data-integrity results.
- Application compatibility tests.
- Backup and rollback status.

### C. Product functionality

- Existing features verified.
- Missing features identified.
- New capabilities implemented.
- Role-management and permission enforcement.
- Administrative settings.
- Invoice/receipt designer.
- Known gaps.

### D. UI/UX

- New brand and application assets.
- Navigation and screens redesigned.
- Light/Dark Mode.
- Animation and interaction improvements.
- Browser and viewport verification.

### E. Security

- Findings and remediation.
- Authentication and authorization status.
- Relevant security testing.
- Remaining risks.

### F. Testing

Provide a matrix of the applicable testing categories, commands executed, results, and blockers.

Separate passing tests from tests that were never executed.

### G. DevOps

- Docker configuration and actual use.
- CI workflow execution.
- Build and test results.
- Private repository and branch status.
- Supported release procedure.

### H. Production readiness

- Readiness by dimension.
- Critical unresolved defects.
- Remaining implementation tasks.
- Operational requirements before real supermarket deployment.

### I. Resume state

- Current Git branch and synchronization status.
- Current application status.
- The exact next unfinished task.
- Paths to the primary documentation.
- A repeatable startup command.

---

# 24. Final Execution Directive

Start by inspecting the real project and preserving the current state.

Do not abandon or redo existing work.

Build a reliable understanding of the application, document it, audit the real functionality and architecture, select and migrate to the appropriate production database without losing any existing data, and resolve the highest-priority architectural and business-logic problems.

Then implement the required administrative capabilities, dynamic role-based permissions, receipt customization, and the remaining production-critical features identified by the evidence-based gap analysis.

Complete the HeroMarket branding and system-wide UI/UX transformation while ensuring that important workflows remain familiar and functional.

Implement the appropriate security, reliability, testing, Docker, and CI/CD foundations.

Execute actual tests, inspect actual runtime behavior, validate the database migration, and refine the implementation based on the results.

Maintain accurate documentation and a reliable resume checkpoint throughout the process.

**Do not merely tell me what should be done. Do the work, verify it, preserve the data, preserve valid prior progress, and continue until the strongest practical end-to-end result is achieved.**
