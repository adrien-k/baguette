# Production deployment with Kamal

This repository ships with a [Kamal](https://kamal-deploy.org/) configuration for one-command deploys. The GitHub Actions workflow in `.github/workflows/deploy.yml` deploys manually via **Actions → Deploy → Run workflow** (pick the target GitHub Environment).

## 1. Server setup

**AWS shortcut:** use [aws-ec2-kamal.md](aws-ec2-kamal.md) to provision Ubuntu on EC2, Route 53 DNS, and acme.sh via CloudFormation, then set the GitHub Actions variables from stack outputs.

Provision a VPS running Ubuntu (Hetzner, EC2, DigitalOcean, etc.). Most providers include an `ubuntu` user; if not, create one:

```bash
adduser ubuntu && usermod -aG sudo ubuntu
```

**Generate an SSH keypair for the ubuntu user (no passphrase)** — used by GitHub Actions to SSH into the server:

```bash
sudo -u ubuntu ssh-keygen -t ed25519 -N "" -f /home/ubuntu/.ssh/id_ed25519
sudo -u ubuntu bash -c 'cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

Copy the private key (`cat /home/ubuntu/.ssh/id_ed25519`) — it becomes the `SSH_PRIVATE_KEY` GitHub secret.

**Create the data directory** that Baguette mounts at runtime:

```bash
mkdir -p /home/ubuntu/baguette_storage   # → /data  (SQLite DB, repos, worktrees)
```

## 2. Wildcard TLS with acme.sh

Install acme.sh on the server (as the `ubuntu` user):

```bash
curl https://get.acme.sh | sh -s email=you@example.com
```

Issue a wildcard certificate using your DNS provider's API. Running this command once persists the DNS credentials in acme.sh's config for future renewals. Example with Route 53:

```bash
export AWS_ACCESS_KEY_ID="your-key"
export AWS_SECRET_ACCESS_KEY="your-secret"
~/.acme.sh/acme.sh --issue --dns dns_aws -d "your-domain.com" -d "*.your-domain.com" --server letsencrypt
```

See [acme.sh DNS API docs](https://github.com/acmesh-official/acme.sh/wiki/dnsapi) for all supported providers and their required env vars.

**Create `~/acme.sh/renew.sh`** — the deploy workflow calls this before every deploy to keep the certificate fresh. acme.sh stores DNS credentials from the initial `--issue`, so no need to re-export them. acme.sh exit code 2 means "already up to date" and is treated as success:

```bash
mkdir -p ~/acme.sh
cat > ~/acme.sh/renew.sh << 'EOF'
#!/usr/bin/env bash

/home/ubuntu/.acme.sh/acme.sh --issue --dns dns_aws -d "your-domain.com" -d "*.your-domain.com" --server letsencrypt
rc=$?

# Exit code 2 from acme.sh means "certificate already up to date"
if [ "$rc" -eq 2 ]; then
  exit 0
fi

exit "$rc"
EOF
chmod +x ~/acme.sh/renew.sh
```

Replace `dns_aws` with your provider's hook name and `your-domain.com` with your actual domain.

> **Note:** Certificates are renewed on every deploy (Let's Encrypt certs are valid for 90 days). There is no scheduled renewal — if your cert expires between deploys, simply redeploy Baguette to renew it.

## 3. DNS configuration

Add A records for the apex and the wildcard, pointing to your server IP:

```
your-domain.com     →  <server IP>   # apex — 301-redirected to www
*.your-domain.com   →  <server IP>   # wildcard
```

The wildcard routes both `www.your-domain.com` (Baguette UI) and `session-<id>.your-domain.com` (preview subdomains) to your server.

The apex record makes the bare domain resolve: when `PUBLIC_HOST` is on the `www.` subdomain (the default in `config/deploy.yml`), Baguette 301-redirects any apex request to `www` automatically — kamal-proxy routes the apex host to the app, which issues the redirect. The acme.sh certificate in section 2 already covers the apex (`-d your-domain.com`), so it needs no changes. If you keep `PUBLIC_HOST` on a non-www host, no redirect happens — skip the apex record if you prefer the bare domain to stay unreachable.

## 4. GitHub App (optional)

You can skip this and use passkeys and/or a personal access token. The first-user wizard can create a GitHub App via GitHub’s manifest flow, and admins can configure or recreate it later from **Admin → GitHub App**.

To create an App yourself at [github.com/settings/apps](https://github.com/settings/apps):

- **Homepage URL**: `https://www.your-domain.com`
- **Callback URL** and **Setup URL**: `https://www.your-domain.com/auth/github/callback`

Set the permissions and options listed in [Setting up the GitHub App](../../README.md#setting-up-the-github-app).

## 5. Deploy Baguette

A single-node install needs **no required app env** besides optional `BOOTSTRAP_PASSWORD`. Persist `/home/ubuntu/baguette_storage` (`DATA_DIR`). First boot writes `${DATA_DIR}/encryption.key` (mode `0600`) and an empty `instance_settings` row.

All configuration is driven by the following variables:

| Variable             | Description                                                                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_SERVER`      | Optional. Server hostname or IP to deploy over SSH — defaults to `DOMAIN` (the apex record from step 3 must resolve); set `www.<DOMAIN>` or a raw IP as overridden choice                                                                                                                |
| `DEPLOY_USER`        | SSH user on the server (default: `ubuntu`)                                                                                                                                                                                                                                               |
| `DOMAIN`             | Your domain (e.g. `baguette.example.com`) — used for `www.<DOMAIN>`, `*.<DOMAIN>`, and cert paths (also the default SSH target)                                                                                                                                                          |
| `SSH_PRIVATE_KEY`    | Private key for SSH access to the server (contents of `/home/ubuntu/.ssh/id_ed25519`)                                                                                                                                                                                                    |
| `BOOTSTRAP_PASSWORD` | Optional. One-time first-visitor gate (env-only; never copied to disk). Set this on public hosts.                                                                                                                                                                                        |
| `TRUST_PROXY_HOPS`   | Optional. Reverse-proxy hops trusted to set `X-Forwarded-For` (default: `1` — kamal-proxy is the one trusted hop). Set `0` only when exposing Baguette directly with no proxy in front                                                                                                   |
| `TRUST_EDGE_COUNTRY` | Optional. Set `1` only when Baguette runs behind Cloudflare, CloudFront, or App Engine, which set the client-country header. Default off — country comes from a geoip lookup of the client IP. kamal-proxy does not set those headers, so leave this unset unless you put a CDN in front |

**Optional — Docker Hub (or GHCR) instead of the local registry on the server**

When `DOCKER_REGISTRY_USERNAME` is set, Kamal pushes and pulls from that registry (build runs on your machine or on the GitHub runner, not via SSH on the deploy server). Omit these to keep the default `localhost:5555` registry on the VPS.

| Variable                   | Description                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `DOCKER_IMAGE`             | Image name (default: `smpl-ee/baguette`), e.g. `your-user/baguette` on Docker Hub                |
| `DOCKER_REGISTRY_USERNAME` | Registry username (Docker Hub user or org)                                                       |
| `DOCKER_REGISTRY_PASSWORD` | Registry password or access token (secret in GitHub Actions; in `.kamal/.env` for local deploys) |
| `DOCKER_REGISTRY_SERVER`   | Registry host (optional; omit for Docker Hub, use `ghcr.io` for GitHub Container Registry)       |

### Optional — OIDC with oauth2-proxy (Kamal only)

To require SSO before anyone can reach Baguette (complements or replaces `BOOTSTRAP_PASSWORD` at the network edge), set **`OAUTH2_PROXY_PROVIDER`** in `.kamal/.env` or in GitHub Actions **Variables**. When this variable is set, `config/deploy.yml`:

- Disables kamal-proxy on the Baguette `web` role (`proxy: false`)
- Boots an [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) **accessory** with kamal-proxy on port `4180`, forwarding to `baguette-web:3000`
- Terminates TLS on the same wildcard certificate as the default layout (`www.<DOMAIN>`, `*.<DOMAIN>`, and the apex)

Unset `OAUTH2_PROXY_PROVIDER` to keep the default single-proxy setup.

| Variable / secret              | Where    | Description                                                                          |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| `OAUTH2_PROXY_PROVIDER`        | Variable | **Opt-in.** Provider name (e.g. `google`, `github`, `oidc`). Omit to disable.        |
| `OAUTH2_PROXY_EMAIL_DOMAINS`   | Variable | Allowed email domains (e.g. `example.com`) or `*` for any                            |
| `OAUTH2_PROXY_CLIENT_ID`       | Secret   | OAuth client ID from your IdP                                                        |
| `OAUTH2_PROXY_CLIENT_SECRET`   | Secret   | OAuth client secret                                                                  |
| `OAUTH2_PROXY_COOKIE_SECRET`   | Secret   | Signing key for oauth2-proxy cookies (`openssl rand -base64 32`)                     |
| `OAUTH2_PROXY_OIDC_ISSUER_URL` | Variable | Optional. Required for `oidc` provider                                               |
| `OAUTH2_PROXY_COOKIE_DOMAINS`  | Variable | Optional. e.g. `.your-domain.com` so session preview subdomains share the SSO cookie |
| `OAUTH2_PROXY_SKIP_AUTH_REGEX` | Variable | Optional. Paths that bypass SSO (advanced)                                           |

**IdP redirect URL** — register this authorized redirect URI with your provider:

`https://www.<DOMAIN>/oauth2/callback`

Example Google OAuth client + `.kamal/.env`:

```bash
OAUTH2_PROXY_PROVIDER=google
OAUTH2_PROXY_EMAIL_DOMAINS=example.com
OAUTH2_PROXY_CLIENT_ID=123456789.apps.googleusercontent.com
OAUTH2_PROXY_CLIENT_SECRET=...
OAUTH2_PROXY_COOKIE_SECRET=...   # openssl rand -base64 32
# Optional: SSO cookie on preview subdomains
OAUTH2_PROXY_COOKIE_DOMAINS=.your-domain.com
```

After the first deploy with OIDC enabled, boot the accessory (Kamal does not roll accessories on `kamal deploy`):

```bash
kamal accessory boot oauth2-proxy
```

When you change oauth2-proxy env or image, run `kamal accessory reboot oauth2-proxy`. Baguette still uses its own sign-in (passkeys, GitHub, invites) **after** the edge gate — treat oauth2-proxy as network-level access control, not a replacement for Baguette user accounts.

### 5.1. Deploy with Kamal

Deploy directly from your local machine. You'll need Ruby installed.

```bash
# Install Kamal
gem install kamal

# Copy and fill in your configuration
cp .kamal/.env.example .kamal/.env
# edit .kamal/.env with your values

# Deploy
kamal deploy
```

`.kamal/.env` is gitignored. `config/deploy.yml` loads it automatically via `Dotenv`.

### 5.2. Deploy using GitHub Actions

The included workflow (`.github/workflows/deploy.yml`) runs only on manual **workflow_dispatch** (no deploy on push to `main`). On GitHub Actions, `config/deploy.yml` uses BuildKit `type: gha` for Docker layer cache; local `kamal deploy` uses the registry cache on the deploy server.

1. **Fork** this repository to your own GitHub account.

2. Go to **Settings → Secrets and variables → Actions** in your fork and add:

   **Variables** (plain text, "Variables" tab):

   | Variable        | Value                                                                                               |
   | --------------- | --------------------------------------------------------------------------------------------------- |
   | `DEPLOY_SERVER` | Optional — defaults to `DOMAIN` (SSH deploys via the apex record); set an IP or `www.…` to override |
   | `DOMAIN`        | Your domain (e.g. `baguette.example.com`)                                                           |
   | `DEPLOY_USER`   | SSH user on the server (optional, default: `ubuntu`)                                                |

   Optional for Docker Hub / remote registry (see table above): `DOCKER_IMAGE`, `DOCKER_REGISTRY_USERNAME`, `DOCKER_REGISTRY_SERVER`.

   **Secrets** (encrypted, "Secrets" tab):

   | Secret                       | Value                                                                       |
   | ---------------------------- | --------------------------------------------------------------------------- |
   | `SSH_PRIVATE_KEY`            | Contents of `/home/ubuntu/.ssh/id_ed25519` on the server                    |
   | `BOOTSTRAP_PASSWORD`         | Optional. First-visitor gate on public hosts (env-only)                     |
   | `DOCKER_REGISTRY_PASSWORD`   | Docker Hub token or registry password (only if using remote registry)       |
   | `OAUTH2_PROXY_CLIENT_ID`     | Optional. oauth2-proxy client ID (only when `OAUTH2_PROXY_PROVIDER` is set) |
   | `OAUTH2_PROXY_CLIENT_SECRET` | Optional. oauth2-proxy client secret                                        |
   | `OAUTH2_PROXY_COOKIE_SECRET` | Optional. oauth2-proxy cookie signing secret                                |

   Optional **Variables** when using oauth2-proxy: `OAUTH2_PROXY_PROVIDER`, `OAUTH2_PROXY_EMAIL_DOMAINS`, `OAUTH2_PROXY_OIDC_ISSUER_URL`, `OAUTH2_PROXY_COOKIE_DOMAINS`, `OAUTH2_PROXY_SKIP_AUTH_REGEX` (see [Optional — OIDC with oauth2-proxy](#optional--oidc-with-oauth2-proxy-kamal-only)).

3. In GitHub, open **Actions → Deploy → Run workflow**, choose the environment, and run the workflow.
