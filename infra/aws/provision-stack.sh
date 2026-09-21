#!/usr/bin/env bash
# Create or update the Baguette Kamal CloudFormation stack.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/cloudformation/baguette-kamal.yaml"
USERDATA_FILE="${SCRIPT_DIR}/cloudformation/userdata.sh"
STACK_NAME="${STACK_NAME:-baguette-kamal}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
PARAMETERS_FILE="${PARAMETERS_FILE:-${SCRIPT_DIR}/parameters.json}"
TAGS_FILE="${TAGS_FILE:-${SCRIPT_DIR}/tags.json}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <create|update|delete|outputs|status|bootstrap-logs|render>

  create          Create stack ${STACK_NAME} (requires ${PARAMETERS_FILE})
  update          Update an existing stack
  delete          Delete the stack
  outputs         Print GitHub Actions variables/secrets to configure
  status          Print stack status
  bootstrap-logs  Fetch /var/log/cloud-init-output.log from the instance via SSM
  render          Print the template with userdata.sh embedded (stdout)

Environment:
  STACK_NAME        CloudFormation stack name (default: baguette-kamal)
  AWS_REGION        AWS region (default: us-east-1 or AWS_DEFAULT_REGION)
  PARAMETERS_FILE   JSON parameters file (default: infra/aws/parameters.json)
  TAGS_FILE         Optional stack tags JSON (default: infra/aws/tags.json if present)

Copy parameters.example.json to parameters.json and edit before create.
Optional extra tags: copy tags.example.json to tags.json (propagated to taggable resources).
EOF
}

require_parameters_file() {
  if [[ ! -f "${PARAMETERS_FILE}" ]]; then
    echo "Missing ${PARAMETERS_FILE}. Copy parameters.example.json and fill in values." >&2
    exit 1
  fi
}

# Embed userdata.sh into baguette-kamal.yaml (@@USERDATA@@). Writes to dest,
# or stdout when dest is "-" / omitted.
render_template() {
  local dest="${1:-}"
  if [[ ! -f "${USERDATA_FILE}" ]]; then
    echo "Missing ${USERDATA_FILE}" >&2
    exit 1
  fi
  if ! grep -q '@@USERDATA@@' "${TEMPLATE}"; then
    echo "missing @@USERDATA@@ in ${TEMPLATE}" >&2
    exit 1
  fi

  local awk_prog='
    BEGIN {
      while ((getline line < userdata) > 0) {
        script[n++] = line
      }
      close(userdata)
    }
    /@@USERDATA@@/ && !done {
      match($0, /^ */)
      indent = substr($0, 1, RLENGTH)
      for (i = 0; i < n; i++) {
        if (script[i] == "") print ""
        else print indent script[i]
      }
      done = 1
      next
    }
    { print }
  '

  if [[ -z "${dest}" || "${dest}" == "-" ]]; then
    awk -v userdata="${USERDATA_FILE}" "${awk_prog}" "${TEMPLATE}"
  else
    awk -v userdata="${USERDATA_FILE}" "${awk_prog}" "${TEMPLATE}" > "${dest}"
  fi
}

cmd_create() {
  require_parameters_file
  local template extra=()
  template="$(mktemp)"
  render_template "${template}"
  if [[ -f "${TAGS_FILE}" ]]; then
    extra+=(--tags "file://${TAGS_FILE}")
  fi
  aws cloudformation create-stack \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --template-body "file://${template}" \
    --parameters "file://${PARAMETERS_FILE}" \
    --capabilities CAPABILITY_IAM \
    --disable-rollback \
    "${extra[@]}"
  rm -f "${template}"
  echo "Waiting for stack CREATE_COMPLETE (bootstrap + certs, up to 25 minutes)..."
  wait_stack stack-create-complete
  cmd_outputs
}

cmd_update() {
  require_parameters_file
  local template extra=()
  template="$(mktemp)"
  render_template "${template}"
  if [[ -f "${TAGS_FILE}" ]]; then
    extra+=(--tags "file://${TAGS_FILE}")
  fi
  aws cloudformation update-stack \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --template-body "file://${template}" \
    --parameters "file://${PARAMETERS_FILE}" \
    --capabilities CAPABILITY_IAM \
    "${extra[@]}"
  rm -f "${template}"
  echo "Waiting for stack UPDATE_COMPLETE (instance replacement re-runs bootstrap, up to 25 minutes)..."
  wait_stack stack-update-complete
  cmd_outputs
}

cmd_delete() {
  aws cloudformation delete-stack --region "${AWS_REGION}" --stack-name "${STACK_NAME}"
  echo "Waiting for stack DELETE_COMPLETE..."
  aws cloudformation wait stack-delete-complete --region "${AWS_REGION}" --stack-name "${STACK_NAME}"
}

