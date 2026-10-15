# Hosting cost estimate for the owner's cloud (October 2026)

Written for the owner, before approving any hosting.

**What has not been done:**

- No account or resource has been created.
- No payment detail has been asked for.
- Nothing will be created without your explicit approval.

Sources were checked on 2026-10-15. Each figure says where it comes from. Some of Google's pricing pages show their tables only in a browser, so a few figures could not be read from the official page; they are marked **not confirmed**. Check those in the provider's price calculator before approving.

## 1. What the cloud has to run (the exact configuration)

**Software:** one small Linux server running the HeroMarket cloud service (Node.js) and PostgreSQL.

**Load, which is small:**

- Synchronisation from one shop PC: a few MB per day. Our test pushed a busy week (3,200 changes) in under a second.
- The owner's browsing.

**Storage:**

- a few hundred MB per year of data;
- plus a nightly database copy kept on the same disk.

**Always on:** it must never sleep, pause or be reclaimed.

**Reachable only over HTTPS:**

- The shop PC connects out to it.
- Nothing in the shop is reachable from the internet.
- PostgreSQL is not exposed.

**Configuration for both options:**

- 1 server;
- 1 public IPv4 address;
- system disk ≥ 20 GB;
- nightly `pg_dump` kept on the server (7 days), plus the shop PC, which can rebuild the cloud completely at any time (D-047);
- provider's basic monitoring;
- HTTPS certificate from Let's Encrypt (free).

## 2. Option A – Google Cloud, free-tier e2-micro (US region)

