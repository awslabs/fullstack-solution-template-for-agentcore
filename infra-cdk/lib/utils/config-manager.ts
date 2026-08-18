import * as fs from "fs"
import * as path from "path"
import * as yaml from "yaml"

const MAX_STACK_NAME_BASE_LENGTH = 35

export type DeploymentType = "docker" | "zip"

/**
 * Network mode for the AgentCore Runtime.
 * - PUBLIC: Runtime is accessible over the public internet (default).
 * - VPC: Runtime is deployed into a user-provided VPC for private network isolation.
 */
export type NetworkMode = "PUBLIC" | "VPC"

/**
 * VPC configuration for deploying the AgentCore Runtime into an existing VPC.
 * Required when network_mode is "VPC".
 */
export interface VpcConfig {
  /** The ID of the existing VPC to deploy into (e.g. "vpc-0abc1234def56789a"). */
  vpc_id: string
  /** List of subnet IDs within the VPC where the runtime will be placed. */
  subnet_ids: string[]
  /** Optional list of security group IDs. If omitted, a default security group is created. */
  security_group_ids?: string[]
}

/**
 * Authentication for an MCP-server gateway target.
 * - NONE: public, unauthenticated upstream MCP (credential config omitted on the target).
 * - OAUTH: OAuth2 Client Credentials (M2M) via an AgentCore Token Vault provider.
 * IAM_SIGV4 / API_KEY are rejected at validation time — AgentCore Gateway does not
 * support them on MCP-server targets. stdio servers (command/args) are also rejected;
 * Gateway speaks streamable-HTTP MCP only.
 */
export type McpServerAuth =
  | { type: "NONE" }
  | {
      type: "OAUTH"
      /** OAuth2 client ID (plaintext). Provide this or client_id_secret_arn. */
      client_id?: string
      /** Secrets Manager ARN holding the client ID. Resolved by CloudFormation at deploy. */
      client_id_secret_arn?: string
      /** Secrets Manager ARN holding the client secret (never embedded in the template). */
      client_secret_secret_arn: string
      /** OIDC discovery URL of the OAuth2 authorization server. */
      discovery_url: string
      scopes?: string[]
    }

export interface McpServerConfig {
  /** Stable identifier. Alphanumeric + hyphens (used in resource names). */
  id: string
  name: string
  description?: string
  /** HTTPS endpoint of the streamable-HTTP MCP server. */
  endpoint: string
  /** Set false to keep the entry in config without deploying it. Defaults to true. */
  enabled?: boolean
  /** Whether the server starts enabled for users who haven't set preferences. Defaults to true. */
  default_enabled?: boolean
  /** Defaults to { type: "NONE" }. */
  auth?: McpServerAuth
}

export interface AppConfig {
  stack_name_base: string
  admin_user_email?: string | null
  backend: {
    pattern: string
    deployment_type: DeploymentType
    /** Name for the agent runtime. Valid characters: a-z, A-Z, 0-9, _. Defaults to "FASTAgent". */
    agent_name: string
    /** Network mode for the AgentCore Runtime. Defaults to "PUBLIC". */
    network_mode: NetworkMode
    /** VPC configuration. Required when network_mode is "VPC". */
    vpc?: VpcConfig
    /**
     * Enable long-term memory (SemanticMemoryStrategy) for the agent.
     * When true, the agent extracts and retrieves facts across sessions.
     * This incurs additional costs: $0.75/1,000 records stored + $0.50/1,000 retrievals.
     * Defaults to false.
     */
    use_long_term_memory: boolean
    /**
     * Number of facts to retrieve per turn when long-term memory is enabled.
     * Maps to the top_k parameter of RetrievalConfig. Defaults to 10.
     */
    ltm_top_k: number
    /**
     * Minimum similarity threshold for long-term memory retrieval.
     * Maps to the relevance_score parameter of RetrievalConfig. Defaults to 0.3.
     */
    ltm_relevance_score: number
    /** Catalog of additional MCP servers exposed through the AgentCore Gateway. */
    mcp_servers?: McpServerConfig[]
  }
}

const MCP_SERVER_ID_PATTERN = /^[0-9a-zA-Z][0-9a-zA-Z-]*$/

function validateMcpServers(servers: unknown, configPath: string): McpServerConfig[] | undefined {
  if (servers === undefined || servers === null) return undefined
  if (!Array.isArray(servers)) {
    throw new Error(`backend.mcp_servers must be a list in ${configPath}`)
  }
  const seenIds = new Set<string>()
  for (const s of servers as (McpServerConfig & { command?: string; args?: string[] })[]) {
    const where = `backend.mcp_servers entry '${s?.id ?? "?"}' in ${configPath}`
    if (s.command || s.args) {
      throw new Error(
        `${where}: stdio MCP servers (command/args) are not supported — AgentCore Gateway only supports streamable-HTTP MCP endpoints.`
      )
    }
    if (!s.id || !MCP_SERVER_ID_PATTERN.test(s.id)) {
      throw new Error(`${where}: id is required and must match ${MCP_SERVER_ID_PATTERN} (alphanumeric and hyphens).`)
    }
    if (seenIds.has(s.id)) {
      throw new Error(`${where}: duplicate id.`)
    }
    seenIds.add(s.id)
    if (!s.name) {
      throw new Error(`${where}: name is required.`)
    }
    if (!s.endpoint || !s.endpoint.startsWith("https://")) {
      throw new Error(`${where}: endpoint is required and must be an https:// URL.`)
    }
    const auth = s.auth ?? { type: "NONE" }
    if (auth.type === "OAUTH") {
      if (!auth.discovery_url) {
        throw new Error(`${where}: auth.discovery_url is required for OAUTH.`)
      }
      if (!auth.client_secret_secret_arn?.startsWith("arn:aws:secretsmanager:")) {
        throw new Error(`${where}: auth.client_secret_secret_arn must be a Secrets Manager ARN.`)
      }
      if (!auth.client_id === !auth.client_id_secret_arn) {
        throw new Error(`${where}: provide exactly one of auth.client_id or auth.client_id_secret_arn.`)
      }
    } else if (auth.type !== "NONE") {
      throw new Error(
        `${where}: auth.type '${(auth as { type: string }).type}' is not supported on MCP-server targets. Use NONE or OAUTH.`
      )
    }
  }
  return servers as McpServerConfig[]
}

