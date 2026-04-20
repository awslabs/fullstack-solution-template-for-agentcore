# AgentCore Memory Integration Guide

Quick, practical guide for integrating AWS Bedrock AgentCore Memory with your agents.

AgentCore provides two types of memory: **short-term memory** stores raw conversation history, providing agents with context from recent interactions. **Long-term memory** uses AI-powered strategies to extract and store meaningful insights—such as session summaries, user preferences, and important facts—enabling agents to build deeper understanding over time. Learn more in the [Amazon Bedrock AgentCore Memory blog post](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-memory-building-context-aware-agents/).

---

## Enabling Long-Term Memory

Long-term memory (LTM) is supported on the **`strands-single-agent`** pattern. It uses a `SemanticMemoryStrategy` to automatically extract and store facts from conversations, enabling the agent to recall information across sessions. Facts are keyed by the Cognito `userId`, so each user gets their own persistent memory.

### How It Works

1. **Infrastructure**: The CDK stack always creates the `SemanticMemoryStrategy` on the memory resource (there is no cost to simply define the strategy). A `USE_LONG_TERM_MEMORY` environment variable is passed to the agent runtime.
2. **Agent behavior**: When `USE_LONG_TERM_MEMORY` is `"true"`, the Strands agent's `AgentCoreMemorySessionManager` is configured with a `retrieval_config` that reads from the `/facts/{actorId}` namespace on each turn. When `"false"` (the default), only short-term conversation history is active.
3. **Fact extraction**: AgentCore processes conversation events asynchronously and extracts factual information (e.g., "the user lives in Seattle", "the user prefers Python"). These facts are stored under `/facts/{actorId}` and retrieved on subsequent turns to personalize responses.

### Configuration

Toggle LTM in `infra-cdk/config.yaml`:

```yaml
backend:
  use_long_term_memory: true   # Enable long-term semantic memory retrieval
```

Then redeploy:

```bash
cd infra-cdk && cdk deploy --all
```

### Cost Considerations

LTM incurs additional charges beyond short-term memory:

- **Storage**: $0.75 per 1,000 memory records stored
- **Retrieval**: $0.50 per 1,000 retrieval calls

When `use_long_term_memory` is `false`, neither cost applies — short-term memory (conversation history) is the only active feature.

### Other Patterns

The **`langgraph-single-agent`** pattern does not currently use long-term memory. It uses `AgentCoreMemorySaver` as a LangGraph checkpointer for short-term conversation persistence only. See the LangGraph section below for details on adding long-term memory via `AgentCoreMemoryStore`.

---

## Step 1: Configure Memory with CDK

Memory resources are created using [CloudFormation L1 constructs](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-bedrockagentcore-memory.html). **L2 constructs will be available in future releases.**

### Basic Memory (Short-Term Only)

```typescript
const memory = new cdk.CfnResource(this, "AgentMemory", {
  type: "AWS::BedrockAgentCore::Memory",
  properties: {
    Name: "MyAgentMemory",
    EventExpiryDuration: 7, // Days to retain (7-365)
    MemoryStrategies: [], // Empty = short-term only
    MemoryExecutionRoleArn: executionRole.roleArn,
  },
});
```

### Advanced Memory (With Strategies)

```typescript
const memory = new cdk.CfnResource(this, "AgentMemory", {
  type: "AWS::BedrockAgentCore::Memory",
  properties: {
    Name: "MyAgentMemory",
    EventExpiryDuration: 30,
    Description: "Memory with intelligent extraction",
    MemoryStrategies: [
      {
        SummaryMemoryStrategy: {
          Name: "SessionSummarizer",
          Namespaces: ["/summaries/{actorId}/{sessionId}"],
        },
      },
      {
        UserPreferenceMemoryStrategy: {
          Name: "PreferenceLearner",
          Namespaces: ["/preferences/{actorId}"],
        },
      },
      {
        SemanticMemoryStrategy: {
          Name: "FactExtractor",
          Namespaces: ["/facts/{actorId}"],
        },
      },
    ],
    MemoryExecutionRoleArn: executionRole.roleArn,
  },
});
```

### Required IAM Permissions

```typescript
new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    "bedrock-agentcore:CreateEvent",
    "bedrock-agentcore:GetEvent",
    "bedrock-agentcore:ListEvents",
    "bedrock-agentcore:RetrieveMemoryRecords",
  ],
  resources: [memoryArn],
});
```

**Permission Breakdown:**

