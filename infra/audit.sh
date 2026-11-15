#!/usr/bin/env bash
# One-time setup of the AWS-side audit trail for model calls (spec section 9, "Audit trail"):
#   layer 2: a CloudTrail trail with log file integrity validation and data events for Guardrails,
#            Knowledge Bases and AgentCore Runtime (model calls themselves are management events);
#   layer 3: Bedrock model invocation logging (full prompt and reply text) to S3;
#   plus the Bedrock Guardrail in infra/guardrail.json.
set -euo pipefail
cd "$(dirname "$0")"
REGION=${AWS_REGION:-us-east-1}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
CT_BUCKET="datathon-cloudtrail-${ACCOUNT}"
IL_BUCKET="datathon-bedrock-invlogs-${ACCOUNT}"
TRAIL=datathon-llm-audit
TMP=$(mktemp -d)

for B in "$CT_BUCKET" "$IL_BUCKET"; do
  aws s3api head-bucket --bucket "$B" 2>/dev/null || aws s3api create-bucket --bucket "$B" --region "$REGION" >/dev/null
  aws s3api put-public-access-block --bucket "$B" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
done

cat > "$TMP/ct.json" <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"AWSCloudTrailAclCheck","Effect":"Allow","Principal":{"Service":"cloudtrail.amazonaws.com"},"Action":"s3:GetBucketAcl","Resource":"arn:aws:s3:::${CT_BUCKET}","Condition":{"StringEquals":{"aws:SourceAccount":"${ACCOUNT}"}}},
 {"Sid":"AWSCloudTrailWrite","Effect":"Allow","Principal":{"Service":"cloudtrail.amazonaws.com"},"Action":"s3:PutObject","Resource":"arn:aws:s3:::${CT_BUCKET}/AWSLogs/${ACCOUNT}/*","Condition":{"StringEquals":{"s3:x-amz-acl":"bucket-owner-full-control","aws:SourceAccount":"${ACCOUNT}"}}}]}
JSON
aws s3api put-bucket-policy --bucket "$CT_BUCKET" --policy "file://$TMP/ct.json"
aws cloudtrail get-trail --name "$TRAIL" --region "$REGION" >/dev/null 2>&1 || \
  aws cloudtrail create-trail --name "$TRAIL" --s3-bucket-name "$CT_BUCKET" --enable-log-file-validation --region "$REGION" >/dev/null
aws cloudtrail put-event-selectors --trail-name "$TRAIL" --region "$REGION" --advanced-event-selectors '[
 {"Name":"Management","FieldSelectors":[{"Field":"eventCategory","Equals":["Management"]}]},
 {"Name":"KnowledgeBase","FieldSelectors":[{"Field":"eventCategory","Equals":["Data"]},{"Field":"resources.type","Equals":["AWS::Bedrock::KnowledgeBase"]}]},
 {"Name":"Guardrail","FieldSelectors":[{"Field":"eventCategory","Equals":["Data"]},{"Field":"resources.type","Equals":["AWS::Bedrock::Guardrail"]}]},
 {"Name":"AgentCoreRuntime","FieldSelectors":[{"Field":"eventCategory","Equals":["Data"]},{"Field":"resources.type","Equals":["AWS::BedrockAgentCore::Runtime"]}]}]' >/dev/null
aws cloudtrail start-logging --name "$TRAIL" --region "$REGION"

cat > "$TMP/il.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Sid":"AmazonBedrockLogsWrite","Effect":"Allow","Principal":{"Service":"bedrock.amazonaws.com"},"Action":["s3:PutObject"],"Resource":["arn:aws:s3:::${IL_BUCKET}/bedrock/AWSLogs/${ACCOUNT}/BedrockModelInvocationLogs/*"],"Condition":{"StringEquals":{"aws:SourceAccount":"${ACCOUNT}"},"ArnLike":{"aws:SourceArn":"arn:aws:bedrock:${REGION}:${ACCOUNT}:*"}}}]}
JSON
aws s3api put-bucket-policy --bucket "$IL_BUCKET" --policy "file://$TMP/il.json"
aws bedrock put-model-invocation-logging-configuration --region "$REGION" --logging-config \
  "{\"s3Config\":{\"bucketName\":\"${IL_BUCKET}\",\"keyPrefix\":\"bedrock\"},\"textDataDeliveryEnabled\":true,\"imageDataDeliveryEnabled\":false,\"embeddingDataDeliveryEnabled\":false}"

GUARDRAIL=$(aws bedrock list-guardrails --region "$REGION" --query "guardrails[?name=='datathon-no-advice'].id | [0]" --output text)
if [ "$GUARDRAIL" = "None" ]; then
  GUARDRAIL=$(aws bedrock create-guardrail --region "$REGION" --cli-input-json file://guardrail.json --query guardrailId --output text)
  sleep 5
  aws bedrock create-guardrail-version --region "$REGION" --guardrail-identifier "$GUARDRAIL" >/dev/null
fi
echo "trail $TRAIL, invocation logs s3://$IL_BUCKET/bedrock/, guardrail $GUARDRAIL"
