"""Bedrock models, and the botocore hooks that tie every model call to the action id.

Strands does not hand back the AWS request id, so two hooks are registered on the boto3
client each BedrockModel uses:
  - provide-client-params: adds requestMetadata {"action_id": ...} to the Converse request
    and keeps a hash of the prompt;
  - after-call: reads the request id and token counts from the response and writes the
    orchestrator_call / subagent_call row.
Calls are made with Converse (not ConverseStream), so the response carries the token counts
and CloudTrail holds exactly one event per call.
"""
from functools import lru_cache

import boto3
from botocore.config import Config
from strands.models import BedrockModel

from . import config, trace

OPERATIONS = ("Converse", "ConverseStream")


def _before_call(params, context, **_):
    current = trace.current_or_none()
    if current is None:
        return None
    params = {**params, "requestMetadata": {**params.get("requestMetadata", {}), "action_id": current.action_id}}
    context["audit"] = {
        "modelId": params.get("modelId"),
        "promptSha256": trace.sha256({"system": params.get("system"), "messages": params.get("messages")}),
    }
    return params


def _after_call(parsed, context, **_):
    current = trace.current_or_none()
    audit = context.get("audit")
    if current is None or audit is None:
        return
    actor = trace.current_actor()
    usage = parsed.get("usage") or {}
    call = {
        "actor": actor,
        "modelId": audit["modelId"],
        "awsRequestId": parsed.get("ResponseMetadata", {}).get("RequestId"),
        "inputTokens": usage.get("inputTokens"),
        "outputTokens": usage.get("outputTokens"),
    }
    error = parsed.get("Error")
    if error:
        current.log("error", actor, modelId=call["modelId"], awsRequestId=call["awsRequestId"],
                    promptSha256=audit["promptSha256"], result={"error": error.get("Code")})
        return
    current.model_calls.append(call)
    reply = (parsed.get("output") or {}).get("message")
    current.log("orchestrator_call" if actor == "orchestrator" else "subagent_call", actor,
                modelId=call["modelId"], awsRequestId=call["awsRequestId"],
                inputTokens=call["inputTokens"], outputTokens=call["outputTokens"],
                promptSha256=audit["promptSha256"], replySha256=trace.sha256(reply) if reply else None,
                result={"stopReason": parsed.get("stopReason")})


def register_audit_hooks(client) -> None:
    for operation in OPERATIONS:
        client.meta.events.register(f"provide-client-params.bedrock-runtime.{operation}", _before_call)
        client.meta.events.register(f"after-call.bedrock-runtime.{operation}", _after_call)


def _model(model_id: str, max_tokens: int) -> BedrockModel:
    model = BedrockModel(
        model_id=model_id,
        region_name=config.region(),
        max_tokens=max_tokens,
        streaming=False,
        boto_client_config=Config(read_timeout=180, connect_timeout=5, retries={"max_attempts": 3}),
    )
    register_audit_hooks(model.client)
    return model


@lru_cache(maxsize=None)
def orchestrator_model() -> BedrockModel:
    return _model(config.orchestrator_model_id(), 3000)


@lru_cache(maxsize=None)
def subagent_model() -> BedrockModel:
    return _model(config.subagent_model_id(), 2000)


@lru_cache(maxsize=None)
def runtime_client():
    """bedrock-runtime client for ApplyGuardrail."""
    return boto3.client("bedrock-runtime", region_name=config.region(),
                        config=Config(read_timeout=30, connect_timeout=5))


@lru_cache(maxsize=None)
def kb_client():
    return boto3.client("bedrock-agent-runtime", region_name=config.region())
