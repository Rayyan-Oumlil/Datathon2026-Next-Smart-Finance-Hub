#!/usr/bin/env bash
# One-time AWS setup for the web app on ECS Fargate: roles, secret, security groups, load balancer.
# Safe to re-run: each step looks for the resource first. Reads secrets from ../.env and never prints them.
set -euo pipefail
cd "$(dirname "$0")/.."
REGION=${AWS_REGION:-us-east-1}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
NAME=datathon
set -a; . ./.env; set +a
TMP=$(mktemp -d)
# Git Bash on Windows: the AWS CLI (a Windows program) cannot open /tmp/... paths, so use the C:/... spelling there
TMP=$(cygpath -m "$TMP" 2>/dev/null || echo "$TMP")

echo "== secret"
SECRET_JSON=$(python3 - <<PY
import json, os
print(json.dumps({k: os.environ.get(k, "") for k in ["FINNHUB_API_KEY", "ADANOS_API_KEY", "INTERNAL_API_TOKEN", "SESSION_SECRET"]}))
PY
)
if aws secretsmanager describe-secret --region "$REGION" --secret-id "${NAME}/web" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --region "$REGION" --secret-id "${NAME}/web" --secret-string "$SECRET_JSON" >/dev/null
else
  aws secretsmanager create-secret --region "$REGION" --name "${NAME}/web" --secret-string "$SECRET_JSON" >/dev/null
fi
SECRET_ARN=$(aws secretsmanager describe-secret --region "$REGION" --secret-id "${NAME}/web" --query ARN --output text)

echo "== roles"
cat > "$TMP/trust.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
for ROLE in "${NAME}-web-exec" "${NAME}-web-task"; do
  aws iam get-role --role-name "$ROLE" >/dev/null 2>&1 || aws iam create-role --role-name "$ROLE" --assume-role-policy-document "file://$TMP/trust.json" >/dev/null
done
aws iam attach-role-policy --role-name "${NAME}-web-exec" --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
cat > "$TMP/exec.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["secretsmanager:GetSecretValue"],"Resource":"${SECRET_ARN}"}]}
JSON
aws iam put-role-policy --role-name "${NAME}-web-exec" --policy-name read-secret --policy-document "file://$TMP/exec.json"
# The task may read and append, never update or delete log rows: no UpdateItem or DeleteItem on the two logs.
cat > "$TMP/task.json" <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"Profile","Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:PutItem","dynamodb:Query"],"Resource":"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/profile_config"},
 {"Sid":"AppendOnlyLogs","Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:PutItem","dynamodb:Query"],"Resource":["arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/decision_log","arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/agent_action_log","arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/agent_action_log/index/*"]},
 {"Sid":"Agent","Effect":"Allow","Action":["bedrock-agentcore:InvokeAgentRuntime"],"Resource":"*"},
 {"Sid":"VoiceInput","Effect":"Allow","Action":["transcribe:StartStreamTranscriptionWebSocket"],"Resource":"*"},
 {"Sid":"VoiceOutput","Effect":"Allow","Action":["polly:SynthesizeSpeech"],"Resource":"*"}]}
JSON
aws iam put-role-policy --role-name "${NAME}-web-task" --policy-name app --policy-document "file://$TMP/task.json"

