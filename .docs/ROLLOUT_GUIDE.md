# Rollout: connecting the shop to its cloud

Written for Youssef (who prepares the release and the server) and the shop owner (who installs it on the shop PC). Print it and tick each box. Part 2 takes about 45 minutes on the shop PC, best after closing time.

The shop PC keeps all its data. The new installer updates the program **and the database already on the PC** in place: nothing is uninstalled, re-imported or typed again. The PC then sends its whole store to its own cloud once, and from then on keeps the two in step.

The release is **1.6.0** ([RELEASE_NOTES_1.6.0.md](RELEASE_NOTES_1.6.0.md)): its installer, size and SHA-256 are in the release notes and in `SHA256SUMS.txt`.

Proven before release:

- On stores made by the released 1.4.0 and 1.5.2 programs themselves (`existingInstall.test.js`), the update kept every record and number, and pairing sent the whole store to the empty cloud and nothing the other way. The cloud then held the same records, and the website showed the same invoice list.
- On a clean Windows (Windows Sandbox), the installer updated over a running background service. The pairing and every change waiting to be sent survived.
- **Rehearsed on the real cloud (2026-11-12),** with the same steps as below:
  - the 1.5.2 store was updated in place from database version 0031 to 0036 in 2 s;
  - it was paired with a one-time code, and the first sync finished in 6 s;
  - on the website, the invoice, product and shift lists were identical to the shop's;
  - a change made on the website reached the shop's database, and a deletion at the shop reached the website;
  - all 31 screens passed the phone-layout check at two phone sizes on the real site.

## Part 1 – Youssef, before the visit or call

- [ ] **1. Approval and release.** With the owner's approval:
  - merge `feature/phase2-owner-cloud` into `main`;
  - set the version to 1.6.0;
  - build the installer and record its SHA-256 in `SHA256SUMS.txt`;
  - publish the GitHub release;
  - put the installer and `SHA256SUMS.txt` on the USB stick.
- [ ] **2. Update the cloud to the same release** (on the server, [CLOUD_DEPLOYMENT.md](CLOUD_DEPLOYMENT.md) §7):

  ```bash
  ssh -p 8443 -i ~/.ssh/heromarket_cloud_ed25519 ubuntu@109.123.240.94   # 8443 or 2222 where port 22 is blocked
  cd /opt/heromarket && sudo deploy/cloud/update.sh v1.6.0
  ```

  It ends with `updated to v1.6.0`. If it says it went back to the previous version, stop and look at its log.

- [ ] **3. Empty the cloud.** Until now it holds only trial data, and a cloud that serves another store refuses a shop with sales of its own:

  ```bash
  sudo deploy/cloud/reset-empty.sh          # type heromarket.duckdns.org to confirm
  curl -s https://heromarket.duckdns.org/api/health
  ```

  The last command answers `{"status":"ok",…}`.

- [ ] **4. The pairing code**, made shortly before step 15 (it is valid 15 minutes and works once):

  ```bash
  sudo docker compose -f deploy/cloud/docker-compose.yml exec cloud node src/server/cli.js cloud-pair "اسم المتجر"
  ```

  Give the owner the code (`XXXX-XXXX-XXXX`) by phone or in person. It is useless after one use or 15 minutes.

## Part 2 – The owner, on the shop PC

### A. Before the update (the installed version still running)

- [ ] **5. Finish the day:** no customer at the till; close the open shift as usual.
- [ ] **6. Write down** to compare later:
  - «الأصناف المسجلة» and «ديون العملاء المستحقة» on «لوحة الإدارة»;
  - the number of the last invoice;
  - the balances of two suppliers;
  - the stock of three products.
- [ ] **7. Back up:** «النسخ الاحتياطي» → «إنشاء نسخة احتياطية الآن», saved on a USB stick. Check that the file is there and is larger than 0 KB. Copy it to a second place.
- [ ] **8. Keep** the installer of the installed version: it is the way back.
- [ ] **9. Close HeroMarket** on every Windows account of the PC.

### B. Check and install

- [ ] **10.** Copy `HeroMarket-Setup-1.6.0.exe` to the Desktop. In PowerShell:

  ```
  Get-FileHash "$env:USERPROFILE\Desktop\HeroMarket-Setup-1.6.0.exe"
  ```

  The `Hash` must equal the one in `SHA256SUMS.txt`. If it differs, **stop**.

