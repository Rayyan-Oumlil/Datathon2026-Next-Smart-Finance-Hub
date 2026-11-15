#!/usr/bin/env bash
# Builds the web image, pushes it to ECR and (re)deploys the ECS Fargate service behind the load balancer.
# Run infra/ecs-base.sh once first; it writes infra/outputs.env.
set -euo pipefail
cd "$(dirname "$0")/.."
. infra/outputs.env
TAG=${1:-$(git rev-parse --short HEAD)}
IMAGE="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/datathon-web:${TAG}"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com" >/dev/null
docker buildx build --platform linux/amd64 -t "$IMAGE" --push .

TMP=$(mktemp -d)
cat > "$TMP/task.json" <<JSON
{
  "family": "datathon-web",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "runtimePlatform": {"cpuArchitecture": "X86_64", "operatingSystemFamily": "LINUX"},
  "executionRoleArn": "arn:aws:iam::${ACCOUNT}:role/datathon-web-exec",
  "taskRoleArn": "arn:aws:iam::${ACCOUNT}:role/datathon-web-task",
  "containerDefinitions": [{
    "name": "web",
    "image": "${IMAGE}",
    "essential": true,
    "portMappings": [{"containerPort": 3000, "protocol": "tcp"}],
    "environment": [
      {"name": "AWS_REGION", "value": "${REGION}"},
      {"name": "APP_URL", "value": "${WEB_URL}"},
      {"name": "AGENT_RUNTIME_ARN", "value": "${AGENT_RUNTIME_ARN:-}"},
      {"name": "STORE_BACKEND", "value": "dynamodb"},
      {"name": "DEMO_USER_ID", "value": "${DEMO_USER_ID:-demo-live-1}"}
    ],
    "secrets": [
      {"name": "FINNHUB_API_KEY", "valueFrom": "${SECRET_ARN}:FINNHUB_API_KEY::"},
      {"name": "ADANOS_API_KEY", "valueFrom": "${SECRET_ARN}:ADANOS_API_KEY::"},
      {"name": "INTERNAL_API_TOKEN", "valueFrom": "${SECRET_ARN}:INTERNAL_API_TOKEN::"}
    ],
    "logConfiguration": {"logDriver": "awslogs", "options": {"awslogs-group": "/ecs/datathon-web", "awslogs-region": "${REGION}", "awslogs-stream-prefix": "web"}}
  }]
}
JSON
TASK_ARN=$(aws ecs register-task-definition --region "$REGION" --cli-input-json "file://$TMP/task.json" --query 'taskDefinition.taskDefinitionArn' --output text)
SUBNET_CSV=$(echo $SUBNETS | tr ' \t' ',,' | sed 's/,,*/,/g')
if [ "$(aws ecs describe-services --region "$REGION" --cluster datathon --services datathon-web --query 'services[0].status' --output text 2>/dev/null)" = "ACTIVE" ]; then
  aws ecs update-service --region "$REGION" --cluster datathon --service datathon-web --task-definition "$TASK_ARN" --force-new-deployment >/dev/null
else
  aws ecs create-service --region "$REGION" --cluster datathon --service-name datathon-web --task-definition "$TASK_ARN" --desired-count 1 --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_CSV}],securityGroups=[${WEB_SG}],assignPublicIp=ENABLED}" \
    --load-balancers "targetGroupArn=${TG_ARN},containerName=web,containerPort=3000" --health-check-grace-period-seconds 60 >/dev/null
fi
echo "deploying ${IMAGE}; waiting for the service to settle"
aws ecs wait services-stable --region "$REGION" --cluster datathon --services datathon-web
echo "live at ${WEB_URL}"