echo "== network"
VPC=$(aws ec2 describe-vpcs --region "$REGION" --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNETS=$(aws ec2 describe-subnets --region "$REGION" --filters "Name=vpc-id,Values=$VPC" Name=default-for-az,Values=true --query 'Subnets[].SubnetId' --output text)
sg() { aws ec2 describe-security-groups --region "$REGION" --filters "Name=vpc-id,Values=$VPC" "Name=group-name,Values=$1" --query 'SecurityGroups[0].GroupId' --output text; }
ALB_SG=$(sg "${NAME}-alb"); if [ "$ALB_SG" = "None" ]; then
  ALB_SG=$(aws ec2 create-security-group --region "$REGION" --vpc-id "$VPC" --group-name "${NAME}-alb" --description "datathon load balancer" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$ALB_SG" --protocol tcp --port 80 --cidr 0.0.0.0/0 >/dev/null
fi
WEB_SG=$(sg "${NAME}-web"); if [ "$WEB_SG" = "None" ]; then
  WEB_SG=$(aws ec2 create-security-group --region "$REGION" --vpc-id "$VPC" --group-name "${NAME}-web" --description "datathon web tasks" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$WEB_SG" --protocol tcp --port 3000 --source-group "$ALB_SG" >/dev/null
fi

echo "== load balancer"
ALB_ARN=$(aws elbv2 describe-load-balancers --region "$REGION" --names "${NAME}-web" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)
if [ -z "$ALB_ARN" ] || [ "$ALB_ARN" = "None" ]; then
  # shellcheck disable=SC2086
  ALB_ARN=$(aws elbv2 create-load-balancer --region "$REGION" --name "${NAME}-web" --type application --scheme internet-facing --subnets $SUBNETS --security-groups "$ALB_SG" --query 'LoadBalancers[0].LoadBalancerArn' --output text)
fi
# The agent stream stays open for up to two minutes; the default idle timeout is 60 s. Runs on every call, so an
# existing load balancer gets it too.
aws elbv2 modify-load-balancer-attributes --region "$REGION" --load-balancer-arn "$ALB_ARN" --attributes Key=idle_timeout.timeout_seconds,Value=300 >/dev/null
TG_ARN=$(aws elbv2 describe-target-groups --region "$REGION" --names "${NAME}-web" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
if [ -z "$TG_ARN" ] || [ "$TG_ARN" = "None" ]; then
  TG_ARN=$(aws elbv2 create-target-group --region "$REGION" --name "${NAME}-web" --protocol HTTP --port 3000 --vpc-id "$VPC" --target-type ip --health-check-path /api/health --health-check-interval-seconds 15 --healthy-threshold-count 2 --query 'TargetGroups[0].TargetGroupArn' --output text)
  aws elbv2 modify-target-group-attributes --region "$REGION" --target-group-arn "$TG_ARN" --attributes Key=deregistration_delay.timeout_seconds,Value=15 >/dev/null
fi
LISTENER=$(aws elbv2 describe-listeners --region "$REGION" --load-balancer-arn "$ALB_ARN" --query 'Listeners[0].ListenerArn' --output text)
if [ "$LISTENER" = "None" ]; then
  aws elbv2 create-listener --region "$REGION" --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 --default-actions "Type=forward,TargetGroupArn=$TG_ARN" >/dev/null
fi
aws logs create-log-group --region "$REGION" --log-group-name "/ecs/${NAME}-web" 2>/dev/null || true
DNS=$(aws elbv2 describe-load-balancers --region "$REGION" --load-balancer-arns "$ALB_ARN" --query 'LoadBalancers[0].DNSName' --output text)

# The AgentCore runtime is created once by hand (see README); look its ARN up so a re-run keeps it
AGENT_RUNTIME_ARN=$(aws bedrock-agentcore-control list-agent-runtimes --region "$REGION" --query "agentRuntimes[?agentRuntimeName=='datathon_agent'].agentRuntimeArn | [0]" --output text 2>/dev/null || true)
[ "$AGENT_RUNTIME_ARN" = "None" ] && AGENT_RUNTIME_ARN=""

# The HTTPS address: a CloudFront distribution in front of the load balancer (created once from infra/cloudfront.json
# with `aws cloudfront create-distribution --distribution-config file://infra/cloudfront.json`). Without one, the
# public address is the load balancer's plain-HTTP one, and voice input stays off (browsers need HTTPS for the microphone).
CF_DOMAIN=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment!=null && contains(Comment, 'datathon web app')].DomainName | [0]" --output text 2>/dev/null || true)
if [ -n "$CF_DOMAIN" ] && [ "$CF_DOMAIN" != "None" ]; then PUBLIC_URL="https://$CF_DOMAIN"; else PUBLIC_URL="http://$DNS"; fi

cat > infra/outputs.env <<OUT
REGION=$REGION
ACCOUNT=$ACCOUNT
VPC=$VPC
SUBNETS="$SUBNETS"
ALB_SG=$ALB_SG
WEB_SG=$WEB_SG
ALB_ARN=$ALB_ARN
TG_ARN=$TG_ARN
SECRET_ARN=$SECRET_ARN
WEB_URL=http://$DNS
AGENT_RUNTIME_ARN=$AGENT_RUNTIME_ARN
PUBLIC_URL=$PUBLIC_URL
OUT
echo "done: $PUBLIC_URL (load balancer: http://$DNS)"
