import { fetchAuthSession } from 'aws-amplify/auth';

// Generate a UUID-like string that meets AgentCore requirements (min 33 chars)
const generateId = () => {
  const timestamp = Date.now().toString(36);
  const random1 = Math.random().toString(36).substring(2);
  const random2 = Math.random().toString(36).substring(2);
  const random3 = Math.random().toString(36).substring(2);
  return `${timestamp}-${random1}-${random2}-${random3}`;
};

// Configuration - will be populated from aws-exports.json
const AGENT_CONFIG = {
  AGENT_RUNTIME_ARN: '',
  AWS_REGION: 'us-east-1',
};

// Set configuration from environment or aws-exports
export const setAgentConfig = (runtimeArn, region = 'us-east-1') => {
  AGENT_CONFIG.AGENT_RUNTIME_ARN = runtimeArn;
  AGENT_CONFIG.AWS_REGION = region;
};

/**
 * Invokes the AgentCore runtime with streaming support
 */
export const invokeAgentCore = async (query, sessionId, onStreamUpdate) => {
  try {
    // Get Amplify auth session to extract access token
    const session = await fetchAuthSession();
    const accessToken = session.tokens?.accessToken?.toString();
    
    // Extract userId from the ID token (sub is the unique user identifier)
    const userId = session.tokens?.idToken?.payload?.sub;

    if (!accessToken) {
      throw new Error('No valid access token found. Please ensure you are authenticated.');
    }

    if (!AGENT_CONFIG.AGENT_RUNTIME_ARN) {
      throw new Error('Agent Runtime ARN not configured');
    }

    // Bedrock Agent Core endpoint
    const endpoint = `https://bedrock-agentcore.${AGENT_CONFIG.AWS_REGION}.amazonaws.com`;

    // URL encode the agent ARN
    const escapedAgentArn = encodeURIComponent(AGENT_CONFIG.AGENT_RUNTIME_ARN);

    // Construct the URL
    const url = `${endpoint}/runtimes/${escapedAgentArn}/invocations?qualifier=DEFAULT`;

    // Generate trace ID
    const traceId = `1-${Math.floor(Date.now() / 1000).toString(16)}-${generateId()}`;

    // Set up headers
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'X-Amzn-Trace-Id': traceId,
      'Content-Type': 'application/json',
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
    };

    // Create the payload
    const payload = {
      prompt: query,
      runtimeSessionId: sessionId,
      userId: userId,
    };

    // Make HTTP request with streaming
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    let completion = '';

    // Handle streaming response
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // eslint-disable-next-line no-await-in-loop
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          completion += chunk;

          // Call the streaming update callback
          onStreamUpdate(completion);
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      // Fallback for non-streaming response
      completion = await response.text();
      onStreamUpdate(completion);
    }

    return completion;
  } catch (error) {
    console.error('Error invoking AgentCore:', error);
    throw error;
  }
};

/**
 * Generate a new session ID
 */
export const generateSessionId = () => {
  return generateId();
};
