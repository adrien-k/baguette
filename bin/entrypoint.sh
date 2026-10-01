#!/bin/sh
set -e

# On Fly.io machines (full VMs) there is no host Docker socket to mount, so we start dockerd
# directly. On a VPS deploy (Kamal) the socket is mounted from the host — skip this.
#
# --data-root=/data/docker: Fly.io's rootfs is itself an overlayfs mount, which prevents
# Docker's default overlay2 storage driver from working (can't stack overlay on overlay).
# The /data volume is a plain ext4 filesystem that supports overlay2.
if [ ! -S /var/run/docker.sock ] && command -v dockerd > /dev/null 2>&1; then
    mkdir -p /data/docker
    dockerd --host=unix:///var/run/docker.sock --data-root=/data/docker > /var/log/dockerd.log 2>&1 &
    timeout 30 sh -c 'until [ -S /var/run/docker.sock ]; do sleep 0.5; done' || true
fi

# Match the docker group GID to the host socket so the baguette user can run docker commands.
# The host mounts /var/run/docker.sock; its GID reflects the host's docker group.
if [ -S /var/run/docker.sock ]; then
    DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
    if [ "$DOCKER_GID" -eq 0 ]; then
        # Socket is root:root (common with Docker Desktop bind-mounts). GID 0 is the root
        # group — we cannot `groupmod -g 0 docker` — add baguette to root so it can use the socket.
        usermod -aG root baguette
    else
        groupmod -g "$DOCKER_GID" docker
        usermod -aG docker baguette
    fi

    # Shared bridge network for Baguette and per-session docker tasks.
    docker network inspect baguette_default >/dev/null 2>&1 || docker network create baguette_default

    # Connect this container so it can reach task containers on baguette_default.
    CONTAINER_ID=$(grep -o '/docker/containers/[a-f0-9]*/' /proc/self/mountinfo 2>/dev/null | head -1 | cut -d'/' -f4)
    if [ -n "$CONTAINER_ID" ]; then
      docker network connect baguette_default "$CONTAINER_ID" 2>/dev/null || true
    fi
fi

# Persist the whole home folder on the mounted volume while keeping the original home folder
# from the docker image.
# - Claude authentication
# - Baguette data directory
# - Mise binaries and shims
# - User-installed CLIs (pip/uv/poetry use ~/.cache and ~/.local, Cargo ~/.cargo,
#   Rustup ~/.rustup, npm ~/.npm, Ruby Bundler ~/.bundle, Go ~/go, ...
mkdir -p /data/home
chown baguette:baguette /data/home
mv /home/baguette /home/baguette-original
ln -sfn /data/home /home/baguette

# User-installed CLIs (dirs above are on /data); prepend so they win over image PATH
BAGUETTE_PATH="/home/baguette/.local/share/mise/shims:/home/baguette/.local/bin:/home/baguette/.cargo/bin:/home/baguette/go/bin:$PATH"

gosu baguette sh -c '
  cp -r /home/baguette-original/. /home/baguette/
  # Default mise layout is ~/.local/share/mise (on /data via the .local symlink)
  mkdir -p \
    /home/baguette/.local/bin \
    /home/baguette/.local/share/mise/shims \
    /home/baguette/.cargo/bin \
    /home/baguette/go/bin
'

exec gosu baguette env PATH="$BAGUETTE_PATH" "$@"
