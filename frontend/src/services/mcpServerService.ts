/**
 * MCP Server Preferences Service
 * Reads the MCP server catalog with the current user's toggles and saves updates.
 * Endpoints live on the same API Gateway as the feedback API (GET/PUT /mcp-servers).
 */

let MCP_SERVERS_API_URL = ""

async function loadApiUrl(): Promise<string> {
  if (MCP_SERVERS_API_URL) {
    return MCP_SERVERS_API_URL
  }

  const response = await fetch("/aws-exports.json")
  const config = await response.json()
  if (!config.feedbackApiUrl) {
    throw new Error("API URL not configured")
  }
  MCP_SERVERS_API_URL = `${config.feedbackApiUrl}mcp-servers`
  return MCP_SERVERS_API_URL
}

export interface McpServer {
  id: string
  name: string
  description: string
  enabled: boolean
}

/**
 * Fetch the MCP server catalog with the calling user's enabled/disabled state.
 * Returns [] when the deployment has no MCP servers configured (route absent).
 */
export async function fetchMcpServers(idToken: string): Promise<McpServer[]> {
  const apiUrl = await loadApiUrl()
  const response = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
  })
  if (response.status === 403 || response.status === 404) {
    // Deployment without backend.mcp_servers — feature disabled.
    return []
  }
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  const data = await response.json()
  return data.servers ?? []
}

/** Save the calling user's enabled MCP server ids. */
export async function saveMcpServers(enabledIds: string[], idToken: string): Promise<void> {
  const apiUrl = await loadApiUrl()
  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ enabled: enabledIds }),
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
  }
}
