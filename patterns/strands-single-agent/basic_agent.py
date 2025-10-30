import os
from strands import Agent
from strands.models import BedrockModel
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.memory import MemoryClient

from memory_hook import ShortTermMemoryHook

app = BedrockAgentCoreApp()

def create_basic_agent(user_id, session_id) -> Agent:
    """Create a basic agent with simple functionality"""
    system_prompt = """You are a helpful assistant. Answer questions clearly and concisely."""

    bedrock_model = BedrockModel(
    model_id= "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    temperature=0.1
    )   
    
    memory_hook = ShortTermMemoryHook(
        memory_id=os.environ.get("MEMORY_ID"),
        memory_client=MemoryClient(),
        actor_id=f"supervisor-{user_id}", 
        session_id=session_id
    )

    return Agent(
        name="BasicAgent",
        system_prompt=system_prompt,
        model=bedrock_model,
        hooks=[memory_hook],
        trace_attributes={
            "user.id": user_id,
            "session.id": session_id,
        }
    )

@app.entrypoint
async def agent_stream(payload):
    """Main entrypoint for the agent using raw Strands streaming"""
    user_query = payload["prompt"]
    user_id = payload["userId"]
    session_id = payload["runtimeSessionId"]
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
