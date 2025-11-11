import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    """
    Sample tool Lambda function for GASP Gateway
    
    Gateway protocol (from AWS docs):
    - Tool name is in context.client_context.custom['bedrockAgentCoreToolName']
    - Tool name format: {target_name}___{tool_name}
    - Arguments are in the event object as key-value pairs
    """
    logger.info(f"Received event: {json.dumps(event)}")
    logger.info(f"Context: {context}")
    
    try:
        # Get tool name from context (official Gateway protocol)
        delimiter = "___"
        original_tool_name = context.client_context.custom['bedrockAgentCoreToolName']
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter):]
        
        logger.info(f"Tool name: {tool_name}")
        
        if tool_name == 'sample_tool':
            # Arguments are in the event object
            name = event.get('name', 'World')
            result = f"Hello, {name}! This is a sample tool from GASP."
            
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'content': [
                        {
                            'type': 'text',
                            'text': result
                        }
                    ]
                })
            }
        else:
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'error': f"Unknown tool: {tool_name}"
                })
            }
            
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': f"Internal server error: {str(e)}"
            })
        }
