# Design System & UI Specifications

This document defines the styling tokens, visual typography rules, component layouts, and right-to-left (RTL) Arabic text configurations for **HeroMarket POS**.

---

## 1. Visual Aesthetics & Typography
To provide cashiers with a high-readability, low-fatigue workspace during long shifts, the UI implements a modern dark-theme dashboard combined with clean typography.

*   **Primary Fonts:** `Cairo`, `Amiri`, `Segoe UI`, `System-UI`.
    *   *Cairo* is used for interface headings and button controls.
    *   *Amiri* is used for receipt typography layouts.
*   **Text Direction:** Native **RTL (Right-to-Left)**. Main HTML inputs, flex-boxes, and tables align to the right side of the desktop window.

---

## 2. Color Palette System
The CSS layout uses color tokens to keep interfaces consistent and clear:

| Category | Token | Usage | Visual Feel |
|---|---|---|---|
| Background | `--bg-primary` | Main application backdrop | Deep Dark Grey (`#0e1113`) |
| Surface | `--bg-secondary` | Cards, tables, tab bodies | Charcoal Gray (`#15191c`) |
| Borders | `--border-color` | Grid dividers, modal frames | Slate Gray (`#21282c`) |
| Primary Accent | `--accent-primary`| Action buttons, active badges| Emerald Teal (`#10b981`) |
| Danger Accent | `--accent-danger` | Return operations, delete triggers| Crimson Red (`#ef4444`) |
| Text Main | `--text-primary` | Standard text labels, forms | Off-White (`#f3f4f6`) |
| Text Sub | `--text-secondary`| Footnotes, timestamps, units | Gray Muted (`#9ca3af`) |

---

## 3. Custom React Modal System (Non-Blocking)
Due to standard electron architectures, native browser alert popups freeze the main execution loop. We enforce a React-based custom modal system:

```
                  ┌──────────────────────────────┐
                  │      App Context Layer       │
                  │   [useAdminController.js]    │
                  └──────────────┬───────────────┘
                                 │
                   Exposes Modal State & Methods
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌──────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│  ClientsManager  │   │  ProductsManager  │   │  SuppliersManager │
│  (Custom Alert)  │   │ (Custom Confirm)  │   │  (Custom Alert)   │
└──────────────────┘   └───────────────────┘   └───────────────────┘
```

### Hook API Calls
To display messages, inject the alert triggers via hooks context:
*   **Show Alert:**
    ```javascript
    triggerCustomAlert("تم تسجيل دفعة العميل بنجاح", "تأكيد الدفع");
    ```
*   **Show Confirmation Dialog:**
    ```javascript
    triggerCustomConfirm(
      "هل أنت متأكد من حذف هذا الصنف؟",
      async () => { await deleteProduct(barcode); },
      () => { console.log("Deletion cancelled"); },
      "تأكيد الحذف"
    );
    ```

---

## 4. Keyboard & Input Handling (Scanner Focus)
Point of Sale registers rely heavily on keyboard simulation barcode scanners.
*   **Listener Interception:** A global keyboard hook listener intercepts scan triggers.
*   **Focus Guard:** If any modal (e.g. `CloseShiftModal`, `EditUserModal`, or custom alert) is open, the barcode scanner event listener MUST bypass inputs and release autofocus. This prevents barcode characters from entering form inputs.
