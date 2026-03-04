# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    DOCKER_CONTAINER=1 \
    OTEL_PYTHON_LOG_CORRELATION=true \
    PYTHONUNBUFFERED=1 \
    CLAUDE_CODE_USE_BEDROCK=1

# Install Node.js for claude-code CLI
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install claude-code globally
RUN npm install -g @anthropic-ai/claude-code

# Copy pyproject.toml and shared modules for FAST installation
COPY pyproject.toml .
COPY gateway/ gateway/
COPY tools/ tools/

# Copy and install agent-specific requirements
COPY patterns/claude-agent-sdk/requirements.txt requirements.txt
RUN uv pip install --no-cache -r requirements.txt && \
    uv pip install --no-cache aws-opentelemetry-distro==0.10.1

# Install FAST package with only core dependencies
RUN uv pip install --no-cache -e . --no-deps && \
    uv pip install --no-cache requests>=2.31.0

# Create non-root user and ensure claude config dir is writable
RUN useradd -m -u 1000 bedrock_agentcore && \
    mkdir -p /home/bedrock_agentcore/.claude && \
    chown -R bedrock_agentcore:bedrock_agentcore /home/bedrock_agentcore/.claude
USER bedrock_agentcore

ENV CLAUDE_CONFIG_DIR=/home/bedrock_agentcore/.claude

EXPOSE 8080

# Copy agent code files
COPY patterns/claude-agent-sdk/agent.py .
COPY patterns/claude-agent-sdk/code_int_mcp/ code_int_mcp/
COPY patterns/claude-agent-sdk/agents/ agents/
COPY patterns/utils/ utils/

# Healthcheck using Python
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/ping', timeout=2)" || exit 1

# Start agent with OpenTelemetry instrumentation
CMD ["opentelemetry-instrument", "python", "-m", "agent"]
