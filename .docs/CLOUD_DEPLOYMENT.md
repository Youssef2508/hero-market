# Deploying the HeroMarket cloud

Written for whoever sets up the server (the developer, with the owner present for the keys). The owner's own steps are in [OWNER_CLOUD_GUIDE.md](OWNER_CLOUD_GUIDE.md). Design: [PHASE2_ARCHITECTURE.md](PHASE2_ARCHITECTURE.md); decisions D-101 to D-105 in [DECISIONS.md](DECISIONS.md).

**Nothing here has been run on a real server yet.** Every step needs the owner's approval first: buying the server, the domain, any storage account, and the first deployment.

## 1. What runs

One small Linux server holds the cloud: a copy of one store that phones reach over HTTPS. The shop PC stays the store; its background service keeps the link to this server.

| Container | What it is                                                                                   | Reachable from the internet |
| --------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| `proxy`   | Caddy: HTTPS with a Let's Encrypt certificate it obtains and renews itself; security headers | Yes: ports 443 and 80       |
| `cloud`   | The HeroMarket service in its cloud role and the browser screens (`Dockerfile.cloud`)        | No, only through `proxy`    |
| `db`      | PostgreSQL 17, the cloud's copy of the store                                                 | No                          |
| `backup`  | An encrypted copy of `db` every night, readable only with the owner's private key            | No                          |

Files: [`deploy/cloud/docker-compose.yml`](../deploy/cloud/docker-compose.yml), [`Caddyfile`](../deploy/cloud/Caddyfile), [`backup.sh`](../deploy/cloud/backup.sh), [`restore.sh`](../deploy/cloud/restore.sh), [`cloud.env.example`](../deploy/cloud/cloud.env.example).

## 2. Before the server

1. **The server** (recommended: OVHcloud VPS-1, about $4.5–5.2 a month; see the architecture's hosting section). Ubuntu 24.04 LTS. The owner buys it in their own account; nobody types a card number or account password into a chat.
2. **A name for it.** Either a domain the owner buys (about $1 a month) or a free name (for example DuckDNS). Point its A record at the server's IPv4 address.
3. **The backup key**, made on the owner's computer, never on the server:

   ```
   age-keygen -o heromarket-backup-key.txt
   ```

   The file holds the private key: keep two copies offline (for example two USB sticks in different places). Its first line shows the public key (`age1…`), which goes on the server.

## 3. The server

As root on a fresh Ubuntu 24.04 server:

```bash
# Updates and the firewall: SSH, HTTP and HTTPS only.
apt update && apt -y upgrade
apt -y install ufw unattended-upgrades
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# Docker from Docker's own repository (https://docs.docker.com/engine/install/ubuntu/).
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt update && apt -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin

# SSH by key only (after copying your public key to ~/.ssh/authorized_keys and testing it).
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl reload ssh
```

Docker publishes container ports past `ufw`; only `proxy` publishes any (80 and 443), so nothing else is reachable.

## 4. HeroMarket

```bash
git clone https://github.com/Youssef2508/hero-market.git /opt/heromarket
cd /opt/heromarket && git checkout <the approved release tag>
cp deploy/cloud/cloud.env.example deploy/cloud/.env && chmod 600 deploy/cloud/.env
nano deploy/cloud/.env      # every value; generate the two secrets with the commands in the file
docker compose -f deploy/cloud/docker-compose.yml up -d --build
docker compose -f deploy/cloud/docker-compose.yml ps        # all four "running", cloud "healthy"
curl -s https://<HEROMARKET_DOMAIN>/api/health               # {"ok":true,…}
```

Keep a copy of `HEROMARKET_SECRET` with the owner, apart from the server: a restore on a new server needs the same one.

## 5. Linking the shop

1. On the server: `docker compose -f deploy/cloud/docker-compose.yml exec cloud node src/server/cli.js cloud-pair`. It prints a one-time code, valid 15 minutes.
2. On the shop PC, as an administrator: «المزامنة السحابية» → «ربط برمز»: the address `https://<HEROMARKET_DOMAIN>` and the code. The PC confirms the store's name and sends everything; the background service keeps the link from then on.
3. In the program, give «الدخول عبر الإنترنت» to the roles that may use the phone (administrators have it by default).

## 6. Backups and restore

- Every night at `BACKUP_HOUR` the `backup` container writes `heromarket-cloud-YYYYMMDD-HHMM.dump.age` and its `.sha256` into the `backups` volume, keeping `BACKUP_KEEP_DAYS` days. One copy now: `docker compose -f deploy/cloud/docker-compose.yml exec -e BACKUP_NOW=1 backup bash /backup/backup.sh`.
- **Off the server (recommended):** set `BACKUP_OFFSITE` and the `OFFSITE_*` values to an S3-compatible bucket (Cloudflare R2 or Backblaze B2 have free tiers). Use a key limited to that one bucket. Copies are already encrypted.
- **Restore** (a lost or broken server): on a machine with the private key, Docker and the copy:

  ```bash
  docker compose -f deploy/cloud/docker-compose.yml up -d db        # an empty database
  docker compose -f deploy/cloud/docker-compose.yml run --rm -v "$PWD:/work" --entrypoint bash backup \
    /backup/restore.sh /work/<copy>.dump.age /work/heromarket-backup-key.txt postgres://heromarket:<password>@db:5432/heromarket
  docker compose -f deploy/cloud/docker-compose.yml up -d
  ```

  `restore.sh` checks the checksum and refuses a database that is not empty. The shop's link then brings the copy up to date. If no copy can be restored at all, the shop can rebuild the cloud from itself (a new cloud and a new pairing): only work done on the phone while the shop was unreachable and not yet received by the shop would be lost.

## 7. Updating

```bash
cd /opt/heromarket && git fetch --tags && git checkout <new approved tag>
docker compose -f deploy/cloud/docker-compose.yml exec -e BACKUP_NOW=1 backup bash /backup/backup.sh
docker compose -f deploy/cloud/docker-compose.yml up -d --build
```

The cloud applies its own database changes at start. Update the shop PC to the same version first: the cloud refuses to link a shop on an older schema.

## 8. Security, in short

- HTTPS only; HSTS; no server banner; `X-Frame-Options: DENY`; `nosniff`; no referrer.
- Browser sessions in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie, never readable by page scripts.
- Sign-in limits (D-105): 5 failures per terminal, 20 per address, and 10 per typed username from any addresses (internet only), each followed by a pause. The service sees each visitor's real address through the proxy (`HEROMARKET_TRUST_PROXY`, the proxy's fixed address).
- Passwords: scrypt (N=2^14, r=8, p=5). PINs never leave the shop. Setup, first passwords and administrator recovery are refused from the internet.
- Each container runs without extra privileges, read-only where it can, with no published port but the proxy's.
