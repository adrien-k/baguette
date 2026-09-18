# Production deployment with Kamal

This repository ships with a [Kamal](https://kamal-deploy.org/) configuration for one-command deploys. The GitHub Actions workflow in `.github/workflows/deploy.yml` builds and deploys automatically on every push to `main`.

## 1. Server setup

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

Add a wildcard A record pointing to your server IP:

```
*.your-domain.com  →  <server IP>
```

This routes both `www.your-domain.com` (Baguette UI) and `session-<id>.your-domain.com` (preview subdomains) to your server.

## 4. GitHub OAuth App

Create a GitHub OAuth App at [github.com/settings/developers](https://github.com/settings/developers):

- **Homepage URL**: `https://www.your-domain.com`
- **Authorization callback URL**: `https://www.your-domain.com/auth/github/callback`

Note the **Client ID** and generate a **Client Secret** — they become the `AUTH_GITHUB_CLIENT_ID` and `AUTH_GITHUB_CLIENT_SECRET` secrets below.

## 5. Deploy Baguette

All configuration is driven by the following variables:

| Variable                    | Description                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_SERVER`             | Your server hostname or IP address                                                                                   |
| `DEPLOY_USER`               | SSH user on the server (default: `ubuntu`)                                                                           |
| `DOMAIN`                    | Your domain (e.g. `baguette.example.com`) — used for `www.<DOMAIN>`, `*.<DOMAIN>`, and cert paths                    |
| `SSH_PRIVATE_KEY`           | Private key for SSH access to the server (contents of `/home/ubuntu/.ssh/id_ed25519`)                                |
| `AUTH_GITHUB_CLIENT_ID`     | GitHub OAuth App client ID                                                                                           |
| `AUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret                                                                                       |
| `ENCRYPTION_KEY`            | At least 32 random characters — used for cookie signing and secret encryption (generate with `openssl rand -hex 32`) |

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

The included workflow (`.github/workflows/deploy.yml`) deploys automatically on every push to `main`.

1. **Fork** this repository to your own GitHub account.

2. Go to **Settings → Secrets and variables → Actions** in your fork and add:

   **Variables** (plain text, "Variables" tab):

   | Variable        | Value                                                |
   | --------------- | ---------------------------------------------------- |
   | `DEPLOY_SERVER` | Your server hostname or IP                           |
   | `DOMAIN`        | Your domain (e.g. `baguette.example.com`)            |
   | `DEPLOY_USER`   | SSH user on the server (optional, default: `ubuntu`) |

   **Secrets** (encrypted, "Secrets" tab):

   | Secret                      | Value                                                     |
   | --------------------------- | --------------------------------------------------------- |
   | `SSH_PRIVATE_KEY`           | Contents of `/home/ubuntu/.ssh/id_ed25519` on the server  |
   | `AUTH_GITHUB_CLIENT_ID`     | Your GitHub OAuth App client ID                           |
   | `AUTH_GITHUB_CLIENT_SECRET` | Your GitHub OAuth App client secret                       |
   | `ENCRYPTION_KEY`            | Random 32+ character string (e.g. `openssl rand -hex 32`) |

3. Push to `main` — the workflow will build and deploy automatically.
