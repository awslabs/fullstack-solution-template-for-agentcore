import logging
from strands.hooks.events import AgentInitializedEvent, MessageAddedEvent, AfterInvocationEvent
from strands.hooks.registry import HookProvider, HookRegistry
from bedrock_agentcore.memory import MemoryClient

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ShortTermMemoryHook(HookProvider):
    def __init__(self, memory_client: MemoryClient, memory_id: str, actor_id: str, session_id: str):
        self.memory_client = memory_client
        self.memory_id = memory_id
        self.actor_id = actor_id
        self.session_id = session_id
    
    def on_agent_initialized(self, event: AgentInitializedEvent):
        """Load recent conversation history when agent starts"""
        try:
            # Get last 5 conversation turns
            recent_turns = self.memory_client.get_last_k_turns(
                memory_id=self.memory_id,
                actor_id=self.actor_id,
                session_id=self.session_id,
                k=20,
                branch_name="main"
            )
            
            if recent_turns:
                # Format conversation history for context
                context_messages = []
                for turn in recent_turns:
                    for message in turn:
                        role = message['role'].lower()
                        content_text = message['content']['text']
                        context_messages.append(f"[{role.title()}]: \n{content_text}")

                context = "\n\n".join(list(reversed(context_messages)))

                # Add context to agent's system prompt
                event.agent.system_prompt += f"""Recent conversation:\n{context}\n\nThe conversation should continue naturally from here."""
                
                logger.info(f"✅ Loaded {len(recent_turns)} recent conversation turns")
            else:
                logger.info("No previous conversation history found")
                
        except Exception as e:
            logger.error(f"Failed to load conversation history: {e}")
    
    def on_message_added(self, event: AfterInvocationEvent):
        """Store conversation turns in memory"""
        messages = event.agent.messages
        content_list = messages[-1].get("content", [])
        has_tool_use = any("toolUse" in content for content in content_list)
        has_tool_result = any("toolResult" in content for content in content_list)
        has_text = any("text" in content for content in content_list)

        if has_tool_result:
            role = "TOOL"
            content_text = str(content_list)
        elif has_text and not has_tool_use:
            role = messages[-1]["role"]
            content_text = str(content_list[0]['text'])
        else:
            return
        try:
            self.memory_client.create_event(
                memory_id=self.memory_id,
                actor_id=self.actor_id,
                session_id=self.session_id,
                messages=[(content_text, role)]
            )

        except Exception as e:
            logger.error(f"Failed to store message: {e}")
    
    def register_hooks(self, registry: HookRegistry) -> None:
        # Register memory hooks
        registry.add_callback(MessageAddedEvent, self.on_message_added)
        registry.add_callback(AgentInitializedEvent, self.on_agent_initialized)
