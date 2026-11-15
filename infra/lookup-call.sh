#!/usr/bin/env bash
# Shows one model call on the AWS side, given the AWS request id stored in our agent_action_log row.
#   infra/lookup-call.sh <aws-request-id> [minutes-back, default 180]
# CloudTrail shows who called which model and when (it lags about five minutes); the invocation log
# in S3 holds the prompt and reply text for the same request id.
set -euo pipefail
RID=$1; BACK=${2:-180}
REGION=${AWS_REGION:-us-east-1}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
START=$(python3 -c "import datetime,sys; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=int(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%SZ'))" "$BACK")
echo "== CloudTrail"
for NAME in Converse ConverseStream InvokeModel InvokeModelWithResponseStream; do
  aws cloudtrail lookup-events --region "$REGION" --lookup-attributes "AttributeKey=EventName,AttributeValue=$NAME" --start-time "$START" --output json \
  | python3 -c "
import sys, json
rid = sys.argv[1]
for e in json.load(sys.stdin)['Events']:
    c = json.loads(e['CloudTrailEvent'])
    if c.get('requestID') == rid or (c.get('serviceEventDetails') or {}).get('parentRequestId') == rid:
        print(json.dumps({k: c.get(k) for k in ['eventTime', 'eventName', 'eventType', 'requestID', 'awsRegion', 'sourceIPAddress', 'requestParameters', 'additionalEventData']}, indent=2))
        print('caller:', c['userIdentity'].get('arn'))
" "$RID"
done
echo "== Invocation log (S3)"
BUCKET="datathon-bedrock-invlogs-${ACCOUNT}"
DAY=$(date -u +%Y/%m/%d)
aws s3 cp "s3://${BUCKET}/bedrock/AWSLogs/${ACCOUNT}/BedrockModelInvocationLogs/${REGION}/${DAY}/" "${TMPDIR:-/tmp}/invlogs/" --recursive --quiet || true
grep -rhs "$RID" "${TMPDIR:-/tmp}/invlogs/" 2>/dev/null | head -1 | python3 -c "
import sys, json
line = sys.stdin.readline()
if not line: print('not found yet (delivery can take a few minutes; .gz files need zgrep)'); sys.exit()
d = json.loads(line); print(json.dumps({k: d.get(k) for k in ['timestamp','requestId','operation','modelId','requestMetadata']}, indent=2)); print('identity:', d.get('identity')); print('input tokens', d['input'].get('inputTokenCount'), 'output tokens', d['output'].get('outputTokenCount'))"
