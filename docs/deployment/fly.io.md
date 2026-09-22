# Production deployment on Fly.io

Fly.io is a good fit for Baguette when you want managed infrastructure with pay-per-use billing. Machines start automatically on the first request and stop when idle.

## How Docker works on Fly.io

Fly.io machines are **Firecracker VMs**, not containers running on a shared host. This means:

- There is no host Docker socket to mount — unlike the Kamal/VPS setup where `/var/run/docker.sock` is bind-mounted from the host.
- Because the machine is a full VM, you **can** run the Docker daemon (`dockerd`) directly inside it. Baguette's entrypoint detects the missing socket and starts `dockerd` automatically.
- Docker-compose services defined in `.baguette.yaml` will work normally; they run as containers inside the Fly VM.

## Prerequisites

- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) installed and authenticated (`fly auth login`)
- A [GitHub App](https://github.com/settings/apps)
- An Anthropic API key

## 1. Configure fly.toml

Copy the example config and fill in your app name and region:

```bash
cp fly.toml.example fly.toml
```

Edit `fly.toml`:

- Set `app` to your chosen app name (used as the fly.dev subdomain).
- Set `primary_region` to the region closest to you (`fly platform regions` lists all options).
- Choose a **start/stop strategy** (both options are documented in the file):
  - **Auto stop/start** (default) — machine stops when idle, wakes on the next request (~1–3s cold start). Cheapest option; active Claude sessions will be interrupted if the machine stops.
  - **Always on** — machine runs continuously. No cold starts, no interrupted sessions. Higher cost.

`fly.toml` is gitignored so your app name stays out of the repository.

## 2. Create the Fly app

```bash
fly apps create your-app-name
```

Use the same name you put in `fly.toml`.

## 3. Create a persistent volume

Baguette stores its SQLite database, cloned repos, and git worktrees on a volume mounted at `/data`:

```bash
fly volumes create baguette_data --size 10 --region iad
```

Adjust `--region` to match `primary_region` in `fly.toml`. The volume is attached to a single machine, so avoid scaling to multiple machines without a shared storage strategy.

## 4. GitHub App

Create a GitHub App at [github.com/settings/apps](https://github.com/settings/apps), with the permissions and options listed in [Setting up the GitHub App](../../README.md#setting-up-the-github-app).

With the default Fly.io domain:

- **Homepage URL**: `https://your-app-name.fly.dev`
- **Callback URL** and **Setup URL**: `https://your-app-name.fly.dev/auth/github/callback`

With a custom domain:

- **Homepage URL**: `https://www.your-domain.com`
- **Callback URL** and **Setup URL**: `https://www.your-domain.com/auth/github/callback`

## 5. Set secrets

```bash
fly secrets set \
  AUTH_GITHUB_CLIENT_ID=your_client_id \
  AUTH_GITHUB_CLIENT_SECRET=your_client_secret \
  AUTH_GITHUB_APP_SLUG=your-app-slug \
  ENCRYPTION_KEY=$(openssl rand -hex 32) \
  PUBLIC_HOST=https://your-app-name.fly.dev
```

`PUBLIC_HOST` must be the full URL users will reach Baguette at (including `https://`). Update it if you later add a custom domain.

## 6. Wildcard DNS and TLS

Baguette uses wildcard subdomains for session preview URLs (`session-<id>.your-domain.com`). On Fly.io this requires a custom domain.

**Point your DNS at Fly** — a single wildcard record covers both the main UI (`www.your-domain.com`) and session previews:

```
*.your-domain.com    A / CNAME  →  (fly assigns IPs — see: fly ips list)
```

**Issue a wildcard certificate:**

```bash
fly certs add "*.your-domain.com"
```

Fly.io issues the certificate via Let's Encrypt using DNS validation. Follow the instructions printed by `fly certs add` to add the required DNS TXT records. Then update the `PUBLIC_HOST` secret to `https://www.your-domain.com`.

> **Skip wildcard if not needed:** If you only need the main UI and don't need session preview subdomains, a single non-wildcard domain is sufficient. Set `PUBLIC_HOST` to that URL and session previews will show a "no subdomain routing" notice instead of a live preview.

## 7. Deploy

```bash
fly deploy
```

On first boot the entrypoint starts `dockerd`, runs database migrations, then launches the Node server. The health check at `/up` gates traffic until the server is ready.

## Cold starts in practice

With `auto_stop_machines = "stop"`, the cold start (~1–3s) only happens when the **first** request arrives after the machine has been idle. In practice this is rare: as long as any browser tab has the Baguette UI open, the active WebSocket connection keeps the machine running. The machine only stops after all tabs are closed and the idle timeout elapses.

## VM sizing

Adjust `memory` and `cpus` in `fly.toml` if you run memory-intensive dev services or many concurrent sessions. Fly machines are billed per second of runtime, so `min_machines_running = 0` keeps costs near zero when idle.
