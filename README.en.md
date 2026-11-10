[🇷🇺 Русский](README.md) | [🇬🇧 English](README.en.md)

---

<div align="center">

# ◈ VertaFlux

**v1.19.0** — Universal control panel for a personal proxy server on Ubuntu or Debian

![VertaFlux — one control plane, multiple routes](docs/assets/vertaflux-banner.svg)

[![GitHub](https://img.shields.io/badge/GitHub-arivano81-181717?logo=github)](https://github.com/arivano81/Panel-Naive-Mieru)
[![CI](https://github.com/arivano81/Panel-Naive-Mieru/actions/workflows/ci.yml/badge.svg)](https://github.com/arivano81/Panel-Naive-Mieru/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-blue?color=248cff)](LICENSE)

VertaFlux brings NaiveProxy, Mieru, Hysteria2, VLESS, and experimental OpenFlux
into one approachable interface: one gateway, multiple access technologies, and
one user lifecycle.

</div>

---

## 🌿 About the project

VertaFlux is maintained independently. Changes are released and tested in this repository.
Use [`arivano81/Panel-Naive-Mieru`](https://github.com/arivano81/Panel-Naive-Mieru) for installation
and updates.

Because this repository is private, unattended updates require a fine-grained
GitHub token with **Contents: Read** permission only. Pass it as
`PANEL_GITHUB_TOKEN`; the installer/updater never prints or stores the token.

Project additions include:

- a first-run wizard after the initial login that explains protocol boundaries,
  shows the main, panel and subscription addresses, and highlights TOTP plus encrypted backups;
- **Debian 13** installation support;
- a protected post-installation report containing the panel address and administrator details;
- an access recovery utility for lost panel credentials;
- safe updates with `--doctor`, validated backups, `--rollback`, and automatic
  recovery when a new configuration fails its health check;
- clear documentation for the main, panel, and subscription DNS names;
- ongoing protocol and reliability improvements.

Read the changelog and make a backup before updating a production server.

---

## ✨ Features

| Sprint | Feature |
|--------|---------|
| 1 | Auto-installer: arch detection (**amd64 only**), caddy-forwardproxy-naive, Mieru .deb, systemd, NTP, UFW, config.json |
| 2 | User CRUD: SQLite, atomic Caddyfile + Mieru config rebuild on every change, expiry cron |
| 3 | Server settings: port changes, traffic-pattern presets, MTU, UFW auto-update |
| 4 | Client configs: Naive link, Mieru sing-box JSON, universal auto-fallback config, QR codes |
| 5 | Monitoring dashboard: WebSocket live metrics, traffic snapshots, quota alerts |
| 6 | `update.sh`: `--dry-run`, `--force`, `--panel-only`, `--expose`, `--ssh-only`, `--status`, `--doctor`, `--rollback`, `--repair`, `--help` |
| 7 | **Cascade / Relay** (v1.2.6): `client → Entry (RU) → Exit (EU) → internet`; Naive uses HTTPS upstream, while Mieru and Hy2 use the transparent Mieru relay. |
| 8 | **Optional Hysteria2** (v1.8.x): installed by the administrator from Settings (`auth: userpass`, systemd, per-user traffic, cascade), then enabled for selected users. |
| 9 | **One "smart" Sub-link** (v1.8.7–1.8.8): a single `/sub/:token` link with client auto-detection by User-Agent. **Shadowrocket** gets a base64 URI list (Naive → native HTTPS scheme, Mieru `mierus://`, Hy2 `hysteria2://`), **Karing** gets sing-box JSON. Passes expiry & traffic via the `Subscription-Userinfo` header. ✅ **Verified on Karing and Shadowrocket.** |

---

## 🖥 Supported OS

| Distro | Versions |
|--------|----------|
| Ubuntu | 20.04, 22.04, 24.04 |
| Debian | 11, 12, 13 |

**Architecture:** `x86_64` (amd64) — **only** *(caddy-forwardproxy-naive supports amd64 only)*  
> ⚠️ ARM64 and ARMv7 are **not supported** in v1.2.3 — the installer will exit with a clear error message.

---

## 🚀 Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/arivano81/Panel-Naive-Mieru.git
cd Panel-Naive-Mieru

# 2. Run the installer as root
sudo bash install.sh
```

The wizard will prompt you for:
- Language (Russian / English) — **first question**
- Domain / hostname
- TLS email (Caddy manages certificates automatically via TLS-ALPN-01)
- NaiveProxy port (default: `443`)
- Mieru port range (default: `2012-2022`)
- Fake site URL (default: `https://www.example.com`)
- Probe secret (default: auto-generated)
- Panel admin credentials
- UFW firewall setup (optional)
- Panel expose mode (SSH-only vs public)

---

## 🔒 Accessing the Panel

### SSH-only (default, most secure)
```bash
# From your local machine:
ssh -L 3000:127.0.0.1:3000 root@<your-server-ip>
# Then open: http://localhost:3000/
```

### Public mode
```bash
sudo bash update.sh --expose panel.example.com
# Panel available at: https://panel.example.com/<secret-webBasePath>/
# TLS and HTTP Basic Auth are handled by caddy-naive.
```

Return to SSH-only access with `sudo bash update.sh --ssh-only`. Public mode always keeps
the panel process bound to loopback; Caddy exposes only the secret path behind TLS and HTTP
Basic Auth, while the domain root serves a neutral stub.

---

## 🧭 Panel Operations Guide

### First login and administrator security

Read `/root/vertaflux-install-report.txt` for the generated address and credentials. The first-run
wizard shows the VPN, panel, and subscription domains and reminds you to configure TOTP and an
encrypted backup. **Settings → Two-factor authentication** accepts any standard TOTP app. A secret
is activated only after the first valid code; disabling it requires the current password and code.

Every authenticated mutation is recorded in **Logs → Audit** without request bodies, passwords,
tokens, or query strings. Login, subscriptions, federation, backup secrets, and OpenFlux secret
exports have separate rate limits. Sessions rotate after login and password changes, and all
browser mutations carry a session-bound CSRF token.

### Server settings and adaptive tuning

Check the primary VPN domain, Naive port, Mieru range, panel domain, subscription URL, and server
label in **Settings**. A domain or port change requires newly downloaded client profiles.

NaiveProxy/Caddy, Mieru, Hysteria2, and Xray use one safe tuning workflow:

`measure → recommend → preview diff → confirm → validate → apply one service → health check → rollback`

Recommendations are editable and stored in a bounded, secret-free history. Applying one protocol
does not restart unrelated VPN services. Hysteria2 remains opt-in and is installed from Settings;
existing users receive it only when the administrator enables the protocol for them.

### VLESS REALITY and XHTTP

VLESS is an optional Xray component on its own port. Install it from **Settings → VLESS / Xray**,
then enable VLESS per user. Each user receives an independent UUID; the REALITY private key never
leaves the server. The production REALITY target must be the server's own primary domain, whose
local certificate is checked before activation—popular third-party camouflage targets are rejected.

XHTTP is a separate opt-in profile: Caddy terminates public TLS on a secret path and forwards h2c
to a loopback-only Xray inbound. REALITY and XHTTP links are generated separately. Configuration
changes validate candidates and roll both Caddy and Xray back together on failure.

For an emergency REALITY target correction without touching NaiveProxy, run:

```bash
bash panel/scripts/reconfigure_xray_reality.sh --check <primary-domain>
bash panel/scripts/reconfigure_xray_reality.sh <primary-domain>
```

The script preserves keys and UUIDs, restarts only Xray, and verifies that the Caddy/Naive PID did
not change.

### Experimental OpenFlux

OpenFlux is deliberately isolated from shared users, subscriptions, Caddy, Mieru, Hysteria2, and
Xray. Installation does not create a profile, open a port, or start a service. Each explicit profile
has its own key, port, hardened systemd unit, firewall rule, and root-only client bundle. Use the
separate **OpenFlux Experimental** page; key rotation invalidates the previous bundle. It is not a
stable replacement for the primary protocols.

### Users and client delivery

Create a user, choose only the protocols installed on the server, then use **Config** to export a
Naive link, Mieru JSON/link, Hysteria2 URI, VLESS REALITY/XHTTP URI, universal sing-box JSON, QR,
or one smart subscription URL. Expiry and quota suspension apply to all managed protocols without
deleting the user. The **Clients** page distinguishes real E2E tunnel evidence from format-only and
experimental compatibility.

### Monitoring, diagnostics, and federation

The dashboard and Monitoring page report service state, ports, traffic, and quotas. **Diagnostics**
is read-only and includes service/config health, time synchronization, public A/AAAA records,
server-IP matching, and TLS certificate identity/lifetime for the VPN, panel, and subscription
domains. The downloadable report uses a strict allowlist and contains no credentials or raw logs.

The **Client connection check** selects one user and classifies expiry/quota, identity presence,
DNS/TLS, listener, and service readiness for each enabled protocol without returning a password or
UUID. REALITY and XHTTP are reported independently. A green result proves server-side readiness;
the final connection test still belongs on the target client device.

Federation can provision or revoke the same email across explicitly configured nodes. Every node
has its own bearer token and local passwords; one node never receives another node's password.
Peer failures are isolated and reported per node instead of breaking the local subscription.

### Maintenance, backup, restore, and access recovery

Enable **Settings → Maintenance mode** before risky work. It locks configuration and federation
mutations after password confirmation but leaves VPN traffic, status, diagnostics, encrypted backup
export, logout, and the recovery toggle available.

Before domain, port, or VPN identity changes, the panel writes a validated portable snapshot to
`/etc/vertaflux/backups/operations/` (`0700` directory, `0600` files, last 20 retained). If the
snapshot cannot be written, the mutation does not start. Manual exports use AES-256-GCM with scrypt
and require both the administrator password and a separate backup passphrase. A clean installation
can inspect and restore the encrypted file while either preserving backup network identity or the
current server's domains and ports.

If panel credentials or TOTP are lost, run:

```bash
sudo bash /opt/panel-naive-mieru/scripts/recover_access.sh
```

The root-only recovery flow resets the panel password and disables the lost TOTP factor without
changing VPN user credentials.

---

## 📁 Important Paths

| Path | Purpose |
|------|---------|
| `/etc/vertaflux/config.json` | Panel configuration |
| `/etc/vertaflux/version` | Installed version |
| `/etc/vertaflux/backups/` | Timestamped backups (last 10 kept) |
| `/etc/vertaflux/backups/operations/` | Automatic pre-change portable snapshots (last 20) |
| `/etc/caddy-naive/Caddyfile` | Caddy forwardproxy config (`basic_auth` users + probe resistance) |
| `/etc/caddy-naive/probe_secret` | Probe resistance secret token |
| `/var/www/fake-site/` | Fake site (shown to unrecognised clients) |
| `/var/log/caddy-naive/access.log` | caddy-naive access log |
| `/var/lib/vertaflux/mita-state.json` | Mieru JSON state (applied via `mita apply config`) |
| `/var/lib/vertaflux/db.sqlite` | SQLite user database |
| `/opt/panel-naive-mieru/` | Panel application files |
| `/usr/local/bin/caddy-naive` | caddy-forwardproxy-naive binary |
| `/etc/xray/config.json` | Managed Xray/VLESS configuration (when installed) |
| `/etc/openflux/` | Isolated experimental OpenFlux state (when installed) |

Servers upgraded from older releases retain compatibility symlinks for rollback. A clean
installation creates only the canonical VertaFlux paths.

> ⚠️ **Note:** `/etc/mita/` is Mieru's internal protobuf store — **never edit manually**.  
> The panel uses `/var/lib/vertaflux/mita-state.json` and applies it via `mita apply config <file>`.

> 🔐 **Security Warning (Bug 45):** The panel stores **plaintext passwords** for NaiveProxy users  
> in SQLite (`/var/lib/vertaflux/db.sqlite`). This is required because `caddy-forwardproxy-naive`
> hashes passwords internally at startup and needs the original plaintext. **Protect the database  
> file:** it is already mode `600 root:root`, but ensure your VPS is not compromised. Do **not**  
> reuse VPN passwords on other services.

---

## 🔧 Key Commands

```bash
# Service management
systemctl status caddy-naive mita
systemctl restart caddy-naive
systemctl restart mita

# Panel (PM2)
pm2 logs panel-naive-mieru
pm2 restart panel-naive-mieru
pm2 status

# Mieru
mita status
mita describe users
mita describe config
mita apply config /var/lib/vertaflux/mita-state.json
mita reload

# Caddy
caddy-naive validate --config /etc/caddy-naive/Caddyfile --adapter caddyfile
caddy-naive reload  --config /etc/caddy-naive/Caddyfile --adapter caddyfile

# Panel management
bash update.sh --status    # Health check
bash update.sh --repair    # Fix broken install
sudo bash uninstall.sh     # Full removal
```

---

## 📱 Client Applications

The panel now has a dedicated **Clients** page with an evidence-based compatibility matrix.
**E2E** means a real tunnel test, **FORMAT** means subscription routing and configuration shape
were checked without guaranteeing a connection in every app release, and **EXPERIMENTAL** is a
separate profile outside the shared subscription. Karing, NekoBox, Exclave, and Throne receive
sing-box JSON; Shadowrocket receives base64 URIs. OpenFlux remains a separate root-only bundle.

### NaiveProxy
Link format: `naive+https://username:password@domain:443`

| Client | Platform |
|--------|----------|
| [ShadowRocket](https://apps.apple.com/app/shadowrocket/id932747118) | iOS |
| [Karing](https://github.com/KaringX/karing/releases) | iOS / Android / Windows / macOS / Linux |
| [NekoBox](https://github.com/MatsuriDayo/NekoBoxForAndroid) | Android |
| [naiveproxy](https://github.com/klzgrad/naiveproxy/releases) | CLI |

### Mieru (sing-box)
Download the **Mieru JSON** or **Universal Config** from the Users page.

| Client | Platform |
|--------|----------|
| [Karing](https://github.com/KaringX/karing/releases) | iOS / Android / Windows / macOS / Linux |
| [Sing-box](https://apps.apple.com/app/sing-box/id6451272673) | iOS |
| [Sing-box](https://github.com/SagerNet/sing-box/releases) | Android / Windows / Linux / macOS |

### Hysteria2
Installed explicitly by the administrator from **Settings** and then enabled for selected users as
a third shared-pool protocol. Link format: `hysteria2://username:password@domain:443?sni=domain&insecure=0#username`.

| Client | Platform |
|--------|----------|
| [ShadowRocket](https://apps.apple.com/app/shadowrocket/id932747118) | iOS |
| [Karing](https://github.com/KaringX/karing/releases) | iOS / Android / Windows / macOS / Linux |
| [Hysteria](https://github.com/apernet/hysteria/releases) | CLI |

> ℹ️ The server uses `auth: userpass`, so the on-the-wire password is the pair `username:password`. For sing-box clients (Karing) the panel injects it into the `password` field automatically — sing-box has no separate username field.

### 🔗 Sub-link (one "smart" subscription) — v1.8.7–1.8.8
Click **"Sub-link"** on the user card to copy a single link like
`https://sub.<domain>/sub/<token>`. It **auto-detects the client** by User-Agent and serves the right format:

| Client | Format | Protocols |
|--------|--------|-----------|
| **Shadowrocket** | base64 URI list | Naive (native HTTPS scheme), Mieru (`mierus://`), Hysteria2 (`hysteria2://`) |
| **Karing** | sing-box JSON | Naive, Mieru, Hysteria2 (as JSON outbounds with `urltest`) |

- The link passes **expiry and traffic** to the client via the `Subscription-Userinfo` header.
- Manual format override: `?client=shadowrocket` / `?client=karing` or `?format=singbox`.
- A dedicated `sub.<domain>` subdomain is set in Settings — Caddy provisions the TLS certificate automatically.
- ✅ **Verified on real devices in Karing and Shadowrocket** — all three protocols connect.

### Universal Config (urltest auto-fallback)
Contains all enabled protocols (NaiveProxy + Mieru + Hysteria2) with `urltest` selector — automatically uses the faster connection.

---

## 🏗 Architecture

```
Client connections                              VPS

NaiveProxy ── TCP/TLS ────────────────────────▶ caddy-naive ───────▶ Internet
Mieru      ── TCP/UDP, ports 2012–2022 ───────▶ mita ──────────────▶ Internet
Hysteria2  ── UDP/QUIC, usually port 443 ─────▶ hysteria-server ──▶ Internet

Administration

panel.example.com/secret-path ── TLS + Basic Auth ──▶ caddy-naive
                                                               │
                                                               ▼
                                                  Node.js + Express + PM2
                                                  127.0.0.1:3000
                                                  REST API + WebSocket
                                                               │
                                                               ▼
                                                  SQLite + service configs

Subscriptions

sub.example.com/sub/TOKEN ── TLS ──▶ caddy-naive ──▶ panel ──▶ client config
```

---

## 🌐 Cascade / Relay (v1.2.6)

Configure a two-hop chain directly from the panel (**Settings → Cascade**):

```
Naive client
    │
    ▼
Entry: caddy-naive ── HTTPS upstream ──▶ Exit: caddy-naive ──▶ Internet

Mieru client
    │
    ▼
Entry: mita ── iptables ──▶ redsocks ──▶ mieru-client ── Mieru ──▶ Exit: mita ──▶ Internet

Hysteria2 client
    │
    ▼
Entry: hysteria-server ── iptables ──▶ redsocks ──▶ mieru-client ── Mieru ──▶ Exit: mita ──▶ Internet
```

### What happens under the hood

- **NaiveProxy** — the `Caddyfile` gets an `upstream https://user:pass@exit-host:443` directive inside the `forward_proxy` block. Client traffic is forwarded to the Exit node before reaching the internet.
- **Mieru and Hysteria2** — `iptables` selects traffic owned by the `mita` and `hysteria` service users. `redsocks` redirects it to a local SOCKS5 listener, and `mieru-client` carries it to the Exit node's `mita` service. The Exit address is excluded from redirection to prevent a loop.

### UI controls

1. Open **Settings → Cascade**.
2. Tick **«Enable cascade»**.
3. Fill in:
   - **Naive upstream URL** — `https://user:password@exit.example.com:443`
   - **Mieru Exit host** — IP or domain of the Exit node
   - **Mieru Exit port range** — the Exit node's Mieru range (usually `2012–2022`)
   - **Mieru Exit user / password** — credentials of a user created on the Exit panel
4. Press **Apply cascade**. The panel updates the Naive upstream and starts or stops the transparent Mieru relay.
5. Use **Check status** to verify the relay units, iptables chain, and current egress IP.

> 💡 You can toggle cascade on/off without erasing settings — just untick the checkbox and press **Apply**.

---

## 🔄 update.sh Reference

```bash
bash update.sh                   # Interactive update
bash update.sh --dry-run         # Preview changes (no writes)
bash update.sh --force -y        # Force update, non-interactive
bash update.sh --panel-only -y   # Update UI/API and PM2; do not restart VPN services
bash update.sh --status          # Full health report
bash update.sh --doctor          # Read-only diagnostics with monitoring exit status
bash update.sh --rollback        # Restore the latest validated update snapshot
bash update.sh --rollback <ID>   # Restore a snapshot selected from --status
bash update.sh --repair          # Restore broken configs from backup
bash update.sh --expose <domain> # Switch to public panel mode
bash update.sh --ssh-only        # Revert to SSH-only mode
bash update.sh --help            # Show help
```

For this private repository, provide a fine-grained `PANEL_GITHUB_TOKEN` with **Contents: Read**
only. The token is not printed or persisted. `--panel-only` verifies that every proxy PID remains
unchanged before reporting success. Binary upgrades are performed one component at a time and only
after confirming that the selected VPN service may be interrupted; unrelated services are never an
implicit part of that permission.

The panel's **Settings → About** update indicator is read-only: it compares `VERSION` with `main`,
caches the result for six hours, and never installs anything automatically. Release archives,
checksums, SPDX SBOM, and Sigstore bundles are documented in [docs/supply-chain.md](docs/supply-chain.md).

The **Diagnostics → DNS and TLS** section checks the public A/AAAA records for the VPN,
panel, and subscription domains, verifies that they include the configured server IP,
and validates the certificate name and remaining lifetime. The check is read-only and
is included in the downloadable safe diagnostics report.

---

## 🗑 Uninstall

```bash
# Full removal (including configs and database)
sudo bash uninstall.sh
```

---

## 🛡 Security Notes

- Panel runs on `127.0.0.1:3000` — not exposed to the internet by default
- Admin password is bcrypt-hashed in `config.json` (chmod 600)
- SQLite DB in `/var/lib/vertaflux/` (root access only)
- **Probe resistance**: unrecognised clients see the fake site instead of a proxy error
- **No certbot**: Caddy manages TLS automatically via TLS-ALPN-01 (port 80 not needed)
- Temporary config files deleted with `shred -u`
- Login rate limiting: 20 req / 15 min
- Session cookies are `httpOnly`
- Optional TOTP, session rotation, CSRF protection, and bounded administrator audit log
- Encrypted backup export uses AES-256-GCM with scrypt and password re-authentication
- Maintenance mode fails closed for configuration mutations without stopping VPN traffic
- Sensitive runtime/install logs redact passwords, tokens, UUIDs, private keys, and subscription URLs

---

## 🔧 Troubleshooting

### Top 5 Common Issues

**1. Time sync error (Mieru won't connect)**
```bash
timedatectl status
timedatectl set-ntp true
# Mieru requires accuracy ±30 seconds between client and server
```

**2. Port conflict**
```bash
ss -tlnup | grep -E '443|2012'
# Check if port is occupied by another process
```

**3. mita fails to start**
```bash
journalctl -u mita -n 50
mita status
# Check /var/lib/vertaflux/mita-state.json for valid JSON
mita apply config /var/lib/vertaflux/mita-state.json
```

**4. Caddy TLS certificate issues**
```bash
journalctl -u caddy-naive -n 50
caddy-naive validate --config /etc/caddy-naive/Caddyfile --adapter caddyfile
# Ensure domain points to server IP and port 443 is open
```

**5. Client connectivity checklist**
```bash
# 1. Can you ping the domain from the client device?
# 2. Is time synchronized on both devices?
# 3. Are ports open in UFW?
ufw status
# 4. Did you download new config after any port change?
# 5. Using correct client? (ShadowRocket / Karing / Sing-box)
```

---

## 📋 Tech Stack

- **Installer:** Bash (Ubuntu 20.04–24.04, Debian 11–13)
- **Panel:** Node.js 20 LTS + Express + better-sqlite3 + WebSocket
- **Process manager:** PM2
- **NaiveProxy:** caddy-naive (Caddy + forward_proxy plugin)
- **Mieru:** mita (managed via `mita apply config`)
- **Firewall:** UFW
- **Database:** SQLite (WAL mode)

---

## 📝 Credits

- **Project:** VertaFlux (`arivano81/Panel-Naive-Mieru`)
- **NaiveProxy:** [klzgrad/naiveproxy](https://github.com/klzgrad/naiveproxy)
- **Mieru:** [enfein/mieru](https://github.com/enfein/mieru)
- **Caddy:** [caddyserver.com](https://caddyserver.com)
- **Karing:** [KaringX/karing](https://github.com/KaringX/karing)
