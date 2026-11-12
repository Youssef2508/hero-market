# Security review – Phase 2 (shop, cloud, phone)

Written for the owner and whoever maintains the installation. Done 2026-11-12 on `feature/phase2-owner-cloud` before the pilot, on the code, the test suite, and the real cloud server. Decisions: D-105, D-106 in [DECISIONS.md](DECISIONS.md).

Each finding gives where it is, what was found, and what was done. **Fixed** means changed and covered by a test that fails without the fix. **Sound** means checked and left as is, with the reason.

## Summary

| Area                                | Result                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in from the internet           | Fixed (D-105): real visitor address behind the proxy; a per-name pause on the internet; stronger password hashing off the main thread |
| Sessions after a password change    | Fixed (D-106): a change or reset on either side ends that user's sessions on the other side; a renewed hash no longer does            |
| Permissions of forwarded operations | Fixed (D-106): the shop also refuses a user whose internet access it has withdrawn, before the cloud hears of it                      |
| Recovery codes                      | Fixed (D-106): the super administrator's recovery-code hash no longer reaches the cloud; a cloud that held them cleared them          |
| Mismatched versions                 | Fixed (D-105): the cloud refuses a shop on another database version, before taking anything in                                        |
| Log contents                        | Fixed (D-106): the session cookie and the shop's internal operation key are never written to the log                                  |
| Third-party packages                | Fixed (D-106): three advisories (Electron, fast-uri, undici) updated to compatible patched versions                                   |
| Everything else listed below        | Sound                                                                                                                                 |

## Authentication

- **Sound.** Passwords: scrypt with N=2^14, r=8, p=5 (an OWASP setting), random salt, constant-time comparison. Unknown users take the same time as known ones.
- **Sound.** The password rules refuse short, common, run-of-characters passwords and passwords containing the username (NIST SP 800-63B: no composition rules).
- **Sound.** PINs (from before passwords) never leave the shop, and the cloud refuses them: their columns are stripped from every user record sent.
- **Sound.** The cloud refuses first-run setup, choosing a first password, and super-administrator recovery. These happen at the shop only.
- **Fixed (D-105).** Limits:
  - 5 wrong attempts per terminal;
  - 20 per address;
  - on the internet only, 10 per typed username from any number of addresses, then a 15-minute pause.

  The username limit is keyed by what was typed, so it reveals nothing about which accounts exist. The cloud takes the visitor's address only from its own proxy.

## Sessions and the browser

- **Sound.** Session tokens are 32 random bytes, stored only as SHA-256. Sessions last 12 hours, can be revoked, and are checked on every request against the account's current state (disabled → refused).
- **Sound.** The browser never holds the token. It is in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie limited to `/api`. Every cookie request must also carry a header that only our own page sends, which defeats cross-site request forgery.
- **Sound.** Page protections:
  - a content-security policy allowing only the site's own scripts (plus one hashed inline script);
  - HSTS;
  - `X-Frame-Options: DENY`;
  - `nosniff`;
  - no referrer;
  - camera for the site only.
- **Fixed (D-106).** A password changed or reset on one side now ends that user's sessions on the other side when the change arrives: a lost phone is signed out by changing the password at the shop.

  The cloud already did this for changes from the shop, but by comparing password hashes. Since D-105 renews hashes at sign-in, that would have signed users out after an ordinary sign-in. The rule now looks at "the password was changed or reset", in both directions.

## Authorisation

- **Sound.** Every operation declares its permission, and the service checks it on every call. The screens' hiding of buttons is never the protection.
- **Sound.** The cloud requires «الدخول عبر الإنترنت» on every request, on top of the user's own permissions.
- **Fixed (D-106).** An operation started on the phone is carried out by the shop as that user, with the user and permissions read from the shop's own database. The shop now also checks the internet permission itself.
- **Sound.** The key that lets the cloud's operations run on the shop is a random per-operation value that exists only in the shop's memory for that one operation.

## The link between the shop and its cloud

