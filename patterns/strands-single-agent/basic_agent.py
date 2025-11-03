import os
from strands import Agent
from strands.models import BedrockModel
from bedrock_agentcore.runtime import BedrockAgentCoreApp
# Note: Using Strands session manager for memory integration: https://strandsagents.com/latest/documentation/docs/community/session-managers/agentcore-memory/
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig

app = BedrockAgentCoreApp()

def create_basic_agent(user_id, session_id) -> Agent:
    """Create a basic agent with simple functionality"""
    system_prompt = """You are a helpful assistant. Answer questions clearly and concisely."""

    bedrock_model = BedrockModel(
        model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        temperature=0.1
    )   
    
    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")
    
    # Configure AgentCore Memory with short-term memory (conversation history only)
    # To enable long-term strategies (summaries, preferences, facts), see docs/MEMORY_INTEGRATION.md
    agentcore_memory_config = AgentCoreMemoryConfig(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=user_id
    )
    
    session_manager = AgentCoreMemorySessionManager(
        agentcore_memory_config=agentcore_memory_config,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    )

    return Agent(
        name="BasicAgent",
        system_prompt=system_prompt,
        model=bedrock_model,
        session_manager=session_manager,
        trace_attributes={
            "user.id": user_id,
            "session.id": session_id,
        }
    )

@app.entrypoint
async def agent_stream(payload):
    """Main entrypoint for the agent using raw Strands streaming"""
    user_query = payload.get("prompt")
    user_id = payload.get("userId")
    session_id = payload.get("runtimeSessionId")
    
    if not all([user_query, user_id, session_id]):
        yield {
            "status": "error",
            "error": "Missing required fields: prompt, userId, or runtimeSessionId"
        }
        return
    
    try:
        agent = create_basic_agent(user_id, session_id)
        
        # Use the agent's stream_async method for true token-level streaming
        async for event in agent.stream_async(user_query):
            yield event
            
    except Exception as e:
        yield {
            "status": "error",
            "error": str(e)
        }

if __name__ == "__main__":
    app.run()
