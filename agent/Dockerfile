# Build from the repository root, so rules/v1.json (the single source of the never-words) is in the image:
#   docker buildx build --platform linux/arm64 -f agent/Dockerfile -t datathon-agent .
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.10.10 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1 \
    DOCKER_CONTAINER=1 \
    AWS_REGION=us-east-1

WORKDIR /srv/agent
COPY agent/pyproject.toml ./
COPY agent/app ./app
COPY agent/glossary ./glossary
COPY rules/v1.json /srv/rules/v1.json

# The otel extra adds aws-opentelemetry-distro, which sends spans to AgentCore Observability.
RUN uv pip install ".[otel]" && useradd --create-home agent
USER agent

EXPOSE 8080
CMD ["opentelemetry-instrument", "python", "-m", "app.main"]
