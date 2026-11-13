# HeroMarket POS 1.6.2 – Release notes

Written for the shop owner. 1.6.2 is a reliability and safety update from the final check before you start real work with HeroMarket (the full report: [PRE_PRODUCTION_AUDIT_REPORT.md](PRE_PRODUCTION_AUDIT_REPORT.md)). Nothing changes in how you work. Everything in [RELEASE_NOTES_1.6.1.md](RELEASE_NOTES_1.6.1.md) still applies.

**Updating:** the website is updated first, by Youssef; then you install 1.6.2 on the shop PC, over 1.4.0 or any later version, as for every update ([ROLLOUT_GUIDE.md](ROLLOUT_GUIDE.md)). No database change: nothing is paired again, and nothing waiting to be sent is lost.

## What changes

- **On a tablet, the website's buttons are finger-sized,** as on a phone. Before, a tablet showed the small buttons meant for a mouse.
- **A broken or oversized request to the website is refused politely** instead of being recorded as a fault of the server, so real problems stand out in the server's records.
- **Updating the website can no longer stop half way** if Youssef's connection drops during the update.

## Checked before this release

- **Your shop and the website together,** on the real website with test data:
  - the shop PC switched off suddenly with 480 changes waiting;
  - the website restarted twice while sales were arriving;
  - the shop off while the phone kept selling.

  Every sale arrived once, with the right total; stock and balances matched; both sides held the same 2,288 records.

- **Security from the internet:**
  - nobody can set up or take over the website;
  - every action needs a valid sign-in and the right permission;
  - wrong-password limits cannot be bypassed;
  - no passwords or keys are stored in the code.
- **The website's encrypted backup** was opened with your backup key and restored correctly.
- **Every screen** at nine screen sizes, from a small phone to a large monitor.
- **The website was emptied afterwards** and checked to be exactly as before the tests, ready for your first pairing.

## The installer

The file, its size and its SHA-256 are added here once it is built from `main`.
