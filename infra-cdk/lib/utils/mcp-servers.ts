/**
 * Wires `backend.mcp_servers` config entries from `config.yaml` into the
 * AgentCore Gateway as additional MCP-server targets.
 *
 * Auth types (validated in config-manager.ts):
 *   - NONE  — public upstream MCP. Passing an empty credential list makes the
 *             L2 omit credentialProviderConfigurations from the template,
 *             which is what the Gateway API requires for unauthenticated
 *             MCP-server targets.
 *   - OAUTH — OAuth2 Client Credentials (M2M). Uses the native
 *             AWS::BedrockAgentCore::OAuth2CredentialProvider resource via
 *             the L2 OAuth2CredentialProvider — no Custom Resource Lambda and
 *             no extra IAM grants needed. Secret values are resolved by
 *             CloudFormation dynamic references at deploy time, so they are
 *             never embedded in the synthesized template.
 */

import * as cdk from "aws-cdk-lib"
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore"
import { Construct } from "constructs"

import { AppConfig, McpServerConfig } from "./config-manager"

/**
 * Attach every enabled MCP server entry to the gateway.
 */
export function attachMcpServerTargets(
  scope: Construct,
  config: AppConfig,
  gateway: agentcore.IGateway
): agentcore.GatewayTarget[] {
  const entries = (config.backend.mcp_servers ?? []).filter(s => s.enabled !== false)
  return entries.map(entry =>
    agentcore.GatewayTarget.forMcpServer(scope, `MCPTarget-${entry.id}`, {
      gateway,
      // Short name: gateway tool names become "{target}___{tool}" and must stay
      // within Bedrock's 64-char tool-name limit, so no stack prefix here
      // (the gateway is already stack-scoped).
      gatewayTargetName: `mcp-${entry.id}`,
      description: entry.description ?? entry.name,
      endpoint: entry.endpoint,
      credentialProviderConfigurations: buildCredentialProviders(scope, entry, config),
    })
  )
}

function buildCredentialProviders(
  scope: Construct,
  entry: McpServerConfig,
  config: AppConfig
): agentcore.ICredentialProviderConfig[] {
  const auth = entry.auth ?? { type: "NONE" }
  if (auth.type === "NONE") return []

  // client_id may be given inline or as a Secrets Manager ARN; either way it
  // reaches CloudFormation as a string (dynamic reference in the ARN case).
  const clientId =
    auth.client_id ?? cdk.SecretValue.secretsManager(auth.client_id_secret_arn!).unsafeUnwrap()

  const provider = agentcore.OAuth2CredentialProvider.usingCustom(
    scope,
    `MCPOAuthProvider-${entry.id}`,
    {
      oAuth2CredentialProviderName: `${config.stack_name_base}-mcp-${entry.id}-oauth`,
      clientId,
      clientSecret: cdk.SecretValue.secretsManager(auth.client_secret_secret_arn),
      discoveryUrl: auth.discovery_url,
    }
  )

  return [
    agentcore.GatewayCredentialProvider.fromOauthIdentity(provider, {
      scopes: auth.scopes ?? [],
    }),
  ]
}