export class ConfigManager {
  private config: AppConfig

  constructor(configFile: string) {
    this.config = this._loadConfig(configFile)
  }

  private _loadConfig(configFile: string): AppConfig {
    let configPath: string

    // Uses the specified configFile if the file exists
    // otherwise fallsback to existing behavior where the configFile should be
    // named config.yaml and be in the infra-cdk directory. Throws an error if the
    // configFile does not exist and is not the default "config.yaml"
    if (fs.existsSync(configFile)) {
      configPath = configFile
    } else {
      if (path.basename(configFile) !== "config.yaml") {
        throw new Error(`Configuration file '${configFile}' not found.`)
      }
      const defaultConfigPath = path.join(__dirname, "..", "..", configFile) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      configPath = defaultConfigPath
    }
    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Configuration file ${configPath} does not exist. Please create config.yaml file.`
      )
    }

    try {
      const fileContent = fs.readFileSync(configPath, "utf8")
      const parsedConfig = yaml.parse(fileContent) as AppConfig

      const deploymentType = parsedConfig.backend?.deployment_type || "docker"
      if (deploymentType !== "docker" && deploymentType !== "zip") {
        throw new Error(
          `Invalid deployment_type '${deploymentType}' in ${configPath}. Must be 'docker' or 'zip'.`
        )
      }

      const stackNameBase = parsedConfig.stack_name_base
      if (!stackNameBase) {
        throw new Error(`stack_name_base is required in ${configPath}`)
      }
      if (stackNameBase.length > MAX_STACK_NAME_BASE_LENGTH) {
        throw new Error(
          `stack_name_base '${stackNameBase}' is too long (${stackNameBase.length} chars). ` +
            `Maximum length is ${MAX_STACK_NAME_BASE_LENGTH} characters due to AWS AgentCore runtime naming constraints.`
        )
      }

      // Validate network_mode if provided
      const networkMode = parsedConfig.backend?.network_mode || "PUBLIC"
      if (networkMode !== "PUBLIC" && networkMode !== "VPC") {
        throw new Error(
          `Invalid network_mode '${networkMode}' in ${configPath}. Must be 'PUBLIC' or 'VPC'.`
        )
      }

      // Validate VPC configuration when network_mode is VPC
      const vpcConfig = parsedConfig.backend?.vpc
      if (networkMode === "VPC") {
        if (!vpcConfig) {
          throw new Error(
            `backend.vpc configuration is required in ${configPath} when network_mode is 'VPC'.`
          )
        }
        if (!vpcConfig.vpc_id) {
          throw new Error(
            `backend.vpc.vpc_id is required in ${configPath} when network_mode is 'VPC'.`
          )
        }
        if (!vpcConfig.subnet_ids || vpcConfig.subnet_ids.length === 0) {
          throw new Error(
            `backend.vpc.subnet_ids must contain at least one subnet ID in ${configPath} when network_mode is 'VPC'.`
          )
        }
      }

      return {
        stack_name_base: stackNameBase,
        admin_user_email: parsedConfig.admin_user_email || null,
        backend: {
          pattern: parsedConfig.backend?.pattern || "strands-single-agent",
          deployment_type: deploymentType,
          agent_name: parsedConfig.backend?.agent_name || "FASTAgent",
          network_mode: networkMode,
          vpc: vpcConfig,
          use_long_term_memory: parsedConfig.backend?.use_long_term_memory === true,
          ltm_top_k: parsedConfig.backend?.ltm_top_k ?? 10,
          ltm_relevance_score: parsedConfig.backend?.ltm_relevance_score ?? 0.3,
          mcp_servers: validateMcpServers(parsedConfig.backend?.mcp_servers, configPath),
        },
      }
    } catch (error) {
      throw new Error(`Failed to parse configuration file ${configPath}: ${error}`)
    }
  }

  public getProps(): AppConfig {
    return this.config
  }

  public get(key: string, defaultValue?: any): any {
    const keys = key.split(".")
    let value: any = this.config

    for (const k of keys) {
      if (typeof value === "object" && value !== null && k in value) {
        // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop — iterates over a trusted local YAML config object, not user-controlled input
        value = value[k]
      } else {
        return defaultValue
      }
    }

    return value
  }
}
