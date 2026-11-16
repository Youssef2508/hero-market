# Cloud Pre-Handover Readiness and Cleanup Report (1.8.0)

Written for Youssef, before deciding on the 1.8.0 release. Dates are 2026-11-16, times UTC. Every test record was made-up and marked `QA`.

## 1. What was found before testing, and the decision

- **The website is in use.** The brief assumed it was unused, but a read-only check found it holds the owner's real store: his shop PC linked on 2026-11-14 at 22:27. It held 3,130 products, 110 sales (17 Oct to 15 Nov), 4 users and 31 phone operations.
- **Why it could not be the test target:**
  - a cloud serves one store, so linking a test shop to it would have refused the owner's PC from then on;
  - the requested final reset would have deleted his copy;
  - either way, he would have had to pair again.
- **Decision (Youssef, 2026-11-16):** test on a separate, isolated stack on the same server. Production stays untouched; the owner must not unpair, reset or reimport.

## 2. The isolated test stack

| Part       | Production                                     | Test stack                                                                   |
| ---------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Project    | `heromarket-cloud` (`/opt/heromarket`)         | `hmqa` (`/opt/hm-qa`, its own clone of PR #53)                               |
| Containers | `heromarket-cloud-{db,cloud,proxy,backup}-1`   | `hmqa-qadb-1`, `hmqa-qacloud-1`, and `hmqa-qarunner-run-*` while a phase ran |
| Database   | `heromarket`, volume `heromarket-cloud_pgdata` | `hmqa`, user `hmqa`, volume `hmqa_qadata`, own random password               |
| Network    | `heromarket-cloud_inside` 172.31.250.0/24      | `hmqa_qa` 172.31.251.0/24                                                    |
| Exposed    | 80/443 through Caddy                           | nothing public: `127.0.0.1:18787` only; no proxy, no TLS, no DNS             |
| Secrets    | `deploy/cloud/.env` (not read)                 | `/opt/hm-qa/.env`, generated for it (0600)                                   |
| Images     | `heromarket-cloud:v1.7.0` …                    | `hmqa-cloud:pr53`, `hmqa-runner:pr53` (Playwright 1.49.1 base)               |
| Limits     | –                                              | QA cloud 1.5 CPU / 1 GB, QA database 1 CPU / 1 GB, runner 1 CPU / 2 GB       |

**Proven isolation:**

- From inside the QA cloud container, production's `db` name does not resolve (`EAI_AGAIN`), and production's addresses 172.31.250.20 and 172.31.250.10 time out.
- **Guard:** every destructive step (each phase, the database reset, the cleanup) first required:
  - the two `hmqa` containers;
  - the database `hmqa` carrying its marker row `HEROMARKET-QA-TEST-STACK`;
  - production's four containers with the ids recorded at the start.
- **The runner's own guard:** inside the stack, it refused to run unless the cloud database carried the marker.

**Why the clients ran on the server:** the first attempt ran the test shop and browser on this PC, through SSH tunnels. It failed because this Wi-Fi cuts any SSH session after about 32 KB, so the first sync never arrived. All test clients therefore ran on the server, in a runner container on the `hmqa_qa` network:

- the test shop on throw-away databases in the QA database server;
- a real Chromium;
- a small proxy (`scripts/qa/proxy.js`) between the test shop and the QA cloud. It can pass traffic, add latency, cut the link (connections closed), or leave it half-open (connections open, nothing passing — a Wi-Fi drop the cloud is never told about).

## 3. Before testing

1. **Environment:** server 109.123.240.94 (4 CPU, 7.9 GB RAM, 88 GB free, load 0.07). Production containers were up, healthy, running v1.7.0 at schema 0039 with cloud migrations 0001–0005.
2. **Real use:** one store, `c32cf311-…`, linked 2026-11-14. It holds the owner's synchronised data, but no business is done on the website itself.
3. **Backup:** production was never written to, so no restore was needed. Its nightly encrypted backup continued as usual, and the update of 2026-11-14 had taken a full copy.
4. **Baseline (read-only):**
   - container ids, start times and images;
   - volumes and networks;
   - SHA-256 of `.env`, `Caddyfile` and `docker-compose.yml`;
   - store id, device-token fingerprint and epoch;
   - row counts;
   - a fingerprint of all 5,255 synced rows.
5. **Health:** the site answered `ok`; TLS certificate from Let's Encrypt.
6. **The owner's PC** took part in nothing: the test shops were throw-away services inside the test stack.
7. **Users:** synthetic only (`owner`, `manager2`, `cashier` with test passwords).

## 4. What ran on the test stack (all passed: 50 of 50)

| Phase      | Checks | Result                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pair`     |      2 | **Pairing:** a test shop with 10,003 products paired with a one-time code.<br>**First sync:** 22.9 s; both sides agree.                                                                                                                                                                                                                                                                                                    |
| `offline`  |      9 | **Real browser, 390 px phone, shop's link half-open:** the strip went connected → delayed (23 s) → offline (37 s), never "connected" after that.<br>**Work while away:** approval with a reservation in 25 ms, session kept; a barcode change and a purchase correction kept (202).<br>**Back:** both carried out once in 5.2 s, and both sides agree.<br>**Clean cut:** offline in 0.5 s.<br>**Reload:** shows the truth. |
| `restart`  |      2 | 200 invoices sent while the QA cloud container was restarted, and the shop's service restarted mid-way: all 200 on the cloud exactly once.                                                                                                                                                                                                                                                                                 |
| `perf` ×2  |    8+8 | No added latency, then 58 ms each way (the measured internet path).                                                                                                                                                                                                                                                                                                                                                        |
| `security` |     17 | Sessions, cookies, cross-site requests, size and path limits, one user against another's records, wrong-password limits.                                                                                                                                                                                                                                                                                                   |
| `soak`     |      1 | 20 minutes: 542 sales and 49 phone changes while the line dropped (half-open) and returned 9 times. Both sides identical (1,742 sales), nothing twice. Phone reads p50 7 ms, p99 14 ms.                                                                                                                                                                                                                                    |
| `ui`       |      3 | 31 screens at 360×740, 768×1024 and 1366×900: right-to-left, no sideways scroll, no script errors.                                                                                                                                                                                                                                                                                                                         |

**Load on production during the campaign:** sampled every 2 minutes during the soak. Production's cloud stayed at 144.7 MiB and its database at 57 MiB, with CPU under 1%. The QA cloud held 109–124 MiB, so no growth over 20 minutes.

**Defects found and fixed:** QA-02 to QA-05 and QA-01, in the QA certification report and DECISIONS D-114 and D-115. QA-02 (contact counted at the end of a dead request) was found while building the connection strip. QA-04 (time zone) was found in a screenshot from the `offline` phase.

## 5. Cleanup

1. **Guard passed;** the restart watcher stopped.
2. `docker compose -p hmqa --profile runner down -v --remove-orphans` removed the `hmqa` containers, the network `hmqa_qa` and the volume `hmqa_qadata`.
3. **Images removed:** `hmqa-cloud:pr53`, `hmqa-runner:pr53` and the Playwright base image.
4. **Files removed:** `/opt/hm-qa`, with its secrets, clone and results. Text results were copied out first.
5. **Check:** 0 `hmqa` containers, volumes, networks or images; port 18787 closed; no watcher process.
6. **Left in place:** Docker's shared build cache, shared with production builds and harmless. No test sync agent or test pairing can reconnect: the test shops' databases and the QA cloud no longer exist.

## 6. Production after cleanup (compared with the baseline)

| Check                                                                     | Result                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Container ids, images and start times                                     | identical: never restarted                                             |
| Volumes, networks                                                         | identical                                                              |
| `.env`, `Caddyfile`, `docker-compose.yml` (SHA-256)                       | identical                                                              |
| Store id, device-token fingerprint, epoch, pairing date; number of stores | identical: `c32cf311-…`, epoch 1, one store                            |
| Products, sales, synced rows, users, operations, schema                   | 3,130 / 110 / 5,255 / 4 / 31 / 0039: identical                         |
| Fingerprint of every synced row                                           | identical (`1ddc210c…`)                                                |
| Traces of test data (`QA` products, users, suppliers, categories, stores) | 0                                                                      |
| Operations waiting                                                        | 0                                                                      |
| Health, sign-in status, a request without a session                       | `ok`, 200, 401                                                         |
| HTTPS certificate                                                         | Let's Encrypt, valid until 2027-02-10                                  |
| The owner's PC                                                            | still linked, as before; last contact 01:15 (its PC off for the night) |

## 7. Readiness of the website for 1.8.0

- **Current state:** the production website runs 1.7.0 and is correctly linked to the owner's PC. It is not cleaned and must not be: the owner keeps his pairing.
- **When 1.8.0 is approved:** update the website first, with `update.sh v1.8.0`. Cloud migration 0006 and store migration 0040 apply in place, and the pairing is kept.
- **Between the two updates:** the owner's 1.7.0 PC is refused for its version, so nothing mixes, until it is updated. It keeps selling meanwhile, and the phone keeps working on the website's copy. Proven in the mixed-version test of the PR report.
- **Order and checks:** see the owner upgrade runbook in [BUSINESS_LOGIC_REPORT_1.8.0.md](BUSINESS_LOGIC_REPORT_1.8.0.md) §14.
