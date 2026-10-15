-- 0011 – Integrity fixes from the 1.4.0 audit. Changes no existing business value except the two
-- new bookkeeping columns on sales, which are filled from records that already exist.
--
-- 1. A closed shift is final. Its cash was counted and its figures were saved; nothing may be
--    added to it, changed in it or removed from it afterwards. Before, the checks read the shift
--    without locking it, so a sale or a drawer movement committing while the shift was being
--    closed could land on the closed shift and be missing from its saved figures; and deleting
--    an expense or a till movement of a closed shift silently changed that shift's totals.
--    Now every write that touches drawer money locks its shift (FOR SHARE) and requires it to be
--    open; closing locks the shift (FOR UPDATE) before computing its figures.
-- 2. Opening a shift twice at the same moment could create two open shifts for one user.
-- 3. Returns refund through the right channel: a credit (آجل) or part-paid (دفع جزئي) invoice first
--    reduces what the customer still owes for it, then gives back store balance the customer spent
--    on it, and only the rest leaves the drawer as cash. Before, a part-paid invoice was refunded
--    entirely in cash, including the part never paid, and balance spent on an invoice came back as
--    cash. The amounts still open per invoice are kept on the sale.
--
-- Bulk administrative work (backup restore, legacy import, recovery from the cloud, ledger
-- rebuilds) sets hm.bulk_load or hm.ledger_rebuild and is exempt from rule 1.

CREATE FUNCTION hm_require_open_shift() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids integer[];
  sid integer;
  st text;
BEGIN
  IF current_setting('hm.bulk_load', true) = 'on' OR current_setting('hm.ledger_rebuild', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    ids := ARRAY[NEW.shift_id];
  ELSIF TG_OP = 'DELETE' THEN
    ids := ARRAY[OLD.shift_id];
  ELSE
    ids := ARRAY[OLD.shift_id, NEW.shift_id];
  END IF;
  FOREACH sid IN ARRAY ids LOOP
    CONTINUE WHEN sid IS NULL;
    SELECT status INTO st FROM shifts WHERE id = sid FOR SHARE;
    IF st IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'الوردية رقم #% مغلقة: لا يمكن إضافة حركات مالية إليها أو تعديلها أو حذفها بعد الإغلاق. افتح وردية جديدة.', sid
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $$;

-- Sales: a new sale needs an open shift (replaces the unlocked legacy check). Returns update old
-- sales of closed shifts on purpose; their money moves in the current shift.
DROP TRIGGER prevent_sale_on_closed_shift ON sales;
DROP FUNCTION hm_prevent_sale_on_closed_shift();
CREATE TRIGGER require_open_shift BEFORE INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION hm_require_open_shift();

CREATE TRIGGER require_open_shift BEFORE INSERT OR UPDATE OR DELETE ON safe_ledger
  FOR EACH ROW EXECUTE FUNCTION hm_require_open_shift();
CREATE TRIGGER require_open_shift BEFORE INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION hm_require_open_shift();
CREATE TRIGGER require_open_shift BEFORE INSERT OR UPDATE OR DELETE ON momkn_transactions
  FOR EACH ROW EXECUTE FUNCTION hm_require_open_shift();
CREATE TRIGGER require_open_shift BEFORE INSERT OR UPDATE OR DELETE ON mobile_money_transactions
  FOR EACH ROW EXECUTE FUNCTION hm_require_open_shift();

-- One open shift per user, also when two requests arrive together.
CREATE OR REPLACE FUNCTION hm_prevent_multiple_open_shifts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'open' THEN
    PERFORM pg_advisory_xact_lock(hashtext('hm-open-shift:' || NEW.user_id));
    IF EXISTS (SELECT 1 FROM shifts WHERE user_id = NEW.user_id AND status = 'open') THEN
      RAISE EXCEPTION 'خطأ: يوجد وردية مفتوحة بالفعل لهذا المستخدم.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- What each invoice still has on the customer's account, and store balance spent on it.
ALTER TABLE sales
  ADD COLUMN on_account_open numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN credit_open     numeric(14, 2) NOT NULL DEFAULT 0;

-- Existing invoices, from the records written when they were sold (the legacy texts).
UPDATE sales SET on_account_open = GREATEST(0, total_amount)
 WHERE payment_type = 'آجل' AND client_id IS NOT NULL;
UPDATE sales s SET on_account_open = LEAST(GREATEST(0, s.total_amount), l.amount)
  FROM (SELECT description, SUM(amount) AS amount FROM client_ledger
         WHERE description LIKE 'متبقي بيع دفع جزئي فاتورة رقم #%' GROUP BY description) l
 WHERE s.payment_type = 'دفع جزئي' AND s.client_id IS NOT NULL
   AND l.description = 'متبقي بيع دفع جزئي فاتورة رقم #' || s.id;
UPDATE sales s SET credit_open = l.amount
  FROM (SELECT description, SUM(amount) AS amount FROM client_ledger
         WHERE description LIKE 'استهلاك رصيد كخصم في فاتورة رقم #%' GROUP BY description) l
 WHERE s.client_id IS NOT NULL AND l.description = 'استهلاك رصيد كخصم في فاتورة رقم #' || s.id;