| Item                      | Quantity                                              | Official price                                                                                                                                                                                                                                                                                               | Monthly cost                                   |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Compute: e2-micro         | 1 VM, all month, in us-central1 / us-west1 / us-east1 | Free tier: "One non-preemptible e2-micro VM instance per month" in those regions ([Google Cloud free features](https://docs.cloud.google.com/free/docs/free-cloud-features))                                                                                                                                 | **$0.00**                                      |
| Disk                      | 20–30 GB standard persistent disk                     | Free tier: "30 GB-months standard persistent disk" (same page)                                                                                                                                                                                                                                               | **$0.00**                                      |
| Public IPv4               | 1 address in use, 730 h                               | "External IP Charge on a Standard VM": **$0.005 per hour** since 1 Feb 2024 ([Google VPC pricing announcement](https://cloud.google.com/vpc/pricing-announce-external-ips)); the official page does not say the free tier covers it, so it is counted                                                        | **$3.65**                                      |
| Internet egress           | about 1–3 GB (sync answers + owner browsing)          | Free tier: "1 GB of outbound data transfer from North America" per month (free-tier page). Above that: Premium Tier about $0.12/GB – **not confirmed** on Google's page (reported by third-party calculators)                                                                                                | **$0.00–0.25**                                 |
| Backups                   | nightly `pg_dump` on the same disk                    | inside the 30 GB free disk                                                                                                                                                                                                                                                                                   | **$0.00**                                      |
| Disk snapshots (optional) | weekly, about 2 GB                                    | snapshot storage price **not confirmed** (Google's disk pricing page did not load its table); not needed, because the shop PC can rebuild the cloud                                                                                                                                                          | $0 if not used                                 |
| Monitoring and logging    | basic VM metrics, small logs                          | free: "all non-chargeable Google Cloud metrics", "first 50 GiB of log data per project per month" (free-tier page)                                                                                                                                                                                           | **$0.00**                                      |
| Subtotal                  |                                                       |                                                                                                                                                                                                                                                                                                              | **≈ $3.65–3.90**                               |
| Tax                       | Egypt                                                 | Google states it charges **14 % VAT** on digital services in Egypt ([Google support, taxes](https://support.google.com/a/topic/3722998)). That page is for Workspace; the Cloud-specific rule is **not confirmed** ([Cloud VAT overview](https://docs.cloud.google.com/billing/docs/resources/vat-overview)) | ≈ $0.51–0.55                                   |
| **Total**                 |                                                       |                                                                                                                                                                                                                                                                                                              | **≈ $4.15–4.45 per month (≈ $50–53 per year)** |

**Free-tier eligibility and limits**

- You need a Google Cloud **billing account, active and in good standing**, with your own card. You would create it yourself; this project will never ask for card details.
- The free VM must be an **e2-micro** in one of the three US regions. Any other size or region is billed in full.
- The limit is **time-based**: one e2-micro month per month, shared across those regions. A second VM is billed.
- Unused allowance does not roll over.

**When a limit is exceeded**

- On a paid billing account, the extra usage is **billed normally**: no warning stop, no sleep.
- During the $300 Free Trial, the trial credit pays first, and total usage is capped at that credit.
- To prevent surprises:
  - set a **budget alert** of, for example, $6/month (free);
  - keep a single VM;
  - keep the disk at 30 GB or less.

**Technical limits**

- **1 GB of RAM** is enough for this load with PostgreSQL tuned small, but it leaves little headroom.
- The servers are in the US, about 150–200 ms from Egypt. That is fine for synchronisation and for the owner's screens.

## 3. Option B – Hetzner Cloud CX23 (Germany or Finland)

| Item                          | Quantity                    | Official price                                                                                                                                                                                           | Monthly cost (excl. VAT)                 |
| ----------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Server CX23                   | 2 vCPU, 4 GB RAM, 40 GB SSD | **€5.49 / month** for new orders since 15 June 2026 ([Hetzner price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/))                                     | €5.49                                    |
| Primary IPv4                  | 1                           | **€0.50 / month**, "prices do not include VAT" ([Hetzner IP prices](https://docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing))                                                      | €0.50                                    |
| Traffic                       | far below the allowance     | 20 TB per month included in EU locations (reported in [comparisons](https://kimmo.suominen.com/stuff/cpc-2026-08.txt); **confirm** on Hetzner's price box)                                               | €0.00                                    |
| Automatic backups (optional)  | 7 backup slots              | percentage of the server price – **not confirmed** (Hetzner refers to its price box; commonly 20 %, about €1.10) ([Hetzner backups](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/)) | €0–1.10                                  |
| Nightly `pg_dump` on the disk | –                           | inside the 40 GB disk                                                                                                                                                                                    | €0.00                                    |
| Monitoring                    | basic graphs in the console | included                                                                                                                                                                                                 | €0.00                                    |
| **Total**                     |                             |                                                                                                                                                                                                          | **€5.99–7.09 / month (≈ €72–85 / year)** |

- **Tax:** prices exclude VAT. For a customer in Egypt, Egyptian VAT on imported digital services (14 %) may apply; **not confirmed** for Hetzner.
- **No free tier:** everything is billed monthly, by the hour, and with no overage surprise at this size.
- **Price changes:** Hetzner changed prices twice in 2026.

## 4. Comparison and recommendation

|                                   | Google Cloud e2-micro                               | Hetzner CX23                     |
| --------------------------------- | --------------------------------------------------- | -------------------------------- |
| Monthly cost (estimate, with VAT) | **≈ $4.2–4.5**                                      | ≈ €6.8–8.1 (if 14 % VAT applies) |
| RAM / CPU                         | 1 GB / shared                                       | 4 GB / 2 vCPU                    |
| Never sleeps or pauses            | yes (on a billing account)                          | yes                              |
| Surprise-bill risk                | low if the rules above are kept; alerts recommended | very low                         |
| Distance from Egypt               | US (~150–200 ms)                                    | Germany or Finland (~60–90 ms)   |

**Recommendation**

- **Primary: Google Cloud e2-micro.** It is the cheapest reliable option, at about $4–4.5 per month, mostly for the IPv4 address. Its free tier does not sleep or expire, and a budget alert makes the cost visible.
- **Fallback: Hetzner CX23.** Choose it if you prefer more memory headroom and a flat, predictable bill. It costs about €3 per month more.

Both run the same software. Moving between them later only needs a full re-send from the shop PC.

**Before approving, please:**

1. open each provider's price calculator and confirm the figures marked "not confirmed";
2. confirm how VAT will appear on your invoice in Egypt;
3. tell me which option to prepare. I will then write the step-by-step setup for **you** to perform: account, billing and card stay yours.

Phase 5 (the owner's web app with two-factor sign-in) starts only after that approval.
