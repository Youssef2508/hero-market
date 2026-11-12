# Deploying the HeroMarket cloud

Written for whoever sets up the server (the developer, with the owner present for the keys). The owner's own steps are in [OWNER_CLOUD_GUIDE.md](OWNER_CLOUD_GUIDE.md). Design: [PHASE2_ARCHITECTURE.md](PHASE2_ARCHITECTURE.md); decisions D-101 to D-105 in [DECISIONS.md](DECISIONS.md).

**Run on the test server on 2026-11-12** (Contabo Cloud VPS 4, with made-up data). Every step that costs money or links the real shop needs the owner's approval first.

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

These are the commands run on the test server on 2026-11-12: Contabo Cloud VPS 4, Ubuntu 24.04, the `ubuntu` user with `sudo`, and an SSH key added at install time. Root cannot sign in by SSH there.

```bash
# SSH by key only. Contabo's cloud-init file (50-cloud-init.conf) turns password login back on; a
# file read before it decides (sshd keeps the first value it reads).
printf '%s\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin no' \
  | sudo tee /etc/ssh/sshd_config.d/10-heromarket.conf
sudo sshd -t && sudo systemctl reload ssh     # then check a NEW key login works before closing this one

# Updates, automatic security updates, and the firewall: SSH, HTTP and HTTPS only.
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get -y install ufw unattended-upgrades ca-certificates curl git
sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable

# Docker from Docker's own repository (https://docs.docker.com/engine/install/ubuntu/).
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
[ -f /var/run/reboot-required ] && sudo systemctl reboot
```

Docker publishes container ports past `ufw`; only `proxy` publishes any (80 and 443), so nothing else is reachable. Checked from outside: 5432 and 8787 are closed.

## 4. HeroMarket

```bash
sudo install -d -o ubuntu -g ubuntu /opt/heromarket
git clone https://github.com/Youssef2508/hero-market.git /opt/heromarket
cd /opt/heromarket && git checkout <the approved release tag>
cp deploy/cloud/cloud.env.example deploy/cloud/.env && chmod 600 deploy/cloud/.env
nano deploy/cloud/.env      # every value; generate the two secrets with the commands in the file
sudo docker compose -f deploy/cloud/docker-compose.yml up -d --build
sudo docker compose -f deploy/cloud/docker-compose.yml ps        # all four running, cloud "healthy"
curl -s https://<HEROMARKET_DOMAIN>/api/health                    # {"status":"ok",…}
```

Caddy obtains the certificate within seconds of the first start (port 80 must be reachable). Keep a copy of `HEROMARKET_SECRET` with the owner, apart from the server: a restore on a new server needs the same one.

## 5. Linking the shop

1. On the server: `sudo docker compose -f deploy/cloud/docker-compose.yml exec cloud node src/server/cli.js cloud-pair`. It prints a one-time code, valid 15 minutes.
2. On the shop PC, as an administrator: «المزامنة السحابية» → «ربط برمز»: the address `https://<HEROMARKET_DOMAIN>` and the code. The PC confirms the store's name and sends everything; the background service keeps the link from then on.
3. In the program, give «الدخول عبر الإنترنت» to the roles that may use the phone (administrators have it by default).

## 6. Backups and restore

- **Every night** at `BACKUP_HOUR` the `backup` container writes `heromarket-cloud-YYYYMMDD-HHMMSS.dump.age` and its `.sha256` into the `backups` volume, keeping `BACKUP_KEEP_DAYS` days. To make one copy now: `sudo docker compose -f deploy/cloud/docker-compose.yml run --rm -e BACKUP_NOW=1 backup`.
- **Off the server (recommended):** set `BACKUP_OFFSITE` and the `OFFSITE_*` values to an S3-compatible bucket (Cloudflare R2 or Backblaze B2 have free tiers). Use a key limited to that one bucket. Copies are already encrypted.
- **Restore** (rehearsed on the test server on 2026-11-12). The private key is brought in only for the restore. It is read from the terminal into a memory-only folder of a throwaway container, never written to the server's disk.

  ```bash
  cd /opt/heromarket; dc="sudo docker compose -f deploy/cloud/docker-compose.yml"
  $dc up -d db                                                  # on a new server: an empty database
  copy=/backups/heromarket-cloud-YYYYMMDD-HHMMSS.dump.age         # or put the copy into the backups volume first
  pw=$(grep ^POSTGRES_PASSWORD= deploy/cloud/.env | cut -d= -f2)
  sudo docker run --rm -i --network heromarket-cloud_inside -v heromarket-cloud_backups:/backups:ro \
    -v "$PWD/deploy/cloud/restore.sh:/restore.sh:ro" --tmpfs /key:size=1m --entrypoint bash heromarket-cloud-backup:local \
    -c "cat > /key/k.txt && bash /restore.sh $copy /key/k.txt postgres://heromarket:$pw@db:5432/heromarket" \
    < heromarket-backup-key.txt
  $dc up -d
  ```

  `restore.sh` checks the checksum and refuses a database that is not empty. In the rehearsal, the restored copy held the same users, records and database version as the live one, and a second restore over it was refused. The shop's link then brings the copy up to date.

  If no copy can be restored at all, the shop can rebuild the cloud from itself (a new cloud and a new pairing). Only work done on the phone while the shop was unreachable, and not yet received by the shop, would be lost.

## 7. Updating

The order and the reasons are in [PHASE2_ARCHITECTURE.md §14.1](PHASE2_ARCHITECTURE.md): **the cloud first, then the shop**, with the same release.

```bash
cd /opt/heromarket && sudo deploy/cloud/update.sh v1.6.0      # the approved release tag
```

`update.sh` does the following:

1. It stops the cloud service. Phones see "unreachable" for a minute or two.
2. It takes a plain copy for going back, kept on the server only (`deploy/cloud/pre-update`, root-only, the last three), and the owner's encrypted copy.
3. It builds and starts the release's image, tagged by version.
4. It waits until the image reports healthy.
5. If the image does not become healthy, the script puts the copy back, starts the previous image again and says so.

Then the owner runs the same release's installer on the shop PC. Until then, if the database version changed, the sync screen shows «تحديث مطلوب»: the cloud refuses the shop's link, and both sides keep working apart. Afterwards, both sides' work comes together by itself, with the same pairing. Phones with a page open reload by themselves at their next change of screen.

## 8. Security, in short

- HTTPS only; HSTS; no server banner; `X-Frame-Options: DENY`; `nosniff`; no referrer.
- Browser sessions in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie, never readable by page scripts.
- Sign-in limits (D-105): 5 failures per terminal, 20 per address, and 10 per typed username from any addresses (internet only), each followed by a pause. The service sees each visitor's real address through the proxy (`HEROMARKET_TRUST_PROXY`, the proxy's fixed address).
- Passwords: scrypt (N=2^14, r=8, p=5). PINs never leave the shop. Setup, first passwords and administrator recovery are refused from the internet.
- Each container runs without extra privileges, read-only where it can, with no published port but the proxy's.
