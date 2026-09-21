#!/usr/bin/env bash
# Create or update the Baguette Kamal CloudFormation stack.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/cloudformation/baguette-kamal.yaml"
STACK_NAME="${STACK_NAME:-baguette-kamal}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
PARAMETERS_FILE="${PARAMETERS_FILE:-${SCRIPT_DIR}/parameters.json}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <create|update|delete|outputs|status>

  create   Create stack ${STACK_NAME} (requires ${PARAMETERS_FILE})
  update   Update an existing stack
  delete   Delete the stack
  outputs  Print CloudFormation outputs (CI env hints)
  status   Print stack status

Environment:
  STACK_NAME        CloudFormation stack name (default: baguette-kamal)
  AWS_REGION        AWS region (default: us-east-1 or AWS_DEFAULT_REGION)
  PARAMETERS_FILE   JSON parameters file (default: infra/aws/parameters.json)

Copy parameters.example.json to parameters.json and edit before create.
EOF
}

require_parameters_file() {
  if [[ ! -f "${PARAMETERS_FILE}" ]]; then
    echo "Missing ${PARAMETERS_FILE}. Copy parameters.example.json and fill in values." >&2
    exit 1
  fi
}

cmd_create() {
  require_parameters_file
  aws cloudformation create-stack \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --template-body "file://${TEMPLATE}" \
    --parameters "file://${PARAMETERS_FILE}" \
    --capabilities CAPABILITY_IAM
  echo "Waiting for stack CREATE_COMPLETE (initial cert issuance can take several minutes)..."
  aws cloudformation wait stack-create-complete --region "${AWS_REGION}" --stack-name "${STACK_NAME}"
  cmd_outputs
}

cmd_update() {
  require_parameters_file
  aws cloudformation update-stack \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --template-body "file://${TEMPLATE}" \
    --parameters "file://${PARAMETERS_FILE}" \
    --capabilities CAPABILITY_IAM
  echo "Waiting for stack UPDATE_COMPLETE..."
  aws cloudformation wait stack-update-complete --region "${AWS_REGION}" --stack-name "${STACK_NAME}"
  cmd_outputs
}

cmd_delete() {
  aws cloudformation delete-stack --region "${AWS_REGION}" --stack-name "${STACK_NAME}"
  echo "Waiting for stack DELETE_COMPLETE..."
  aws cloudformation wait stack-delete-complete --region "${AWS_REGION}" --stack-name "${STACK_NAME}"
}

cmd_outputs() {
  aws cloudformation describe-stacks \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --query 'Stacks[0].Outputs' \
    --output table
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
    -h | --help | help) usage ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
