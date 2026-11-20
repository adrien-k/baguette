# AWS EC2 + CloudFormation for Kamal

This guide provisions a single Ubuntu EC2 instance with Route 53 DNS and [acme.sh](https://github.com/acmesh-official/acme.sh) configured for the same TLS flow as [kamal.md](kamal.md). After the stack finishes, you copy a few values into GitHub Actions and deploy with the existing workflow (`.github/workflows/deploy.yml`).

## What the stack creates

| Resource                       | Purpose                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EC2 (Ubuntu 24.04)             | Kamal deploy target; Docker installed; root volume (`/dev/sda1`) holds `/home/ubuntu/baguette_storage` (SQLite DB, repos, worktrees) and is kept when the instance is replaced or the stack is deleted |
| Elastic IP                     | Stable public IP; `<DOMAIN>` and `*.<DOMAIN>` point here (www.<DOMAIN> resolves via the wildcard)                                                                                                      |
| Security group                 | TCP 22 (Kamal/CI), 80, 443                                                                                                                                                                             |
| IAM instance role              | Route 53 `dns_aws` (list zones, change records on `HostedZoneId`); SSM Session Manager; KMS grant for the SSM agent data key (`alias/aws/ssm` plus optional `SsmKmsKeyArn`)                            |
| Route 53 A records             | `<DOMAIN>` (apex) and `*.<DOMAIN>` (wildcard, covers www) → Elastic IP                                                                                                                                 |
| acme.sh + `~/acme.sh/renew.sh` | Wildcard cert; CI renews before each deploy                                                                                                                                                            |

Template: [`infra/aws/cloudformation/baguette-kamal.yaml`](../../infra/aws/cloudformation/baguette-kamal.yaml) (instance bootstrap: [`userdata.sh`](../../infra/aws/cloudformation/userdata.sh))

## Prerequisites

- AWS account with permissions for CloudFormation, EC2, EIP, Route 53, and IAM roles
- A **public** Route 53 hosted zone that can hold records for your `DomainName` (e.g. zone `example.com` and domain `baguette.example.com`)
- AWS CLI configured (`aws sts get-caller-identity`)
- For interactive access: [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) (optional; SSM API works without it for fetching the deploy key)

## Parameters

| Parameter                   | Description                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DomainName`                | Same as `DOMAIN` in CI (e.g. `baguette.example.com`)                                                         |
| `HostedZoneId`              | Route 53 hosted zone ID (console or `aws route53 list-hosted-zones`)                                         |
| `VpcId`                     | VPC for the instance (default VPC is fine)                                                                   |
| `SubnetId`                  | **Public** subnet with a route to an Internet Gateway                                                        |
| `AcmeEmail`                 | Let's Encrypt account email                                                                                  |
| `InstanceType`              | Default `t3.medium` (remote Docker builds need RAM)                                                          |
| `VolumeSize` / `VolumeType` | Root disk; default 40 GiB `gp3`                                                                              |
| `SshIngressCidr`            | CIDR for SSH (port 22) — **Kamal/GitHub Actions only**; default `0.0.0.0/0` because hosted runner IPs change |

Each resource gets a `Name` tag from the stack. Extra tags are **CloudFormation stack tags**, not a template parameter: `Fn::ForEach` cannot build a `Tags` list (it merges objects, so every iteration repeats the key `Key`). Stack tags propagate to the instance, Elastic IP, security group, and IAM role.

Copy and edit the example files:

```bash
cp infra/aws/parameters.example.json infra/aws/parameters.json
# edit infra/aws/parameters.json

cp infra/aws/tags.example.json infra/aws/tags.json
# edit infra/aws/tags.json (optional; omit for no extra tags)
```

To find VPC and subnet IDs (use a public subnet):

```bash
aws ec2 describe-subnets --filters Name=map-public-ip-on-launch,Values=true \
  --query 'Subnets[].{SubnetId:SubnetId,VpcId:VpcId,AZ:AvailabilityZone}' --output table
```

`parameters.json` and `tags.json` are gitignored — do not commit environment-specific values.

`provision-stack.sh` passes `--tags file://infra/aws/tags.json` when that file exists. In the console, use **Stack options → Tags**. On `update`, omitting the file leaves existing stack tags unchanged; an empty `[]` file clears them.

## Provision the stack

```bash
./infra/aws/provision-stack.sh create
```

Other commands: `update`, `delete`, `outputs`, `status`, `bootstrap-logs`, `render`. Override `STACK_NAME`, `AWS_REGION`, `PARAMETERS_FILE`, or `TAGS_FILE` as needed.

Stack creation waits for bootstrap (Docker, acme.sh, first certificate) and fails if that script fails (up to 25 minutes); on failure the stack rolls back and its resources are removed — check `bootstrap-logs` output or the stack events for the cause. The instance appears in **Systems Manager → Fleet Manager** once SSM registration completes (usually a few minutes after boot).

### Manual CloudFormation (optional)

`create` / `update` embed [`userdata.sh`](../../infra/aws/cloudformation/userdata.sh) into the template. For a raw `aws` call, render first:

```bash
./infra/aws/provision-stack.sh render > /tmp/baguette-kamal.yaml
aws cloudformation create-stack \
  --stack-name baguette-kamal \
  --template-body file:///tmp/baguette-kamal.yaml \
  --parameters file://infra/aws/parameters.json \
  --tags file://infra/aws/tags.json \
  --capabilities CAPABILITY_IAM
```

## GitHub Actions configuration

When the stack completes, print values to copy into the fork:

```bash
./infra/aws/provision-stack.sh outputs
```

That prints the required `DOMAIN` variable, the `SSH_PRIVATE_KEY` secret with the SSM commands to fetch it, and the instance/IP values for later. `DEPLOY_USER` is omitted — Kamal and the workflow default to `ubuntu`.

### Variables (Settings → Secrets and variables → Actions → **Variables**)

| Variable        | Source                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `DOMAIN`        | Stack parameter `DomainName` (required)                                                                        |
| `DEPLOY_SERVER` | Optional. Defaults to `DOMAIN` (deploy SSH uses the apex record); set `www.<DOMAIN>` or a raw IP if you prefer |

### Secrets (**Secrets** tab)

| Secret               | How to obtain                                               |
| -------------------- | ----------------------------------------------------------- |
| `SSH_PRIVATE_KEY`    | Deploy key on the instance — fetch via SSM (below), not SSH |
| `BOOTSTRAP_PASSWORD` | Optional. First-visitor gate on public hosts (env-only)     |

`TRUST_PROXY_HOPS` is optional (default `1`) and is not a secret: kamal-proxy is the one trusted `X-Forwarded-For` hop, so the default is correct for this topology. Set it to `0` only if you expose Baguette directly with no proxy in front.

`TRUST_EDGE_COUNTRY` is optional and default off. Set `1` only when Baguette runs behind Cloudflare, CloudFront, or App Engine, which set the client-country header; otherwise Admin → Users last-used country comes from a geoip lookup of the client IP. kamal-proxy does not set those headers.

#### Fetch `SSH_PRIVATE_KEY` with SSM

Replace `INSTANCE_ID` and `REGION` (or copy the filled-in command from `./infra/aws/provision-stack.sh outputs`):

```bash
INSTANCE_ID=i-0123456789abcdef0
REGION=us-east-1

CMD_ID=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["cat /home/ubuntu/.ssh/id_ed25519"]' \
  --query 'Command.CommandId' --output text)

aws ssm wait command-executed --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" --region "$REGION"

aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" --region "$REGION" \
  --query 'StandardOutputContent' --output text
```

Paste the full private key (including `BEGIN`/`END` lines) into the `SSH_PRIVATE_KEY` secret.

The deploy key lives at `/home/ubuntu/.ssh/id_ed25519`. Kamal and `.kamal/secrets` read certs from `/home/ubuntu/.acme.sh/<DOMAIN>_ecc/` after `renew.sh` runs.

Run the **Deploy** workflow from GitHub Actions (see [kamal.md §5.2](kamal.md#52-deploy-using-github-actions)), or follow [kamal.md §5.1](kamal.md#51-deploy-with-kamal) for a local `kamal deploy`.

## Operations

- **TLS renewal**: Handled on each deploy via `renew.sh` (see deploy workflow). Redeploy if the cert ages out between releases.
- **Admin shell**: `aws ssm start-session --target <InstanceId> --region <region>` (output `SsmStartSessionCommand`). Switch to `ubuntu` with `sudo su - ubuntu` if needed.
- **Resize instance / disk**: Update `parameters.json`, run `./infra/aws/provision-stack.sh update` (disk size increases may require OS steps).
- **Install updates**: Most changes apply via `./infra/aws/provision-stack.sh update`; updates roll back automatically on failure. Changes that replace the instance (e.g. a new subnet) follow [Recreating the EC2 instance](#recreating-the-ec2-instance).
- **Teardown**: `./infra/aws/provision-stack.sh delete` — deletes the instance, EIP, and Route 53 records the stack created. The root volume has `DeleteOnTermination: false` and is left behind on purpose (delete it in the console when you are done recovering data).

## App data and instance replacement

`baguette_storage` (SQLite database, cloned repos, worktrees) lives on the root volume (`/dev/sda1`) with `DeleteOnTermination: false`:

- **Terminating or replacing the instance** (a replacement update, or stack teardown) detaches and keeps the volume instead of deleting it. Delete such retained volumes by hand once you no longer need the data.
- **A replaced instance boots a fresh root volume from the AMI** — the data does not follow automatically. Restore it from the retained old volume (or a snapshot) as shown in the next section.

Two things other than the volume itself do **not** carry over automatically when the stack is recreated (a plain in-place replacement via `update` keeps the stack, and with it the EIP):

- **The Elastic IP** is a stack resource: recreating the stack allocates a new IP, and the Route 53 records the stack manages follow it automatically (TTL 300 — plan for bounded DNS-propagation downtime).
- **The deploy SSH key** is generated per instance at bootstrap: [re-fetch `SSH_PRIVATE_KEY`](#fetch-ssh_private_key-with-ssm) and update the GitHub secret after any replacement.

`ENCRYPTION_KEY` and the `AUTH_GITHUB_*` secrets are legacy — kept for backward compatibility with deployments configured before the in-app wizard; new installs do not need them (the first boot generates the encryption key into `baguette_storage`). If you set `ENCRYPTION_KEY`, keep it unchanged across replacements: the restored SQLite data is encrypted with it.

### Backups

Snapshots take a moment and are crash-consistent; for guaranteed consistency, stop the Baguette containers for the snapshot (`docker stop $(docker ps --format '{{.Names}}' | grep '^baguette')`, restart them after the snapshot completes):

```bash
INSTANCE_ID=$(aws cloudformation describe-stack-resource --stack-name baguette-kamal \
  --logical-resource-id BaguetteInstance --query 'StackResourceDetail.PhysicalResourceId' --output text)
VOL=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].BlockDeviceMappings[?DeviceName==`/dev/sda1`].Ebs.VolumeId' --output text)
aws ec2 create-snapshot --volume-id "$VOL" --description "baguette storage snapshot"
aws ec2 wait snapshot-completed --snapshot-ids <id>
```

## Recreating the EC2 instance

Some updates require CloudFormation to **replace** the EC2 instance (stop + terminate + recreate) — for example moving the instance to a different subnet by changing `SubnetId`. The replacement boots a fresh root volume from the AMI; the old one is detached and kept (`DeleteOnTermination: false`), so nothing is lost:

1. **Note the current root volume id** before the update (this is what you restore from):

   ```bash
   REGION=us-east-1
   OLD_INSTANCE_ID=$(aws cloudformation describe-stack-resource --stack-name baguette-kamal \
     --logical-resource-id BaguetteInstance --query 'StackResourceDetail.PhysicalResourceId' --output text)
   OLD_VOL=$(aws ec2 describe-instances --instance-ids "$OLD_INSTANCE_ID" --region "$REGION" \
     --query 'Reservations[0].Instances[0].BlockDeviceMappings[?DeviceName==`/dev/sda1`].Ebs.VolumeId' --output text)
   ```

2. Update `parameters.json` with the change (for the subnet example: point `SubnetId` at the target subnet — its VPC must match `VpcId`), then:

   ```bash
   ./infra/aws/provision-stack.sh update
   ```

   The instance is replaced in place (no delete + recreate needed — the EIP and Route 53 records stay). When it completes, [re-fetch `SSH_PRIVATE_KEY`](#fetch-ssh_private_key-with-ssm) and run the Deploy workflow.

3. **Optional — restore app data** from the retained volume onto the fresh instance (skip for a fresh start):

   ```bash
   INSTANCE_ID=$(aws cloudformation describe-stack-resource --stack-name baguette-kamal \
     --logical-resource-id BaguetteInstance --query 'StackResourceDetail.PhysicalResourceId' --output text)
   aws ec2 attach-volume --volume-id "$OLD_VOL" --instance-id "$INSTANCE_ID" --device /dev/sdi --region "$REGION"
   aws ssm start-session --target "$INSTANCE_ID"        # then on the instance:
   #   sudo mkdir -p /mnt/restore && sudo mount -o ro /dev/xvdi /mnt/restore
   #   sudo docker stop $(sudo docker ps --format '{{.Names}}' | grep '^baguette')
   #   sudo rsync -aHAX --delete /mnt/restore/ /home/ubuntu/baguette_storage/
   #   sudo umount /mnt/restore
   #   sudo docker start $(sudo docker ps -a --format '{{.Names}}' | grep '^baguette')
   #   exit
   aws ec2 detach-volume --volume-id "$OLD_VOL" --region "$REGION"
   ```

   The old volume mounts read-only and is detached afterwards — keep it or snapshot it as a backup before deleting. Verify the UI afterwards (session list intact).

## Troubleshooting

| Symptom                                                                    | Check                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack stuck / instance running but no cert                                 | `./infra/aws/provision-stack.sh bootstrap-logs` (or `sudo tail -f /var/log/cloud-init-output.log`); run `/home/ubuntu/acme.sh/renew.sh` as `ubuntu`                                                                                                                                                                                                       |
| acme.sh install / WaitCondition FAILURE                                    | Installer must run in `/home/ubuntu` (it writes `master.tar.gz` to cwd). `bootstrap-logs` reads the instance id from the stack resource, not outputs (outputs only exist after `CREATE_COMPLETE`).                                                                                                                                                        |
| SSM target not connected                                                   | Instance has public egress; IAM role includes `AmazonSSMManagedInstanceCore`; wait a few minutes after boot                                                                                                                                                                                                                                               |
| SSM handshake fails: `Fetching data key failed … kms:Decrypt AccessDenied` | The account encrypts the SSM agent data key with a KMS key (Session Manager preferences or SSM default host management configuration). Update the stack with the `SsmKmsKeyArn` parameter set to that key's ARN (the account's `aws/ssm` alias is granted by default), or turn off the KMS encryption in the SSM console (Session Manager → Preferences). |
| acme DNS errors                                                            | `HostedZoneId` matches the zone for `DomainName`; role allows `route53:ListHostedZones` plus record changes on that zone                                                                                                                                                                                                                                  |
| Deploy SSH fails                                                           | `SSH_PRIVATE_KEY` is the deploy key from SSM; security group allows SSH from GitHub Actions (`SshIngressCidr`)                                                                                                                                                                                                                                            |
| 502 / proxy errors                                                         | First deploy still running; ensure apex and wildcard DNS resolve to the Elastic IP (`dig www.<DOMAIN>` — wildcard covers www)                                                                                                                                                                                                                             |

For provider-agnostic Kamal steps (GitHub App, env vars, local deploy), see [kamal.md](kamal.md).

```

```
