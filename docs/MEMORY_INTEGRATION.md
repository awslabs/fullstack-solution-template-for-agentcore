# AgentCore Memory Integration Guide

Quick, practical guide for integrating AWS Bedrock AgentCore Memory with your agents.

---

## Step 1: Configure Memory with CDK

Memory resources are created using CloudFormation L1 constructs. **L2 constructs will be available in future releases.**

### Basic Memory (Short-Term Only)

```typescript
const memory = new cdk.CfnResource(this, "AgentMemory", {
  type: "AWS::BedrockAgentCore::Memory",
  properties: {
    Name: "MyAgentMemory",
    EventExpiryDuration: 7,  // Days to retain (7-365)
    MemoryStrategies: [],  // Empty = short-term only
    MemoryExecutionRoleArn: executionRole.roleArn
  }
})
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
        summaryMemoryStrategy: {
          name: "SessionSummarizer",
          namespaces: ["/summaries/{actorId}/{sessionId}"]
        }
      },
      {
        userPreferenceMemoryStrategy: {
          name: "PreferenceLearner",
          namespaces: ["/preferences/{actorId}"]
        }
      },
      {
        semanticMemoryStrategy: {
          name: "FactExtractor",
          namespaces: ["/facts/{actorId}"]
        }
      }
    ],
    MemoryExecutionRoleArn: executionRole.roleArn
  }
})
```

### Required IAM Permissions

```typescript
new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    "bedrock-agentcore:CreateEvent",
    "bedrock-agentcore:ListEvents",
    "bedrock-agentcore:GetMemory",
    "bedrock-agentcore:CreateMemorySession",
    "bedrock-agentcore:RetrieveMemories"
  ],
  resources: [memoryArn]
})
```

### Understanding Memory Configuration

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

**💡 Example:** See this approach implemented in `patterns/strands-single-agent/basic_agent.py`

**📚 Reference:** [Strands Memory Integration](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/strands-sdk-memory.html)

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

**💡 Example:** [AWS AgentCore Sample](https://github.com/awslabs/amazon-bedrock-agentcore-samples/blob/main/01-tutorials/04-AgentCore-memory/01-short-term-memory/01-single-agent/with-strands-agent/)

### Using LangGraph?

**Install:**
```bash
pip install langgraph-checkpoint-aws
```

**Short-term memory (Checkpointer):**
```python
from langchain.chat_models import init_chat_model
from langgraph.prebuilt import create_react_agent
from langgraph_checkpoint_aws import AgentCoreMemorySaver

checkpointer = AgentCoreMemorySaver(MEMORY_ID, region_name="us-west-2")
llm = init_chat_model(MODEL_ID, model_provider="bedrock_converse", region_name="us-west-2")

graph = create_react_agent(
    model=llm,
    tools=tools,
    checkpointer=checkpointer
)

# Invoke with actor and session
config = {
    "configurable": {
        "thread_id": "session-1",
        "actor_id": "user-123"
    }
}

response = graph.invoke({"messages": [("human", "Hello")]}, config=config)
```

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

**📚 Reference:** [LangGraph Memory Integration](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-integrate-lang.html)

---

## Resources

### Documentation
- [AgentCore Memory Overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html)
- [Memory API Reference](https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/welcome.html)
- [CloudFormation Resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-bedrockagentcore-memory.html)

### Code Examples
- [AgentCore Samples Repository](https://github.com/awslabs/amazon-bedrock-agentcore-samples)
- [LangChain AWS Integration](https://github.com/langchain-ai/langchain-aws/tree/main/samples/memory)
- [Strands Integration](https://strandsagents.com/latest/documentation/docs/community/session-managers/agentcore-memory/)

### Community
- Slack: `#bedrock-agentcore-memory-interest`