- **Sound.** Pairing:
  - a 12-character one-time code (30^12 possibilities), valid 15 minutes, stored only as a hash;
  - five wrong codes cancel every open code;
  - the shop makes its own 32-byte secret and sends only its hash;
  - the store's name and fingerprint are shown on the shop PC for the owner to confirm.

  A different PC can take over a store only when it has no business of its own.

- **Sound.** Every link request is authenticated with the shop's secret, compared in constant time against its hash. Requests without it are refused (tested).
- **Sound.** Records from the other side are applied only to the synchronised tables listed in the database, and only to columns the table really has. Table and column names never come from the network unchecked.
- **Sound.** Operations are carried out at most once (the operation id is claimed in its own transaction). An unanswered operation is reported honestly and never repeated silently.
- **Fixed (D-105).** The two sides must be on the same database version.

## Data on the cloud

- **Sound.** The cloud holds the store's business records and the users' password hashes, so the same people can sign in. It does not hold:
  - PINs;
  - sessions from the shop;
  - device secrets, except the shop's hashed one;
  - the shop's backups.
- **Fixed (D-106).** The super administrator's recovery-code hash is no longer sent. Recovery happens at the shop.
- **Sound.** Nightly copies are encrypted (age) to the owner's public key. The server cannot read its own backups. The owner's restore drill passed.

## Database isolation

- **Sound.** Shop: PostgreSQL listens on 127.0.0.1 only, with SCRAM passwords; its random password is in the store's configuration file. The desktop window runs with `sandbox`, `contextIsolation` and no Node.js access.
- **Sound.** Cloud: PostgreSQL is reachable only inside the server's private container network, with a random password. Checked from outside: ports 5432 and 8787 are closed.
- **Accepted.** The cloud service connects as the database owner. A separate role with fewer rights would add moving parts for little gain while the database is unreachable from outside.

## The server

- **Sound.**
  - SSH by key only: password login off, root login off (Contabo's own setting turned passwords on; it is overridden).
  - Firewall: 22, 80, 443 only.
  - Automatic security updates.
  - Docker from Docker's repository.
  - The settings file is readable by its owner only.
  - The cloud and proxy containers run read-only, with no Linux capabilities (except the proxy's port binding), and the service as an unprivileged user.
- **Fixed (D-106).** The backup container now also runs read-only and without capabilities.
- **Sound.** Let's Encrypt certificate, renewed automatically; HTTP only redirects to HTTPS.

## Common attacks

| Attack                                   | Protection                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SQL injection                            | Parameters everywhere; identifiers only from the database's own catalogue or fixed lists                       |
| Cross-site scripting                     | React escapes output; the content-security policy forbids other scripts                                        |
| Cross-site request forgery               | `SameSite=Strict` cookie and a header only our page sends                                                      |
| Clickjacking                             | `X-Frame-Options: DENY`                                                                                        |
| Guessing passwords                       | Per terminal, address and username limits; slow hashes                                                         |
| Guessing a pairing code or device secret | Code space 30^12 with cancellation after 5 failures; secrets of 256 bits                                       |
| Replaying or duplicating an operation    | One-time operation ids, claimed in the operation's own transaction                                             |
| Path traversal on the website            | Files are served only from inside the build folder                                                             |
| Oversized requests                       | Body limits (2 MiB per operation, 16 MiB for the link) at the service and 20 MB at the proxy                   |
| Eavesdropping                            | HTTPS only, HSTS                                                                                               |
| A stolen phone                           | Change the password at the shop: its cloud sessions end; or remove the internet permission                     |
| A stolen server                          | It holds password hashes (slow scrypt) and the store's records; not PINs, recovery codes, or a readable backup |

## What the owner should keep doing

- **The backup key:** two USB copies in two places (see the instructions next to the key).
- **Strong passwords:** for everyone who has the internet permission. Give that permission only to people who need it.
- **Updates:** the cloud first, then the shop (architecture §14.1).