- [ ] **11.** Double-click the installer.
  - On "Windows protected your PC", choose **More info** → **Run anyway**.
  - When Windows asks to allow changes, choose **Yes**.
  - **Do not uninstall** the old version first, and do not switch the PC off while it runs.

  It does the following:
  1. makes a verified copy of the whole database;
  2. updates the database and checks that no record and no total changed;
  3. registers the nightly backups and the background connection service.

- [ ] **12. If it says the update failed:** your data has already been put back as it was. Run the old installer again, and send Youssef `C:\ProgramData\HeroMarket\logs\setup.log` and `update-history.jsonl`.

### C. After the update

- [ ] **13.** Open HeroMarket and sign in as the owner with the same username and password.
- [ ] **14. Compare** with step 6: the same numbers. If anything differs, **do not continue**, and send Youssef a photo. Only from 1.4.0: purchase prices now show each product's latest purchase price (the rule since 1.5.2).

### D. Pairing with the cloud

- [ ] **15.** Menu → «المزامنة السحابية» → the card «ربط المتجر بالسحابة برمز الربط». Enter:
  - **عنوان السحابة:** `https://heromarket.duckdns.org`
  - **رمز الربط:** the code from step 4.

  Press «ربط».

- [ ] **16.** The screen shows «تم الربط بالمتجر «…»» with the store's name and a fingerprint. The name must be yours.
  - If the screen says the cloud serves another store, stop: step 3 was not done.
  - If it says the code is wrong or expired, ask for a new one (step 4).
- [ ] **17. The first send.** Wait on the same screen. It is a few minutes at most for a year of a small shop's records. It is finished when it shows:
  - «كل التغييرات وصلت إلى السحابة وتطابقت»;
  - «بانتظار الإرسال» at 0;
  - «الاتصال يعمل من» showing «خدمة المزامنة في الخلفية (تعمل والبرنامج مغلق)»;
  - «الإصدار» the same on «هذا الجهاز» and «السحابة».
- [ ] **18. Who may use the phone:** administrators may. For anyone else, give their role «الدخول عبر الإنترنت» in «الأدوار والصلاحيات».

## Part 3 – Checking together that the connection works

- [ ] **19.** On a phone (or any browser), open `https://heromarket.duckdns.org` and sign in with the owner's username and password.
- [ ] **20. The same store:**

  | On the shop PC                                   | On the phone                      |
  | ------------------------------------------------ | --------------------------------- |
  | The last invoice number and its total            | The same in «الفواتير والمرتجعات» |
  | «ديون العملاء المستحقة», two suppliers' balances | The same                          |
  | The stock of three products                      | The same                          |
  | The last closed shift and its figures            | The same in «الورديات»            |

- [ ] **21. Both directions, with something harmless:**
  - Add a category from the phone (for example «تجربة الربط»): it appears on the PC within seconds.
  - Delete it on the PC: it disappears from the phone.
- [ ] **22. Optional:** close HeroMarket on the PC and repeat step 21. It still works, because the background service keeps the link.
- [ ] **23. Add to home screen** on the owner's phone: the browser's menu → "Add to Home screen".

## If something goes wrong

| Situation                                              | What to do                                                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| The update failed (step 12)                            | Nothing was lost: the installer put the data back. Re-run the old installer.                                                                    |
| Figures differ after the update (step 14)              | Do not sell. Going back: run the old installer, then restore the backup of step 7 in «النسخ الاحتياطي». Send Youssef `app.log` and `setup.log`. |
| Pairing refused: "serves another store"                | Step 3 was skipped. Run `reset-empty.sh`, make a new code, pair again.                                                                          |
| The first send does not finish, or «تحديث مطلوب» shows | The PC and the cloud are on different versions: repeat step 2 with the PC's version. The shop keeps working meanwhile.                          |
| The phone shows «المتجر غير متصل»                      | The PC is off or offline. Work on the phone continues and comes together when the PC is back.                                                   |
| Undo the connection entirely                           | «المزامنة السحابية» → «إلغاء الربط». The shop's data is not touched.                                                                            |

## Recovery later

- **The cloud's database is lost:**
  1. `reset-empty.sh` (or a new server);
  2. a new pairing code;
  3. pair again with the same address.

  The cloud is rebuilt from the shop at once. Only phone work that the shop had not yet received is missing; restoring the cloud's nightly copy with the owner's key brings that back too ([CLOUD_DEPLOYMENT.md](CLOUD_DEPLOYMENT.md) §6).

- **The shop's database is lost:** restore the latest local backup («النسخ الاحتياطي»). HeroMarket pauses selling until you press «استرجاع من السحابة» on «المزامنة السحابية». Everything recorded after that backup comes back, each record once, including phone work done while the shop was offline. Then work resumes with the same pairing.
