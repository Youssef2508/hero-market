# HeroMarket – Mobile and responsive UX audit (pre-production, 2026-11-13)

Part of [PRE_PRODUCTION_AUDIT_REPORT.md](PRE_PRODUCTION_AUDIT_REPORT.md).

## Method

`scripts/phone-check.js` drives the browser build (Microsoft Edge, Playwright, Arabic locale) on the local trial stack (`scripts/phase2-dev.js`, made-up data), signs in as the owner and opens **every screen in the menu (31)**. On each it measures:

- whether the page scrolls sideways;
- every visible element cut off at the screen's edge (outside a deliberately scrolling container);
- controls smaller than 40 × 40 px.

It also records page errors and any message a screen raised on opening, and takes a screenshot of each screen. Phone and tablet sizes run as touch devices; desktop sizes as a mouse. The script now also drives the wide layouts (sidebar, compact or not).

In addition, every new 1.6.1 workflow was clicked through in the browser at 1366 × 768: supplier payment, preliminary invoice, the notice, the till's F8/F9 and the new-customer code.

## Results

| Viewport    | Device         | Screens | Sideways scroll / cut off | Small controls           |
| ----------- | -------------- | ------- | ------------------------- | ------------------------ |
| 320 × 640   | phone          | 31      | 0                         | 0                        |
| 360 × 740   | phone          | 31      | 0                         | 0                        |
| 375 × 812   | phone          | 31      | 0                         | 0                        |
| 390 × 844   | phone          | 31      | 0                         | 0                        |
| 412 × 915   | phone          | 31      | 0                         | 0                        |
| 430 × 932   | phone          | 31      | 0                         | 0                        |
| 768 × 1024  | tablet (touch) | 31      | 0                         | **23 → 4** after UX-01   |
| 1366 × 768  | desktop        | 31      | 0                         | 23 (mouse: not a defect) |
| 1920 × 1080 | desktop        | 31      | 0                         | 24 (mouse: not a defect) |

No page errors at any size.

## Defects

| ID    | Severity | Screen / viewport                  | Defect                                                                                                                                              | Status                                                                                                                                                                      |
| ----- | -------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-01 | Medium   | 23 of 31 screens, 768 × 1024 touch | The finger-sized controls applied below 760 px only, so a tablet got the desktop's mouse-sized buttons (36 px and less).                            | **Fixed**: any touch screen ≥ 760 px wide on the website gets the phone's 44 px targets (`styles/phone.css`, `.is-web` only, so a touch till in the shop keeps its layout). |
| UX-02 | Low      | 4 screens, 768 × 1024              | Narrow number fields inside table rows stay under 40 px wide.                                                                                       | Open, low (wider fields would crowd the tables).                                                                                                                            |
| UX-03 | Low      | supplier payment list              | It showed «له رصيد لدينا 4,100» for a pending 5,000 against 900 owed: owed minus unapproved requests, worded as if the supplier held credit.        | **Fixed in 1.6.1** (found by this click-through): recorded balance and pending requests shown apart.                                                                        |
| UX-04 | Low      | till, new customer                 | The suggested code was cut off in its narrow field.                                                                                                 | **Fixed in 1.6.1**: the suggestion is the placeholder, with a hint line under it.                                                                                           |
| UX-05 | Low      | sign-in page of an unpaired cloud  | Before any shop is paired, the website shows the first-run form, which the cloud then refuses (`shop_only`). Only visible before the first pairing. | Open, low.                                                                                                                                                                  |

## Not covered

- Real phones and tablets (only browser emulation of their sizes and touch).
- Screen readers. A basic accessibility pass was made: labels and `aria-label` on icon-only controls, `role="dialog"`/`aria-modal` on dialogs, `aria-current` in the menu, RTL throughout. Focus trapping in dialogs was not audited in depth.
- Slow-network and offline states on a phone, beyond the link-status banner shown in the screenshots.
