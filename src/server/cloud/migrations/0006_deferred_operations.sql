-- 0006 – Changes that need the shop, made while it cannot be reached (D-111): a barcode change, a
-- deletion, a purchase correction. Instead of being refused, each is kept here as a deferred
-- operation, handed to the shop on its next contact and carried out there once, by its own handler
-- and rules; until then it is "waiting for the shop" and its owner may withdraw it.
ALTER TABLE cloud_operations ADD COLUMN deferred boolean NOT NULL DEFAULT false;
CREATE INDEX cloud_operations_user ON cloud_operations (user_id, created_at DESC) WHERE deferred;
