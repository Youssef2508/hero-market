# 1.4.1 (planned): new items and the invoice photo in supplier purchase invoices

Status: **agreed with the owner on 2026-10-16; not built yet.** This is planned as the first update delivered through the safe update process ([UPDATE_GUIDE.md](UPDATE_GUIDE.md)). Version 1.4.0 keeps its tested scope.

## Today (1.4.0)

**الموردين → (supplier) → إضافة فاتورة شراء.** For each line you enter a barcode, a unit (piece or carton), a quantity and a cost. Saving does all of this in one transaction:

- stock rises by the base quantity;
- the cost price becomes the moving average;
- the unpaid part is added to the supplier's balance;
- the paid part leaves the drawer of the open shift;
- everything is audited.

A barcode that is not registered is refused ("الصنف غير مسجل").

## Owner decisions

| Question | Decision |
| --- | --- |
| Selling price of an item created from a purchase | **Required** in the quick panel. A warning appears if it is below the purchase cost. The item can be sold right away. |
| Item without a barcode | **An internal code is generated** (unique). It is found by name (F2) or category (F6), and a barcode can be added later. |
| Who may create items from a purchase | **Only users who may add items.** Recording purchases alone does not show the option, and the server refuses it. |
| Category | **Optional**, chosen in the same panel. Without one, the item is under "بدون تصنيف". |
| Invoice photo | **The supplier's invoice can be attached** as a photo or scan (JPEG, PNG or PDF) and viewed later from the purchase. |
| Version | **1.4.1** |

## Behaviour to build

1. **Find items:** in the purchase form, search by barcode **or name**.
2. **Not found:**
   - A "صنف جديد" panel opens inside the same invoice, with the barcode filled in (or "a code will be generated"), the quantity and the cost.
   - It asks for the name, unit kind and name, selling price and optional category.
   - Similar existing names are shown ("did you mean …?"), and a duplicate barcode is refused.
3. **All or nothing:**
   - The new items and the invoice are saved together in one transaction. An invoice that is not saved creates no item.
   - The new item starts with no stock and receives the purchased quantity as a stock movement. Its cost is the purchase cost.
   - The audit log records "صنف جديد من فاتورة شراء #…".
4. **Invoice photo:**
   - **Optional.** One file per purchase (more can be considered later).
   - **Stored in the shop's database**, so it is included in backups, the verified copies taken before updates, and restores.
   - **Up to about 5 MB.** Large photos are reduced automatically.
   - **Only real JPEG, PNG or PDF files are accepted** (the contents are checked, not just the file name).
   - **Viewable** by users who may see purchases.
5. **Database changes (a "Case B" update):** a migration adds the internal-code sequence and the photo storage. The release notes must name the migration and say whether 1.4.0 can still open the database afterwards. Recovery uses the verified copy the installer takes.

## Tests to add (when built)

- **Service tests:**
  - a purchase with a new item, with and without a barcode;
  - a new item refused without permission;
  - a duplicate barcode;
  - an invoice that fails creates no item;
  - stock and moving average after the purchase;
  - a photo accepted; a fake file refused; a photo that is too large;
  - the photo is included in backup and restore.
- **Update test:** 1.4.0 → 1.4.1 in Windows Sandbox. The migration is applied, all existing records are kept, a failed migration is restored automatically, and the release notes are complete.
