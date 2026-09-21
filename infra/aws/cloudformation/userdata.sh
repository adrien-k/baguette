#!/bin/bash
# EC2 bootstrap (CloudFormation UserData). Fn::Sub replaces:
#   HostedZoneId, AcmeEmail, DomainName, BootstrapWaitHandle
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

log() {
  echo "=== $* ==="
}

as_ubuntu() {
  sudo -H -u ubuntu "$@"
}

signal() {
  local status="$1"
  local reason=userdata
  if [ "$#" -ge 2 ]; then
    reason="$2"
  fi
  curl -fsS -X PUT -H 'Content-Type:' \
    --data-binary "{\"Status\":\"$status\",\"Reason\":\"$reason\",\"UniqueId\":\"baguette\",\"Data\":\"$reason\"}" \
    '${BootstrapWaitHandle}'
}

fail() {
  echo "ERROR: $*" >&2
  if [ -f /home/ubuntu/.acme.sh/acme.sh.log ]; then
    echo "=== acme.sh.log (last 80 lines) ===" >&2
    tail -n 80 /home/ubuntu/.acme.sh/acme.sh.log >&2 || true
  fi
  trap - ERR
  signal FAILURE bootstrap-failed || true
  exit 1
}

wait_for_dpkg() {
  log "waiting for dpkg/apt"
  systemctl stop apt-daily.service apt-daily-upgrade.service unattended-upgrades.service 2>/dev/null || true
  local n=0
  while [ "$n" -lt 60 ]; do
    if flock -n /var/lib/dpkg/lock-frontend true \
      && flock -n /var/lib/apt/lists/lock true \
      && ! pgrep -x apt-get >/dev/null \
      && ! pgrep -x apt >/dev/null \
      && ! pgrep -x dpkg >/dev/null; then
      return 0
    fi
    n=$((n + 1))
    echo "dpkg/apt busy (wait $n/60)"
    sleep 5
  done
  fail "timed out waiting for dpkg/apt lock"
}

ensure_curl() {
  if command -v curl >/dev/null 2>&1; then
    return 0
  fi
  wait_for_dpkg
  apt-get update -y
  apt-get install -y curl ca-certificates
}

install_ssh_key() {
  log "deploy SSH key"
  install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.ssh
  if ! as_ubuntu test -f /home/ubuntu/.ssh/id_ed25519; then
    as_ubuntu ssh-keygen -t ed25519 -N "" -f /home/ubuntu/.ssh/id_ed25519
    as_ubuntu bash -c 'cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys'
  fi
  chmod 600 /home/ubuntu/.ssh/authorized_keys
  chown -R ubuntu:ubuntu /home/ubuntu/.ssh
}

install_data_dir() {
  log "data directory"
  install -d -m 755 -o ubuntu -g ubuntu /home/ubuntu/baguette_storage
}

install_docker() {
  log "Docker"
  if command -v docker >/dev/null 2>&1; then
    return 0
  fi
  local attempt docker_ok=0
  for attempt in 1 2 3 4 5; do
    wait_for_dpkg
    echo "docker install attempt $attempt/5"
    if curl -fsSL https://get.docker.com | sh; then
      docker_ok=1
      break
    fi
    echo "docker install failed; retrying"
    sleep 10
  done
  if [ "$docker_ok" -ne 1 ]; then
    fail "docker install failed"
  fi
  usermod -aG docker ubuntu
}

install_acme() {
  log "acme.sh"
  if ! as_ubuntu test -x /home/ubuntu/.acme.sh/acme.sh; then
    as_ubuntu bash -c "cd /home/ubuntu && curl -fsSL https://get.acme.sh | sh -s email=${AcmeEmail}"
  fi
  if ! as_ubuntu test -x /home/ubuntu/.acme.sh/acme.sh; then
    fail "acme.sh is not installed at /home/ubuntu/.acme.sh/acme.sh"
  fi
}

write_renew_script() {
  log "renew.sh"
  install -d -m 755 -o ubuntu -g ubuntu /home/ubuntu/acme.sh
  cat > /home/ubuntu/acme.sh/renew.sh << 'RENEW'
#!/usr/bin/env bash
set -euo pipefail
DOMAIN=${DomainName}
export AWS_HOSTED_ZONE_ID=${HostedZoneId}
set +e
/home/ubuntu/.acme.sh/acme.sh --issue --dns dns_aws -d "$DOMAIN" -d "*.$DOMAIN" --server letsencrypt
rc=$?
set -e
if [ "$rc" -eq 0 ] || [ "$rc" -eq 2 ]; then
  exit 0
fi
exit "$rc"
RENEW
  chown ubuntu:ubuntu /home/ubuntu/acme.sh/renew.sh
  chmod +x /home/ubuntu/acme.sh/renew.sh
}

issue_certificate() {
  log "issue certificate"
  local attempt issued=0
  for attempt in $(seq 1 30); do
    echo "cert attempt $attempt/30"
    if as_ubuntu /home/ubuntu/acme.sh/renew.sh; then
      issued=1
      break
    fi
    sleep 20
  done
  if [ "$issued" -ne 1 ]; then
    fail "certificate issuance failed after 30 attempts"
  fi
}

main() {
  trap 'fail "bootstrap aborted at line $LINENO"' ERR
  export AWS_HOSTED_ZONE_ID="${HostedZoneId}"

  log "baguette bootstrap start $(date -u +%FT%TZ)"
  wait_for_dpkg
  ensure_curl
  install_ssh_key
  install_data_dir
  install_docker
  install_acme
  write_renew_script
  issue_certificate

  log "baguette bootstrap complete"
  trap - ERR
  signal SUCCESS ok
}

main "$@"
