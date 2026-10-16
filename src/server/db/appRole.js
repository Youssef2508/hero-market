'use strict'
// The ordinary database role the app connects with (1.4.0 security review, option C).
//
// On a PC shared by several Windows users, every user can read the app's database password. So the
// app's role must not be a superuser: a superuser can run Windows commands as the account running
// PostgreSQL (COPY … TO PROGRAM), read and write server files, and change server settings. The app
// only needs to OWN the shop's objects: migrations, restores, the legacy import and sync recovery
// use ownership-level statements only (ALTER TABLE … DISABLE TRIGGER USER, TRUNCATE, setval).
//
// These functions run as a superuser (the installer's elevated setup), connected to the shop's
// database.

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(s)) throw new Error(`Invalid role name: ${s}`)
  return `"${s}"`
}
const literal = (s) => `'${String(s).replace(/'/g, "''")}'`

/** Create (or update) the app role: may log in, nothing else. */
async function ensureAppRole(client, { role, password }) {
  const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount
  const attrs = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT'
  await client.query(
    `${exists ? 'ALTER' : 'CREATE'} ROLE ${ident(role)} WITH ${attrs} PASSWORD ${literal(password)}`
  )
}

/**
 * Give the app role ownership of the database, its public schema and every object in it that
 * belongs to `from` (the role that created them, e.g. the former superuser "heromarket").
 * Sequences owned by a table column follow their table. Returns the number of objects moved.
 */
async function transferOwnership(client, { database, from, to }) {
  const q = (sql) => client.query(sql)
  let moved = 0
  await q(`ALTER DATABASE ${ident(database)} OWNER TO ${ident(to)}`)
  await q(`ALTER SCHEMA public OWNER TO ${ident(to)}`)
  const rels = await client.query(
    `SELECT c.relname, c.relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND pg_get_userbyid(c.relowner) = $1
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        AND NOT (c.relkind = 'S' AND EXISTS (
              SELECT 1 FROM pg_depend d
               WHERE d.objid = c.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')))`,
    [from]
  )
  const kind = {
    r: 'TABLE',
    p: 'TABLE',
    v: 'VIEW',
    m: 'MATERIALIZED VIEW',
    S: 'SEQUENCE',
    f: 'FOREIGN TABLE'
  }
  for (const r of rels.rows) {
    await q(`ALTER ${kind[r.relkind]} public.${ident(r.relname)} OWNER TO ${ident(to)}`)
    moved++
  }
  const funcs = await client.query(
    `SELECT p.oid::regprocedure::text AS sig, p.prokind
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = $1`,
    [from]
  )
  for (const f of funcs.rows) {
    await q(`ALTER ${f.prokind === 'p' ? 'PROCEDURE' : 'FUNCTION'} ${f.sig} OWNER TO ${ident(to)}`)
    moved++
  }
  const types = await client.query(
    `SELECT t.typname
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND pg_get_userbyid(t.typowner) = $1
        AND t.typtype IN ('e', 'd', 'c') AND (t.typrelid = 0 OR t.typtype <> 'c')`,
    [from]
  )
  for (const t of types.rows) {
    await q(`ALTER TYPE public.${ident(t.typname)} OWNER TO ${ident(to)}`)
    moved++
  }
  return moved
}

/** Objects in the public schema still owned by someone other than `role` (should be none). */
async function foreignOwned(client, role) {
  const { rows } = await client.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
        AND pg_get_userbyid(c.relowner) <> $1
     UNION ALL
     SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) <> $1`,
    [role]
  )
  return rows.map((r) => r.name)
}

module.exports = { ensureAppRole, transferOwnership, foreignOwned }
