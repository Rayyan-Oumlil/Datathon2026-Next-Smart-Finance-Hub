#!/usr/bin/env bash
# Builds the agent image (arm64), pushes it to ECR and updates the AgentCore runtime.
# The runtime and its role (datathon-agent-runtime-role) were created once by hand; see infra/README.md.
# MEMORY_ID (from infra/agent-memory.sh, kept in infra/outputs.env) turns on AgentCore Memory; empty leaves it off.
set -euo pipefail
cd "$(dirname "$0")/.."
. infra/outputs.env
set -a; . ./.env; set +a
TAG=${1:-$(git rev-parse --short HEAD)}
IMAGE="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/datathon-agent:${TAG}"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com" >/dev/null
docker buildx build --platform linux/arm64 -f agent/Dockerfile -t "$IMAGE" --push .
aws bedrock-agentcore-control update-agent-runtime --region "$REGION" --agent-runtime-id "${AGENT_RUNTIME_ARN##*/}" \
  --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"${IMAGE}\"}}" \
  --role-arn "arn:aws:iam::${ACCOUNT}:role/datathon-agent-runtime-role" \
  --network-configuration '{"networkMode":"PUBLIC"}' --protocol-configuration '{"serverProtocol":"HTTP"}' \
  --environment-variables "AWS_REGION=${REGION},GUARDRAIL_ID=${GUARDRAIL_ID},GUARDRAIL_VERSION=${GUARDRAIL_VERSION},INTERNAL_API_TOKEN=${INTERNAL_API_TOKEN},WEB_INTERNAL_URL=${PUBLIC_URL:-$WEB_URL}${MEMORY_ID:+,MEMORY_ID=$MEMORY_ID}${MEMORY_PREFERENCES:+,MEMORY_PREFERENCES=$MEMORY_PREFERENCES}" \
  --query status --output text
