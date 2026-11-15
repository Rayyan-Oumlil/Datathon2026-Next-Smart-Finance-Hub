#!/usr/bin/env bash
# Creates the agent's Amazon Bedrock AgentCore Memory once and prints its id. Run it again: it finds the existing
# memory by name and prints the same id. Then add MEMORY_ID=<id> to infra/outputs.env and run infra/deploy-agent.sh.
#
# Short-term memory: the conversation events (each user message and the reply the user was shown), kept 30 days.
# Long-term: one built-in user-preference strategy, written under /users/{actorId}/preferences. The agent reads it
# only when MEMORY_PREFERENCES=1 is set on the runtime. Built-in strategies need no execution role.
set -euo pipefail
cd "$(dirname "$0")/.."
. infra/outputs.env
REGION=${REGION:-${AWS_REGION:-us-east-1}}
NAME=${MEMORY_NAME:-datathon_agent_memory}

existing=$(aws bedrock-agentcore-control list-memories --region "$REGION" --output json \
  --query "memories[?starts_with(id, '${NAME}-')].id | [0]" | tr -d '"')
if [ -n "$existing" ] && [ "$existing" != "null" ]; then
  echo "Memory already exists." >&2
  id=$existing
else
  id=$(aws bedrock-agentcore-control create-memory --region "$REGION" \
    --name "$NAME" \
    --description "Next Smart Finance Hub agent: conversation turns (user message and checked reply) and user preferences" \
    --event-expiry-duration 30 \
    --memory-strategies '[{"userPreferenceMemoryStrategy":{"name":"UserPreferences","description":"Display and layout preferences the user states","namespaces":["/users/{actorId}/preferences"]}}]' \
    --query "memory.id" --output text)
  echo "Created; waiting until it is ACTIVE..." >&2
fi

for _ in $(seq 1 60); do
  status=$(aws bedrock-agentcore-control get-memory --region "$REGION" --memory-id "$id" --query "memory.status" --output text)
  [ "$status" = "ACTIVE" ] && break
  [ "$status" = "FAILED" ] && { echo "Memory $id failed to create." >&2; exit 1; }
  sleep 5
done
echo "Status: $status" >&2
echo "Add to infra/outputs.env:  MEMORY_ID=$id" >&2
echo "$id"
