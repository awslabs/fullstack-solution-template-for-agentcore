import * as cdk from "aws-cdk-lib"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as iam from "aws-cdk-lib/aws-iam"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets"
import * as cr from "aws-cdk-lib/custom-resources"
import { Construct } from "constructs"
import { AppConfig } from "../utils/config-manager"
import { AgentCoreRole } from "../utils/agentcore-role"
import * as path from "path"
import * as fs from "fs"

export interface AgentConstructProps {
  config: AppConfig
  /** User pool id for the runtime's JWT authorizer issuer. */
  userPoolId: string
  /** User pool client id allowed by the runtime's JWT authorizer. */
  userPoolClientId: string
  /**
   * OPTIONAL gateway integration. When set (to GatewayConstruct.credentialProviderName),
   * the agent is wired to authenticate to that gateway. Omit to run the agent without a
   * gateway — this is the single agent->gateway seam, controlled from the composition root.
   */
  gatewayCredentialProviderName?: string
}

/**
 * The agent runtime and its short-term memory. Loosely coupled to the gateway: it reads
 * the gateway URL from SSM and authenticates via the OAuth2 credential provider (looked up
 * by name), so it has no deploy-time dependency on the gateway construct.
 */
export class AgentConstruct extends Construct {
  public runtimeArn: string
  public memoryArn: string
  private readonly region: string
  private readonly account: string
  private agentRuntime: agentcore.Runtime

  constructor(scope: Construct, id: string, props: AgentConstructProps) {
    super(scope, id)

    const stack = cdk.Stack.of(this)
    this.region = stack.region
    this.account = stack.account
    this.createAgentCoreRuntime(
      props.config,
      props.userPoolId,
      props.userPoolClientId,
      props.gatewayCredentialProviderName
    )

    new ssm.StringParameter(this, "RuntimeArnParam", {
      parameterName: `/${props.config.stack_name_base}/runtime-arn`,
      stringValue: this.runtimeArn,
    })
  }

  private createAgentCoreRuntime(
    config: AppConfig,
    userPoolId: string,
    userPoolClientId: string,
    gatewayCredentialProviderName?: string
  ): void {
    const pattern = config.backend?.pattern || "strands-single-agent"
    const stack = cdk.Stack.of(this)
    const deploymentType = config.backend.deployment_type

    let agentRuntimeArtifact: agentcore.AgentRuntimeArtifact
    let zipPackagerResource: cdk.CustomResource | undefined

    if (
      deploymentType === "zip" &&
      (pattern === "claude-agent-sdk-single-agent" || pattern === "claude-agent-sdk-multi-agent")
    ) {
      throw new Error(
        "claude-agent-sdk patterns require Docker deployment (deployment_type: docker) " +
          "because they need Node.js and the claude-code CLI installed at build time."
      )
    }

    if (deploymentType === "zip") {
      // ZIP DEPLOYMENT: Use Lambda to package and upload to S3 (no Docker required)
      const repoRoot = path.resolve(__dirname, "..", "..", "..") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const patternDir = path.join(repoRoot, "patterns", pattern) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal

      const agentCodeBucket = new s3.Bucket(this, "AgentCodeBucket", {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        versioned: true,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      })

      const packagerLambda = new lambda.Function(this, "ZipPackagerLambda", {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "index.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../../lambdas/zip-packager") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        ),
        timeout: cdk.Duration.minutes(10),
        memorySize: 1024,
        ephemeralStorageSize: cdk.Size.gibibytes(2),
      })

      agentCodeBucket.grantReadWrite(packagerLambda)

