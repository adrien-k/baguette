FROM node:24-bookworm-slim AS base

FROM base AS builder

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*

WORKDIR /client

COPY client/package*.json .
RUN npm install

COPY client .
COPY shared ../shared
RUN npm run build


FROM base AS runner

# Add libs generally useful for development. Add your own to avoid re-installing them every time.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    build-essential \
    bubblewrap \
    cmake \
    curl \
    git \
    git-lfs \
    gosu \
    gpg \
    imagemagick \
    libcurl4-openssl-dev \
    libffi-dev \
    libseccomp-dev \
    libjemalloc2 \
    libreadline-dev \
    libsqlite3-0 \
    libssl-dev \
    libvips42 \
    libyaml-dev \
    libicu-dev \
    pkg-config \
    jq \
    python3 \
    ripgrep \
    socat \
    zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

# Install Docker (daemon + CLI). On a VPS the daemon socket is mounted from the host; on Fly.io
# the machine is a full VM so the entrypoint starts dockerd directly.
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y docker-ce docker-ce-cli docker-compose-plugin && rm -rf /var/lib/apt/lists/*

# Install mise
RUN curl -fsSL https://mise.jdx.dev/gpg-key.pub | gpg --dearmor > /usr/share/keyrings/mise-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/mise-archive-keyring.gpg arch=$(dpkg --print-architecture)] https://mise.jdx.dev/deb stable main" > /etc/apt/sources.list.d/mise.list \
    && apt-get update && apt-get install -y mise && rm -rf /var/lib/apt/lists/*


# Install code-server for VS Code web access to session worktrees
ARG CODE_SERVER_VERSION=4.137.0
RUN curl -fsSL "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_$(dpkg --print-architecture).deb" \
      -o /tmp/code-server.deb \
    && dpkg -i /tmp/code-server.deb \
    && rm /tmp/code-server.deb

RUN npm install -g pnpm @anthropic-ai/claude-code@2.1.202 playwright

# Install Chromium and its system dependencies for Playwright
RUN npx playwright install --with-deps chromium

# Rename the existing node user (UID 1000) to baguette; docker-ce creates the docker group automatically
# so we just ensure baguette is added to it; entrypoint adjusts the GID at runtime when socket is mounted
RUN usermod -l baguette -d /home/baguette -m node \
    && groupmod -n baguette node \
    && usermod -aG docker baguette

    
USER baguette
RUN mise settings ruby.compile=false

WORKDIR /app

COPY --chown=baguette:baguette package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3

COPY --chown=baguette:baguette --from=builder /client/dist client/dist/
COPY --chown=baguette:baguette shared/ shared/
COPY --chown=baguette:baguette server/ server/
COPY --chown=baguette:baguette knexfile.js ./
COPY --chown=baguette:baguette bin/ bin/

RUN chmod +x /app/bin/entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV HOME=/home/baguette
ENV PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig:/usr/lib/pkgconfig
ENV MISE_TRUSTED_CONFIG_PATHS=/data/.config/mise:/data/.baguette/repos
ENV COMPOSE_PROJECT_NAME=baguette

EXPOSE 3000

# entrypoint runs as root: adjusts docker group GID, symlinks $HOME dirs to /data, then drops to baguette
USER root
ENTRYPOINT ["/app/bin/entrypoint.sh"]
CMD ["sh", "-c", "npm run migrate && exec node server/index.js"]