- `CreateEvent`, `GetEvent`, `ListEvents`: For short-term memory (conversation history)
- `RetrieveMemoryRecords`: For long-term memory (summaries, preferences, facts from strategies)

### Understanding Memory Configuration

For complete configuration details, see the [AgentCore Memory Overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html) and [Memory API Reference](https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/welcome.html).

**Memory Parameters**

- **EventExpiryDuration**: 7-365 days
- **MemoryStrategies**: Empty for short-term, array for long-term
- **actor_id**: User identifier
- **session_id/thread_id**: Conversation identifier

**Memory Strategies**
| Strategy | Purpose | Namespace |
|----------|---------|-----------|
| `summaryMemoryStrategy` | Auto-summarize sessions | `/summaries/{actorId}/{sessionId}` |
| `userPreferenceMemoryStrategy` | Learn preferences | `/preferences/{actorId}` |
| `semanticMemoryStrategy` | Extract facts | `/facts/{actorId}` |

---

## Step 2: Integrate with Your Framework

### Using Strands?

For complete Strands integration documentation, see the [official Strands Memory Integration guide](https://strandsagents.com/latest/documentation/docs/community/session-managers/agentcore-memory/).

**Install:**

```bash
pip install bedrock-agentcore[strands-agents]
```

**Code:**

```python
import os
from strands import Agent
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig

memory_id = os.environ.get("MEMORY_ID")
if not memory_id:
    raise ValueError("MEMORY_ID environment variable is required")

# Basic configuration
config = AgentCoreMemoryConfig(
    memory_id=memory_id,
    session_id=session_id,
    actor_id=user_id
)

session_manager = AgentCoreMemorySessionManager(
    agentcore_memory_config=config,
    region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
)

agent = Agent(
    system_prompt="You are a helpful assistant.",
    model=bedrock_model,
    session_manager=session_manager
)
```

**With strategies (if configured in CDK):**

```python
from bedrock_agentcore.memory.integrations.strands.config import RetrievalConfig

config = AgentCoreMemoryConfig(
    memory_id=memory_id,
    session_id=session_id,
    actor_id=user_id,
    retrieval_config={
        "/preferences/{actorId}": RetrievalConfig(top_k=5, relevance_score=0.7),
        "/facts/{actorId}": RetrievalConfig(top_k=10, relevance_score=0.3)
    }
)
```

**With long-term memory enabled** (see [Enabling Long-Term Memory](#enabling-long-term-memory) above):

The `strands-single-agent` pattern conditionally enables LTM retrieval based on the `USE_LONG_TERM_MEMORY` environment variable. When enabled, the agent retrieves facts from the `/facts/{actorId}` namespace on each turn:

```python
use_ltm = os.environ.get("USE_LONG_TERM_MEMORY", "false").lower() == "true"

retrieval_config = (
    {
        "/facts/{actorId}": RetrievalConfig(
            top_k=10,
            relevance_score=0.3,
        )
    }
    if use_ltm
    else None
)

config = AgentCoreMemoryConfig(
    memory_id=memory_id,
    session_id=session_id,
    actor_id=user_id,
    retrieval_config=retrieval_config,
)
```

**💡 Example:** See this approach implemented in `patterns/strands-single-agent/basic_agent.py`

**📚 Official AWS Guide:** [Strands SDK Memory Integration](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/strands-sdk-memory.html)

#### Alternative: Hook-Based Approach

For more control over memory lifecycle and custom memory operations, you can use Strands hooks with MemorySession:

```python
from strands import Agent
from strands.hooks import AgentInitializedEvent, HookProvider, HookRegistry, MessageAddedEvent
from bedrock_agentcore.memory.session import MemorySession, MemorySessionManager
from bedrock_agentcore.memory.constants import ConversationalMessage, MessageRole

# Initialize session manager and create session
session_manager = MemorySessionManager(memory_id=memory_id, region_name="us-east-1")
user_session = session_manager.create_memory_session(
    actor_id=user_id,
    session_id=session_id
)

# Create custom hook provider
class MemoryHookProvider(HookProvider):
    def __init__(self, memory_session: MemorySession):
        self.memory_session = memory_session

    def on_agent_initialized(self, event: AgentInitializedEvent):
        """Load recent conversation history when agent starts"""
        recent_turns = self.memory_session.get_last_k_turns(k=5)
        if recent_turns:
            # Format and add to agent context
            context_messages = []
            for turn in recent_turns:
                for message in turn:
                    role = message['role']
                    content = message['content']['text']
                    context_messages.append(f"{role}: {content}")

            context = "\n".join(context_messages)
            event.agent.system_prompt += f"\n\nRecent conversation:\n{context}"

    def on_message_added(self, event: MessageAddedEvent):
        """Store new messages in memory"""
        messages = event.agent.messages
        if messages and len(messages) > 0:
            message_text = messages[-1]["content"][0]["text"]
            message_role = MessageRole.USER if messages[-1]["role"] == "user" else MessageRole.ASSISTANT

            self.memory_session.add_turns(
                messages=[ConversationalMessage(message_text, message_role)]
            )

    def register_hooks(self, registry: HookRegistry):
        registry.add_callback(MessageAddedEvent, self.on_message_added)
        registry.add_callback(AgentInitializedEvent, self.on_agent_initialized)

# Create agent with memory hooks
agent = Agent(
    system_prompt="You are a helpful assistant.",
    model=bedrock_model,
    hooks=[MemoryHookProvider(user_session)],
    tools=[...]
)
```

**Use when:** Custom memory loading logic, combining multiple hooks, or fine-grained control needed.

**💡 Complete Example:** See the [AWS AgentCore Samples repository](https://github.com/awslabs/amazon-bedrock-agentcore-samples) for working code examples, including this [Strands with hooks tutorial](https://github.com/awslabs/amazon-bedrock-agentcore-samples/blob/main/01-tutorials/04-AgentCore-memory/01-short-term-memory/01-single-agent/with-strands-agent/).

### Using LangGraph?

For complete LangGraph integration documentation, see the [official LangGraph Memory Integration guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-integrate-lang.html). For working code examples, explore the [LangChain AWS Integration samples](https://github.com/langchain-ai/langchain-aws/tree/main/samples/memory).

**Install:**

```bash
pip install langgraph-checkpoint-aws langchain-mcp-adapters
```

**Complete Integration with Gateway Tools:**

```python
from langchain_aws import ChatBedrock
from langgraph.prebuilt import create_react_agent
from langgraph_checkpoint_aws import AgentCoreMemorySaver
from langchain_mcp_adapters.client import MultiServerMCPClient

# Configure memory checkpointer
checkpointer = AgentCoreMemorySaver(
    memory_id=memory_id,
    region_name="us-east-1"
)

# Create Bedrock model
bedrock_model = ChatBedrock(
    model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    temperature=0.1,
    streaming=True
)

# Create MCP client for Gateway tools
mcp_client = MultiServerMCPClient({
    "gateway": {
        "transport": "streamable_http",
        "url": gateway_url,
        "headers": {
            "Authorization": f"Bearer {access_token}"
        }
    }
})

# Load tools from Gateway
tools = await mcp_client.get_tools()

# Create agent with memory and tools
graph = create_react_agent(
    model=bedrock_model,
    tools=tools,
    checkpointer=checkpointer
)

# Invoke with actor and session
config = {
    "configurable": {
        "thread_id": session_id,
        "actor_id": user_id
    }
}

# Stream responses
async for event in graph.astream(
    {"messages": [("user", "Hello")]},
    config=config,
    stream_mode="messages"
):
    message_chunk, metadata = event
    # Process streaming chunks
```

**💡 Example:** See this approach implemented in `patterns/langgraph-single-agent/langgraph_agent.py`

**Long-term memory (Store):**

```python
from langgraph_checkpoint_aws import AgentCoreMemoryStore
from langchain_core.runnables import RunnableConfig
import uuid

store = AgentCoreMemoryStore(MEMORY_ID, region_name="us-west-2")

def pre_model_hook(state, config: RunnableConfig, *, store):
    """Save messages for extraction"""
    actor_id = config["configurable"]["actor_id"]
    thread_id = config["configurable"]["thread_id"]
    namespace = (actor_id, thread_id)

    messages = state.get("messages", [])
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage):
            store.put(namespace, str(uuid.uuid4()), {"message": msg})
            break

    return {"llm_input_messages": messages}

graph = create_react_agent(
    model=llm,
    tools=tools,
    checkpointer=checkpointer,
    store=store,
    pre_model_hook=pre_model_hook
)
```

---

## Additional Resources

For more information and community support:

- **Community Slack**: `#bedrock-agentcore-memory-interest`
- **All Code Examples**: [AgentCore Samples Repository](https://github.com/awslabs/amazon-bedrock-agentcore-samples)
