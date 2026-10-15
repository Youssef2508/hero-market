-- 0003 – Permission keys already offered to built-in roles.
-- When a new release adds a permission, built-in roles that include it by default receive it once;
-- permissions an administrator removed from a role are never re-added.
CREATE TABLE permission_catalog (
  key        text PRIMARY KEY,
  added_at   timestamp NOT NULL DEFAULT LOCALTIMESTAMP(0)
);