wait_stack() {
  local waiter="$1"
  if aws cloudformation wait "${waiter}" --region "${AWS_REGION}" --stack-name "${STACK_NAME}"; then
    return 0
  fi
  echo "Stack ${waiter} failed. Recent events:" >&2
  aws cloudformation describe-stack-events \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --query 'StackEvents[:20].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
    --output table >&2 || true
  echo >&2
  echo "Trying to fetch instance bootstrap log via SSM..." >&2
  cmd_bootstrap_logs || true
  echo "Create uses --disable-rollback so a failed instance is kept for inspection." >&2
  echo "After debugging: ./infra/aws/provision-stack.sh delete" >&2
  exit 1
}

stack_output() {
  aws cloudformation describe-stacks \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='${1}'].OutputValue" \
    --output text
}

# Outputs are empty until the stack is complete. The instance id is on the
# resource as soon as EC2 allocates it (including CREATE_FAILED / wait timeout).
stack_instance_id() {
  local id
  id="$(aws cloudformation describe-stack-resource \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --logical-resource-id BaguetteInstance \
    --query 'StackResourceDetail.PhysicalResourceId' \
    --output text 2>/dev/null || true)"
  if [[ -n "${id}" && "${id}" != "None" && "${id}" == i-* ]]; then
    printf '%s\n' "${id}"
    return 0
  fi
  id="$(stack_output InstanceId)"
  if [[ -n "${id}" && "${id}" != "None" ]]; then
    printf '%s\n' "${id}"
    return 0
  fi
  return 1
}

ssm_run() {
  local instance_id="$1"
  local command="$2"
  local cmd_id
  cmd_id="$(aws ssm send-command \
    --region "${AWS_REGION}" \
    --instance-ids "${instance_id}" \
    --document-name AWS-RunShellScript \
    --parameters "commands=[\"${command}\"]" \
    --query 'Command.CommandId' --output text)"
  aws ssm wait command-executed \
    --command-id "${cmd_id}" --instance-id "${instance_id}" --region "${AWS_REGION}"
  aws ssm get-command-invocation \
    --command-id "${cmd_id}" --instance-id "${instance_id}" --region "${AWS_REGION}" \
    --query '[StandardOutputContent,StandardErrorContent]' --output text
}

cmd_bootstrap_logs() {
  local instance_id
  if ! instance_id="$(stack_instance_id)"; then
    echo "Could not find BaguetteInstance on stack ${STACK_NAME}." >&2
    return 1
  fi
  echo "Fetching /var/log/cloud-init-output.log from ${instance_id}..."
  ssm_run "${instance_id}" "tail -n 250 /var/log/cloud-init-output.log"
}

cmd_outputs() {
  local deploy_server domain instance_id www_url elastic_ip
  deploy_server="$(stack_output DeployServer)"
  domain="$(stack_output Domain)"
  instance_id="$(stack_output InstanceId)"
  www_url="$(stack_output WwwUrl)"
  elastic_ip="$(stack_output ElasticIp)"

  echo
  echo "Configure GitHub Actions"
  echo "  Settings → Secrets and variables → Actions"
  echo
  echo "Variables"
  echo "  DEPLOY_SERVER=${deploy_server}"
  echo "  DOMAIN=${domain}"
  echo
  echo "Secrets"
  echo "  SSH_PRIVATE_KEY            contents of /home/ubuntu/.ssh/id_ed25519 (command below)"
  echo "  AUTH_GITHUB_CLIENT_ID      GitHub OAuth App client ID"
  echo "  AUTH_GITHUB_CLIENT_SECRET  GitHub OAuth App client secret"
  echo "  ENCRYPTION_KEY             openssl rand -hex 32"
  echo
  echo "Fetch SSH_PRIVATE_KEY (paste the full key, including BEGIN/END lines)"
  echo "  CMD_ID=\$(aws ssm send-command --region ${AWS_REGION} --instance-ids ${instance_id} \\"
  echo "    --document-name AWS-RunShellScript \\"
  echo "    --parameters 'commands=[\"cat /home/ubuntu/.ssh/id_ed25519\"]' \\"
  echo "    --query 'Command.CommandId' --output text)"
  echo "  aws ssm wait command-executed --command-id \"\$CMD_ID\" --instance-id ${instance_id} --region ${AWS_REGION}"
  echo "  aws ssm get-command-invocation --command-id \"\$CMD_ID\" --instance-id ${instance_id} --region ${AWS_REGION} \\"
  echo "    --query 'StandardOutputContent' --output text"
  echo
  echo "After deploy  ${www_url}"
  echo "Admin shell   aws ssm start-session --target ${instance_id} --region ${AWS_REGION}"
  echo "Elastic IP    ${elastic_ip}"
}

cmd_status() {
  aws cloudformation describe-stacks \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --query 'Stacks[0].StackStatus' \
    --output text
}

main() {
  local sub="${1:-}"
  case "${sub}" in
    create) cmd_create ;;
    update) cmd_update ;;
    delete) cmd_delete ;;
    outputs) cmd_outputs ;;
    status) cmd_status ;;
    bootstrap-logs) cmd_bootstrap_logs ;;
    render) render_template - ;;
    -h | --help | help) usage ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