      const agentCode: Record<string, string> = {}
      const readPatternFiles = (dir: string, prefix: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
          const relativePath = prefix ? path.join(prefix, entry.name) : entry.name // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
          if (entry.isDirectory() && entry.name !== "__pycache__") {
            readPatternFiles(fullPath, relativePath)
          } else if (entry.isFile()) {
            agentCode[relativePath] = fs.readFileSync(fullPath).toString("base64")
          }
        }
      }
      readPatternFiles(patternDir, "")

      const gatewayDir = path.join(repoRoot, "gateway") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      if (fs.existsSync(gatewayDir)) {
        this.readDirRecursive(gatewayDir, "gateway", agentCode)
      }
      const repoToolsDir = path.join(repoRoot, "tools") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      if (fs.existsSync(repoToolsDir)) {
        this.readDirRecursive(repoToolsDir, "agentcore_tools", agentCode)
      }

      const utilsDir = path.join(repoRoot, "patterns", "utils") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      if (fs.existsSync(utilsDir)) {
        this.readDirRecursive(utilsDir, "utils", agentCode)
      }

      const requirementsPath = path.join(patternDir, "requirements.txt") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const requirements = fs
        .readFileSync(requirementsPath, "utf-8")
        .split("\n")
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#"))

      const contentHash = this.hashContent(JSON.stringify({ requirements, agentCode }))

      const provider = new cr.Provider(this, "ZipPackagerProvider", {
        onEventHandler: packagerLambda,
      })

      zipPackagerResource = new cdk.CustomResource(this, "ZipPackager", {
        serviceToken: provider.serviceToken,
        properties: {
          BucketName: agentCodeBucket.bucketName,
          ObjectKey: "deployment_package.zip",
          Requirements: requirements,
          AgentCode: agentCode,
          ContentHash: contentHash,
        },
      })

      new ssm.StringParameter(this, "AgentCodeBucketNameParam", {
        parameterName: `/${config.stack_name_base}/agent-code-bucket`,
        stringValue: agentCodeBucket.bucketName,
        description: "S3 bucket for agent code deployment packages",
      })

      const mainFiles = fs
        .readdirSync(patternDir)
        .filter((f: string) => f.endsWith(".py") && f !== "__init__.py")
      const agentEntryPoint =
        mainFiles.length === 1
          ? mainFiles[0]
          : mainFiles.find((f: string) => f.includes("agent") && f !== "__init__.py") ||
            mainFiles[0]

      agentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromS3(
        {
          bucketName: agentCodeBucket.bucketName,
          objectKey: "deployment_package.zip",
        },
        agentcore.AgentCoreRuntime.PYTHON_3_12,
        ["opentelemetry-instrument", agentEntryPoint]
      )
    } else {
      // DOCKER DEPLOYMENT: container-based
      agentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromAsset(
        path.resolve(__dirname, "..", "..", ".."), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        {
          platform: ecr_assets.Platform.LINUX_ARM64,
          file: `patterns/${pattern}/Dockerfile`,
        }
      )
    }

    // [Network] Plug point for runtime networking. PUBLIC (default) or VPC, selected by
    // config.backend.network_mode. To change networking behavior, edit only
    // buildNetworkConfiguration(); the rest of the agent is network-agnostic.
    const networkConfiguration = this.buildNetworkConfiguration(config)

    // JWT authorizer (Cognito issuer).
    const authorizerConfiguration = agentcore.RuntimeAuthorizerConfiguration.usingJWT(
      `https://cognito-idp.${stack.region}.amazonaws.com/${userPoolId}/.well-known/openid-configuration`,
      [userPoolClientId]
    )

    const agentRole = new AgentCoreRole(this, "AgentCoreRole")

    const memory = new agentcore.Memory(this, "AgentMemory", {
      memoryName: cdk.Names.uniqueResourceName(this, { maxLength: 48 }),
      expirationDuration: cdk.Duration.days(30),
      description: `Short-term memory for ${config.stack_name_base} agent`,
      // [Long-term memory] OPTIONAL, off by default (config.backend.use_long_term_memory).
      // When enabled, a SemanticMemoryStrategy extracts and stores facts across sessions
      // (incurs per-record cost). When disabled, the memory is short-term only — no
      // strategy, no extraction, no cost. Retrieval is additionally gated in the agent via
      // the USE_LONG_TERM_MEMORY env var. To remove LTM entirely, drop this strategy list.
      memoryStrategies: config.backend.use_long_term_memory
        ? [
            agentcore.MemoryStrategy.usingSemantic({
              strategyName: "FactExtractor",
              namespaces: ["/facts/{actorId}"],
            }),
          ]
        : [],
      executionRole: agentRole,
      tags: {
        Name: `${config.stack_name_base}_Memory`,
        ManagedBy: "CDK",
      },
    })
    const memoryId = memory.memoryId
    this.memoryArn = memory.memoryArn

    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "MemoryResourceAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:GetEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:RetrieveMemoryRecords",
        ],
        resources: [this.memoryArn],
      })
    )

    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "SSMParameterAccess",
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${config.stack_name_base}/*`,
        ],
      })
    )

    // [Code interpreter] OPTIONAL capability: lets the agent run code in an AgentCore
    // sandbox. Remove this statement if your agent doesn't use the code interpreter tool.
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CodeInterpreterAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:StartCodeInterpreterSession",
          "bedrock-agentcore:StopCodeInterpreterSession",
          "bedrock-agentcore:InvokeCodeInterpreter",
        ],
        resources: [`arn:aws:bedrock-agentcore:${this.region}:aws:code-interpreter/*`],
      })
    )

    const envVars: { [key: string]: string } = {
      AWS_REGION: stack.region,
      AWS_DEFAULT_REGION: stack.region,
      MEMORY_ID: memoryId,
      STACK_NAME: config.stack_name_base,
      // [Long-term memory] runtime config: USE_LONG_TERM_MEMORY gates retrieval in the
      // agent (paired with the strategy above); the two LTM_* values tune retrieval.
      USE_LONG_TERM_MEMORY: config.backend.use_long_term_memory ? "true" : "false",
      LTM_TOP_K: String(config.backend.ltm_top_k),
      LTM_RELEVANCE_SCORE: String(config.backend.ltm_relevance_score),
    }

    // Agent <-> Gateway integration. This is the SINGLE point of coupling between the
    // agent and the gateway, and it is opt-in: it runs only when the composition root
    // passes gatewayCredentialProviderName. Omit that prop (and the GatewayConstruct) to
    // run the agent without a gateway — nothing else in the agent depends on it.
    if (gatewayCredentialProviderName) {
      this.addGatewayIntegration(config, gatewayCredentialProviderName, agentRole, envVars)
    }

    if (pattern === "claude-agent-sdk-single-agent" || pattern === "claude-agent-sdk-multi-agent") {
      envVars["CLAUDE_CODE_USE_BEDROCK"] = "1"
    }

    this.agentRuntime = new agentcore.Runtime(this, "Runtime", {
      runtimeName: `${config.stack_name_base.replace(/-/g, "_")}_${config.backend.agent_name}`,
      agentRuntimeArtifact: agentRuntimeArtifact,
      executionRole: agentRole,
      networkConfiguration: networkConfiguration,
      protocolConfiguration: agentcore.ProtocolType.HTTP,
      environmentVariables: envVars,
      authorizerConfiguration: authorizerConfiguration,
      requestHeaderConfiguration: {
        allowlistedHeaders: ["Authorization"],
      },
      description: `${pattern} agent runtime for ${config.stack_name_base}`,
    })

    if (zipPackagerResource) {
      this.agentRuntime.node.addDependency(zipPackagerResource)
    }

    this.runtimeArn = this.agentRuntime.agentRuntimeArn

    new cdk.CfnOutput(this, "AgentRuntimeId", {
      description: "ID of the created agent runtime",
      value: this.agentRuntime.agentRuntimeId,
    })

    new cdk.CfnOutput(this, "AgentRuntimeArn", {
      description: "ARN of the created agent runtime",
      value: this.agentRuntime.agentRuntimeArn,
      exportName: `${config.stack_name_base}-AgentRuntimeArn`,
    })

    new cdk.CfnOutput(this, "AgentRoleArn", {
      description: "ARN of the agent execution role",
      value: agentRole.roleArn,
    })

    new cdk.CfnOutput(this, "MemoryArn", {
      description: "ARN of the agent memory resource",
      value: this.memoryArn,
    })
  }

  /**
   * Wires the agent to the AgentCore Gateway: the credential-provider name the runtime's
   * @requires_access_token flow looks up, plus the OAuth2 / Secrets Manager permissions to
   * fetch gateway access tokens at runtime.
   *
   * This is the ONLY agent->gateway dependency. To run the agent without a gateway,
   * remove the single call to this method (and the GatewayConstruct from the stack);
   * nothing else in the agent references the gateway.
   */
  private addGatewayIntegration(
    config: AppConfig,
    credentialProviderName: string,
    agentRole: AgentCoreRole,
    envVars: { [key: string]: string }
  ): void {
    // Name used by @requires_access_token to look up the gateway credential provider.
    envVars["GATEWAY_CREDENTIAL_PROVIDER_NAME"] = credentialProviderName

    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "OAuth2CredentialProviderAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:GetOauth2CredentialProvider",
          "bedrock-agentcore:GetResourceOauth2Token",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:oauth2-credential-provider/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/*`,
        ],
      })
    )

    agentRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "SecretsManagerOAuth2Access",
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:/${config.stack_name_base}/machine_client_secret*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity!default/oauth2/${credentialProviderName}*`,
        ],
      })
    )
  }

  private buildNetworkConfiguration(config: AppConfig): agentcore.RuntimeNetworkConfiguration {
    if (config.backend.network_mode === "VPC") {
      const vpcConfig = config.backend.vpc
      if (!vpcConfig) {
        throw new Error("backend.vpc configuration is required when network_mode is 'VPC'.")
      }

      const vpc = ec2.Vpc.fromLookup(this, "ImportedVpc", {
        vpcId: vpcConfig.vpc_id,
      })

      const subnets: ec2.ISubnet[] = vpcConfig.subnet_ids.map((subnetId: string, index: number) =>
        ec2.Subnet.fromSubnetId(this, `ImportedSubnet${index}`, subnetId)
      )

      const securityGroups =
        vpcConfig.security_group_ids && vpcConfig.security_group_ids.length > 0
          ? vpcConfig.security_group_ids.map((sgId: string, index: number) =>
              ec2.SecurityGroup.fromSecurityGroupId(this, `ImportedSG${index}`, sgId)
            )
          : undefined

      const vpcConfigProps: agentcore.VpcConfigProps = {
        vpc: vpc,
        vpcSubnets: {
          subnets: subnets,
        },
        securityGroups: securityGroups,
      }

      return agentcore.RuntimeNetworkConfiguration.usingVpc(this, vpcConfigProps)
    }

    return agentcore.RuntimeNetworkConfiguration.usingPublicNetwork()
  }

  private readDirRecursive(dirPath: string, prefix: string, output: Record<string, string>): void {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const relativePath = path.join(prefix, entry.name) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      if (entry.isDirectory()) {
        if (entry.name !== "__pycache__") {
          this.readDirRecursive(fullPath, relativePath, output)
        }
      } else if (entry.isFile()) {
        output[relativePath] = fs.readFileSync(fullPath).toString("base64")
      }
    }
  }

  private hashContent(content: string): string {
    const crypto = require("crypto")
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)
  }
}
