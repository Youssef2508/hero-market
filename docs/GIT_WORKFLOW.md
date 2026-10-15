# Git & Versioning Workflow

This document defines the version control procedures, branch models, and deployment release standards for **HeroMarket POS**. Adhering to these guidelines keeps history structured and provides recovery paths for cashier desk rollbacks.

---

## 1. Branch Strategy
*   **`main` Branch:** Represents the active production state. All code pushed or merged here must compile cleanly, pass linting checks, and be validated against mock/production databases.
*   **Feature Branches (`feature/*`):** Created for developing new systems (e.g., `feature/multi-till`). Merge requests back into `main` must undergo verification.
*   **Hotfix Branches (`hotfix/*`):** Created directly from stable tags to address immediate cashier bugs (e.g. printer crashes or scanner focus issues).

---

## 2. Release & Versioning Policy
We enforce **Semantic Versioning (SemVer)**: `MAJOR.MINOR.PATCH` (e.g., `1.2.2`).

### Rules for Version Increments
1.  **PATCH Increment (e.g. `1.2.2` -> `1.2.3`):** For bug fixes or internal adjustments that don't change core schemas or interfaces (e.g. tweaking CSS or fixing a typo).
2.  **MINOR Increment (e.g. `1.2.2` -> `1.3.0`):** For backward-compatible feature additions (e.g. adding the Multi-Till manager screen or custom logs filters).
3.  **MAJOR Increment (e.g. `1.2.2` -> `2.0.0`):** For backward-incompatible API changes, major UI overhauls, or breaking database schema migration dependencies.

---

## 3. Deployment Checkpoints (Tags)
To ensure the supermarket cashier can revert to a stable working version if a new package build encounters unexpected terminal runtime crashes, we tag production states.

### Creating a Tag
1.  Verify the version is incremented in `package.json`.
2.  Commit all changes on the `main` branch.
3.  Execute tag creation:
    ```bash
    git tag -a v1.2.2-stable -m "Stable POS build with updated cashier log audits"
    ```
4.  Push the tag to GitHub:
    ```bash
    git push origin v1.2.2-stable
    ```

---

## 4. Commit Standards
Commit messages should be concise and prefixed with their functional scope:

| Prefix | Description | Example |
|---|---|---|
| `feat:` | A new feature | `feat: add checks status toggle in invoice registry` |
| `fix:` | A bug fix | `fix: resolve scanner focus leakage on shifts modal` |
| `docs:` | Documentation changes only | `docs: complete database and layout schema guides` |
| `refactor:` | Code change that neither fixes a bug nor adds a feature | `refactor: optimize SQL transaction script execution` |
| `chore:` | Build processes or auxiliary tool changes | `chore: update gitignore for pdf outputs` |
