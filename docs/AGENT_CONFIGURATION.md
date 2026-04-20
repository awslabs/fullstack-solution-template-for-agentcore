# Agent Configuration Guide

FAST supports any agent framework that can run in a container. This guide covers how to use existing patterns, create your own, and configure agent behavior.

---

## Existing Patterns

### Strands Single Agent Pattern

**Location**: `patterns/strands-single-agent/`

A basic conversational agent using the Strands framework with AgentCore Memory integration.

**What This Agent Does**:

- Multi-turn conversational chat
- Maintains conversation history with short-term memory
- **Optional long-term memory**: When `use_long_term_memory: true` is set in `config.yaml`, the agent uses a `SemanticMemoryStrategy` to extract and recall facts across sessions (keyed by Cognito user ID). See [Memory Integration Guide](MEMORY_INTEGRATION.md#enabling-long-term-memory) for details.
- Streams responses for better UX
- Authenticated via Cognito (user identity tracked in memory)

**Key Configuration Files**:
- **Agent Logic**: `patterns/strands-single-agent/basic_agent.py` - Main agent implementation with memory integration, model configuration, and streaming logic
- **Python Dependencies**: `patterns/strands-single-agent/requirements.txt` - Required Python packages (Strands, bedrock-agentcore, etc.)
- **Container Config**: `patterns/strands-single-agent/Dockerfile` - Docker container definition (only used for `deployment_type: docker`)
- **Infrastructure**: `infra-cdk/lib/backend-stack.ts` - CDK configuration for memory resource and runtime deployment

**Model Configuration** (`patterns/strands-single-agent/basic_agent.py`):

```python
bedrock_model = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",  # ← Change model here
    temperature=0.1
)
```

**System Prompt** (`patterns/strands-single-agent/basic_agent.py`):

```python
system_prompt = """You are a helpful assistant. Answer questions clearly and concisely."""
```

**After making changes**: See [Deployment Guide](DEPLOYMENT.md) for redeployment instructions.

### LangGraph Single Agent Pattern

**Location**: `patterns/langgraph-single-agent/`

A conversational agent using LangGraph with AgentCore Memory and Gateway integration.

**What This Agent Does**:

- Multi-turn conversational chat with LangGraph
- Maintains conversation history with AgentCore Memory checkpointer
- Streams responses token-by-token for better UX
- Integrates with AgentCore Gateway for tool execution via MCP
- Uses MultiServerMCPClient for automatic session management

**Key Configuration Files**:
- **Agent Logic**: `patterns/langgraph-single-agent/langgraph_agent.py` - Main agent implementation with memory, Gateway tools, and streaming
- **Python Dependencies**: `patterns/langgraph-single-agent/requirements.txt` - Required Python packages (LangGraph, langchain-aws, etc.)
- **Container Config**: `patterns/langgraph-single-agent/Dockerfile` - Docker container definition (only used for `deployment_type: docker`)
- **Infrastructure**: `infra-cdk/lib/backend-stack.ts` - CDK configuration for memory resource and runtime deployment

**Model Configuration** (`patterns/langgraph-single-agent/langgraph_agent.py`):

```python
bedrock_model = ChatBedrock(
    model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",  # ← Change model here
    temperature=0.1,
    streaming=True
)
```

**Gateway Integration** (`patterns/langgraph-single-agent/langgraph_agent.py`):

```python
# Create MCP client for Gateway
mcp_client = await create_gateway_mcp_client(access_token)

# Load tools from Gateway
tools = await mcp_client.get_tools()

# Create agent with tools
graph = create_react_agent(
    model=bedrock_model,
    tools=tools,
    checkpointer=checkpointer
)
```

**After making changes**: See [Deployment Guide](DEPLOYMENT.md) for redeployment instructions.

---

## Creating Your Own Agent Pattern

### Step 1: Create Pattern Directory

```bash
mkdir -p patterns/my-custom-agent
cd patterns/my-custom-agent
```

### Step 2: Implement Your Agent

Create your agent code that:

- Accepts HTTP requests from AgentCore Runtime
- Processes user queries
- Returns responses (streaming or non-streaming)
- Integrates with AgentCore Memory (optional)

**Example Structure**:

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from utils.auth import extract_user_id_from_context

app = BedrockAgentCoreApp()

@app.entrypoint
async def agent_handler(payload, context: RequestContext):
    """Main entrypoint for the agent"""
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")

    # Extract user ID securely from the validated JWT token
    # instead of trusting the payload body (which could be manipulated)
    user_id = extract_user_id_from_context(context)

    # Your agent logic here
    # ...

    yield response

if __name__ == "__main__":
    app.run()
```

### Step 3: Create Dockerfile (for Docker deployment only)

If using `deployment_type: docker` in your config, create a Dockerfile:

```dockerfile
FROM public.ecr.aws/docker/library/python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

CMD ["python", "your_agent.py"]
```

**For ZIP deployment**: No Dockerfile is needed. The ZIP packager automatically bundles your `patterns/<pattern>/` directory along with `gateway/` and `tools/` directories, plus dependencies from `requirements.txt`.

### Step 4: Update CDK Configuration

In `infra-cdk/config.yaml`:

```yaml
backend:
  pattern: "my-custom-agent" # Your pattern directory name
```

**If your agent needs additional AWS services** (Knowledge Bases, DynamoDB, S3, etc.), modify the CDK stacks in `infra-cdk/lib/`:

**Example**: Adding a Knowledge Base

```typescript
// Create your knowledge base construct
const knowledgeBase = new bedrock.CfnKnowledgeBase(this, "KB", {
  name: "MyKnowledgeBase",
  // ... configuration
});

// Add to agent environment variables in backend-stack.ts
EnvironmentVariables: {
  KNOWLEDGE_BASE_ID: knowledgeBase.attrKnowledgeBaseId,
  // ... other vars
}
```

### Step 5: Deploy

See the [Deployment Guide](DEPLOYMENT.md) for complete deployment instructions.
