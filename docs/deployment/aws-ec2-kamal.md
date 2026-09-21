# AWS EC2 + CloudFormation for Kamal

This guide provisions a single Ubuntu EC2 instance with Route 53 DNS and [acme.sh](https://github.com/acmesh-official/acme.sh) configured for the same TLS flow as [kamal.md](kamal.md). After the stack finishes, you copy a few values into GitHub Actions and deploy with the existing workflow (`.github/workflows/deploy.yml`).

## What the stack creates

| Resource                       | Purpose                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| EC2 (Ubuntu 24.04)             | Kamal deploy target; Docker installed; `/home/ubuntu/baguette_storage` for app data                |
| Elastic IP                     | Stable public IP; `www.<DOMAIN>` and `*.<DOMAIN>` point here                                       |
| Security group                 | TCP 22 (Kamal/CI), 80, 443                                                                         |
| IAM instance role              | Route 53 `dns_aws` (list zones, change records on `HostedZoneId`); SSM Session Manager |
| Route 53 A records             | `www.<DOMAIN>` and `*.<DOMAIN>` → Elastic IP                                                       |
| acme.sh + `~/acme.sh/renew.sh` | Wildcard cert; CI renews before each deploy                                                        |

Template: [`infra/aws/cloudformation/baguette-kamal.yaml`](../../infra/aws/cloudformation/baguette-kamal.yaml) (instance bootstrap: [`userdata.sh`](../../infra/aws/cloudformation/userdata.sh))

## Prerequisites

- AWS account with permissions for CloudFormation, EC2, EIP, Route 53, and IAM roles
- A **public** Route 53 hosted zone that can hold records for your `DomainName` (e.g. zone `example.com` and domain `baguette.example.com`)
- AWS CLI configured (`aws sts get-caller-identity`)
- For interactive access: [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) (optional; SSM API works without it for fetching the deploy key)

## Parameters

| Parameter                   | Description                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DomainName`                | Same as `DOMAIN` in CI (e.g. `baguette.example.com`)                                                                                   |
| `HostedZoneId`              | Route 53 hosted zone ID (console or `aws route53 list-hosted-zones`)                                                                   |
| `VpcId`                     | VPC for the instance (default VPC is fine)                                                                                             |
| `SubnetId`                  | **Public** subnet with a route to an Internet Gateway                                                                                  |
| `AcmeEmail`                 | Let's Encrypt account email                                                                                                            |
| `InstanceType`              | Default `t3.medium` (remote Docker builds need RAM)                                                                                    |
| `VolumeSize` / `VolumeType` | Root disk; default 40 GiB `gp3`                                                                                                        |
| `SshIngressCidr`            | CIDR for SSH (port 22) — **Kamal/GitHub Actions only**; default `0.0.0.0/0` because hosted runner IPs change                           |

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

Stack creation waits for bootstrap (Docker, acme.sh, first certificate) and fails if that script fails (up to 25 minutes). `create` uses `--disable-rollback` so a failed instance is left running for inspection. Fetch the log with `./infra/aws/provision-stack.sh bootstrap-logs`, then `delete` when you are done. The instance appears in **Systems Manager → Fleet Manager** once SSM registration completes (usually a few minutes after boot).

### Manual CloudFormation (optional)

`create` / `update` embed [`userdata.sh`](../../infra/aws/cloudformation/userdata.sh) into the template. For a raw `aws` call, render first:

```bash
./infra/aws/provision-stack.sh render > /tmp/baguette-kamal.yaml
aws cloudformation create-stack \
  --stack-name baguette-kamal \
  --template-body file:///tmp/baguette-kamal.yaml \
  --parameters file://infra/aws/parameters.json \
  --tags file://infra/aws/tags.json \
  --capabilities CAPABILITY_IAM \
  --disable-rollback
```

## GitHub Actions configuration

When the stack completes, print values to copy into the fork:

```bash
./infra/aws/provision-stack.sh outputs
```

That prints each GitHub Actions variable on its own line (`DEPLOY_SERVER=www.<DOMAIN>`, `DOMAIN=<DOMAIN>`). `DEPLOY_USER` is omitted — Kamal and the workflow default to `ubuntu`.

### Variables (Settings → Secrets and variables → Actions → **Variables**)

| Variable        | Source                                          |
| --------------- | ----------------------------------------------- |
| `DEPLOY_SERVER` | `www.<DOMAIN>` (resolves to the Elastic IP)     |
| `DOMAIN`        | Stack parameter `DomainName`                    |

### Secrets (**Secrets** tab)

| Secret                      | How to obtain                                                 |
| --------------------------- | ------------------------------------------------------------- |
| `SSH_PRIVATE_KEY`           | Deploy key on the instance — fetch via SSM (below), not SSH   |
| `AUTH_GITHUB_CLIENT_ID`     | GitHub OAuth App ([kamal.md §4](kamal.md#4-github-oauth-app)) |
| `AUTH_GITHUB_CLIENT_SECRET` | OAuth App client secret                                       |
| `ENCRYPTION_KEY`            | `openssl rand -hex 32`                                        |

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

Push to `main` to deploy, or follow [kamal.md §5.1](kamal.md#51-deploy-with-kamal) for a local `kamal deploy`.

## Operations

- **TLS renewal**: Handled on each deploy via `renew.sh` (see deploy workflow). Redeploy if the cert ages out between releases.
- **Admin shell**: `aws ssm start-session --target <InstanceId> --region <region>` (output `SsmStartSessionCommand`). Switch to `ubuntu` with `sudo su - ubuntu` if needed.
- **Resize instance / disk**: Update `parameters.json`, run `./infra/aws/provision-stack.sh update` (disk size increases may require OS steps).
- **Teardown**: `./infra/aws/provision-stack.sh delete` — deletes the instance, EIP, and Route 53 records created by the stack.

## Troubleshooting

| Symptom                                    | Check                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Stack stuck / instance running but no cert | `./infra/aws/provision-stack.sh bootstrap-logs` (or `sudo tail -f /var/log/cloud-init-output.log`); run `/home/ubuntu/acme.sh/renew.sh` as `ubuntu` |
| acme.sh install / WaitCondition FAILURE    | Installer must run in `/home/ubuntu` (it writes `master.tar.gz` to cwd). `bootstrap-logs` reads the instance id from the stack resource, not outputs (outputs only exist after `CREATE_COMPLETE`). |
| SSM target not connected                   | Instance has public egress; IAM role includes `AmazonSSMManagedInstanceCore`; wait a few minutes after boot    |
| acme DNS errors                            | `HostedZoneId` matches the zone for `DomainName`; role allows `route53:ListHostedZones` plus record changes on that zone |
| Deploy SSH fails                           | `SSH_PRIVATE_KEY` is the deploy key from SSM; security group allows SSH from GitHub Actions (`SshIngressCidr`) |
| 502 / proxy errors                         | First deploy still running; ensure `www` and wildcard DNS resolve to the Elastic IP (`dig www.<DOMAIN>`)       |

For provider-agnostic Kamal steps (OAuth, env vars, local deploy), see [kamal.md](kamal.md).
