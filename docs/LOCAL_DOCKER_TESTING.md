# Local Docker Testing Guide

Test your AgentCore agent by building and running the actual Docker image locally before deployment.

## Why Docker Testing?

| Testing Mode | What It Tests | AWS Resources Needed |
|--------------|---------------|---------------------|
| `test-agent.py --local` | Python code directly via `uv run` | Memory, Gateway, SSM |
| **`test-agent-docker.py`** | **Docker image (production artifact)** | Memory, Gateway, SSM |
| `test-agent.py` (remote) | Deployed agent in AgentCore Runtime | Full deployment |

Docker testing validates:

- Dockerfile builds correctly
- Dependencies install properly in container
- Container starts and responds to health checks
- Agent works in the same containerized environment as production

## Prerequisites

1. **Docker** installed and running (`docker ps` should work)
2. **Deployed stack** - Required for Memory ID, Gateway URL, and SSM parameters
3. **AWS credentials** configured in your environment

## Quick Start

```bash
# Build and test (uses pattern from config.yaml)
python scripts/test-agent-docker.py

# Build only (verify Dockerfile without running)
python scripts/test-agent-docker.py --build-only

# Skip build, use existing image
python scripts/test-agent-docker.py --skip-build

# Test specific pattern
python scripts/test-agent-docker.py --pattern langgraph-single-agent
```

## How It Works

1. **Build**: Creates Docker image using the same Dockerfile as CDK deployment
2. **Configure**: Fetches Memory ID and Stack Name from deployed CloudFormation stack
3. **Run**: Starts container with AWS credentials passed through as environment variables
4. **Test**: Opens interactive chat session against `localhost:8080`

```
┌─────────────────────────────────────────────────────────────┐
│  Local Machine                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Docker Container (ARM64)                           │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  Agent (basic_agent.py / langgraph_agent.py)│   │   │
│  │  │  - Listens on :8080                         │   │   │
│  │  │  - Uses passed AWS credentials              │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│              http://localhost:8080/invocations              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────────┐
              │  AWS (Deployed Resources)       │
              │  - AgentCore Memory             │
              │  - AgentCore Gateway            │
              │  - SSM Parameters               │
              │  - Secrets Manager              │
              └─────────────────────────────────┘
```

## Environment Variables

The script automatically passes these to the container:

| Variable | Source | Purpose |
|----------|--------|---------|
| `MEMORY_ID` | Stack outputs | AgentCore Memory resource ID |
| `STACK_NAME` | config.yaml | SSM parameter prefix for Gateway lookup |
| `AWS_DEFAULT_REGION` | Stack | AWS region |
| `AWS_ACCESS_KEY_ID` | Local env | AWS authentication |
| `AWS_SECRET_ACCESS_KEY` | Local env | AWS authentication |
| `AWS_SESSION_TOKEN` | Local env | AWS authentication (if using temporary credentials) |

## Troubleshooting

### Build fails with "platform mismatch"

AgentCore Runtime requires ARM64 architecture. On x86/amd64 machines, enable emulation:

```bash
# One-time setup for ARM64 emulation
docker run --privileged --rm tonistiigi/binfmt --install all
```

### Container starts but agent fails

Check container logs:

```bash
# Find container ID
docker ps

# View logs
docker logs <container-id>
```

Common issues:

- **Missing AWS credentials**: Ensure `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (and `AWS_SESSION_TOKEN` if using temporary creds) are set
- **Expired session token**: Refresh your AWS credentials
- **Stack not deployed**: The script needs a deployed stack to fetch Memory ID and SSM parameters

### "Connection refused" on localhost:8080

The agent may still be starting. The script waits up to 30 seconds. If it times out:

1. Check if the container is still running: `docker ps`
2. Check logs for errors: `docker logs <container-id>`

### Gateway authentication fails

Ensure your AWS credentials have access to:

- SSM Parameter Store: `/{stack_name}/*`
- Secrets Manager: `/{stack_name}/machine_client_secret`

### ECS/EKS warnings in logs

These warnings are expected when running locally:

```
AwsEcsResourceDetector failed: Missing ECS_CONTAINER_METADATA_URI...
AwsEksResourceDetector failed: No such file or directory...
```

The OpenTelemetry instrumentation looks for ECS/EKS metadata which doesn't exist locally. These can be safely ignored.

## When to Use Each Testing Mode

| Scenario | Recommended Mode |
|----------|------------------|
| Quick iteration on agent logic | `test-agent.py --local` |
| Verify Dockerfile builds correctly | `test-agent-docker.py --build-only` |
| Full container integration test | `test-agent-docker.py` |
| Test deployed production agent | `test-agent.py` (remote) |
| CI/CD pipeline validation | `test-agent-docker.py --build-only` |

## Advanced Usage

### Manual Docker Commands

If you need more control, you can run Docker commands directly:

```bash
# Build image manually
docker build -f patterns/strands-single-agent/Dockerfile \
  -t fast-agent-local \
  --platform linux/arm64 .

# Run with explicit env vars
docker run --rm -it -p 8080:8080 \
  --platform linux/arm64 \
  -e MEMORY_ID=<your-memory-id> \
  -e STACK_NAME=<your-stack-name> \
  -e AWS_DEFAULT_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN \
  fast-agent-local

# Test with curl
curl -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello", "userId": "test", "runtimeSessionId": "test-123"}'
```

### Testing Health Endpoint

```bash
curl http://localhost:8080/ping
# Returns: {"status":"Healthy","time_of_last_update":...}
```

### Viewing Container Logs in Real-Time

```bash
# Start container in foreground (not detached)
docker run --rm -p 8080:8080 \
  --platform linux/arm64 \
  -e MEMORY_ID=<memory-id> \
  -e STACK_NAME=<stack-name> \
  -e AWS_DEFAULT_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN \
  fast-agent-local
```

## Related Documentation

- [Deployment Guide](DEPLOYMENT.md) - Full stack deployment instructions
- [Agent Configuration](AGENT_CONFIGURATION.md) - Configuring agent patterns
- [Streaming Guide](STREAMING.md) - Understanding streaming events
