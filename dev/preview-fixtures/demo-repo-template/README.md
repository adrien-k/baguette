# Baguette preview dev fixture

Minimal repo for local Baguette development. Two branches are created by `bootstrap-demo-repo.mjs`:

- **`preview-single`** — one `webserver` preview service
- **`preview-multi`** — two named `services` (portal + per-service URLs)

Each task runs a tiny Node HTTP echo server on an allocated port.
