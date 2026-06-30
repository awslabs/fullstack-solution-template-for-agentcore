import * as cdk from "aws-cdk-lib"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as iam from "aws-cdk-lib/aws-iam"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as logs from "aws-cdk-lib/aws-logs"
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore"
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as cr from "aws-cdk-lib/custom-resources"
import { Construct } from "constructs"
import { AppConfig } from "../utils/config-manager"
import * as path from "path"
import * as fs from "fs"

export interface GatewayConstructProps {
  config: AppConfig
  /** User pool, used for the OIDC issuer/discovery URL and Cognito describe permissions. */
  userPool: cognito.IUserPool
  /** Machine (M2M) client whose id is the gateway authorizer's allowed client. */
  machineClient: cognito.UserPoolClient
  /** Machine client secret, read by the OAuth2 credential provider Lambda. */
  machineClientSecret: secretsmanager.Secret
}

/**
 * AgentCore Gateway and its sample Lambda target, plus the OAuth2 credential provider
 * the runtime uses to authenticate to the gateway. Cedar policy (authorization) is
 * optional and only created when config.backend.use_policy_engine is true.
 *
 * Inbound auth and the target are intentionally created here from config so they can be
 * swapped (e.g. a different JWT issuer, or non-Lambda targets) without changing callers.
 */
export class GatewayConstruct extends Construct {
  public readonly gatewayUrl: string
  public readonly gatewayArn: string
  /**
   * Name of the OAuth2 credential provider the runtime uses to authenticate to this
   * gateway. Pass to AgentConstruct's gatewayCredentialProviderName prop to wire the
   * agent to this gateway. Source of truth for the agent<->gateway integration.
   */
  public readonly credentialProviderName: string
  private readonly region: string
  private readonly account: string

  constructor(scope: Construct, id: string, props: GatewayConstructProps) {
    super(scope, id)

    const stack = cdk.Stack.of(this)
    this.region = stack.region
    this.account = stack.account
    const { config, userPool, machineClient, machineClientSecret } = props

    // Create sample tool Lambda
    const toolLambda = new lambda.Function(this, "SampleToolLambda", {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "sample_tool_lambda.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../../gateway/tools/sample_tool") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      ),
      timeout: cdk.Duration.seconds(30),
      logGroup: new logs.LogGroup(this, "SampleToolLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-sample-tool`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Comprehensive IAM role for the gateway
    const gatewayRole = new iam.Role(this, "GatewayRole", {
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      description: "Role for AgentCore Gateway with comprehensive permissions",
    })

    toolLambda.grantInvoke(gatewayRole)

    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          "arn:aws:bedrock:*::foundation-model/*",
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      })
    )

    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${config.stack_name_base}/*`,
        ],
      })
    )

    // Cognito permissions (IdP-specific; swap for a different identity provider).
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["cognito-idp:DescribeUserPoolClient", "cognito-idp:InitiateAuth"],
        resources: [userPool.userPoolArn],
      })
    )

    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/*`,
        ],
      })
    )

    // Policy Engine access — required for the Gateway to verify and evaluate Cedar policies
    // at runtime when a policy engine is attached.
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock-agentcore:GetPolicyEngine",
          "bedrock-agentcore:AuthorizeAction",
          "bedrock-agentcore:PartiallyAuthorizeActions",
          "bedrock-agentcore:CheckAuthorizePermissions",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:policy-engine/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:/policy-engines/*`,
        ],
      })
    )

    const toolSpecPath = path.join(
      __dirname,
      "../../../gateway/tools/sample_tool/tool_spec.json" // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    )

    // OIDC issuer/discovery URL for the inbound authorizer (Cognito today).
    const cognitoIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`
    const cognitoDiscoveryUrl = `${cognitoIssuer}/.well-known/openid-configuration`

    // OAuth2 Credential Provider so the runtime can authenticate to the gateway.
    const providerName = `${config.stack_name_base}-runtime-gateway-auth`
    this.credentialProviderName = providerName

    const oauth2ProviderLambda = new lambda.Function(this, "OAuth2ProviderLambda", {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../lambdas/oauth2-provider") // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      ),
      timeout: cdk.Duration.minutes(5),
      logGroup: new logs.LogGroup(this, "OAuth2ProviderLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-oauth2-provider`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    machineClientSecret.grantRead(oauth2ProviderLambda)

    oauth2ProviderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:CreateOauth2CredentialProvider",
          "bedrock-agentcore:DeleteOauth2CredentialProvider",
          "bedrock-agentcore:GetOauth2CredentialProvider",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default/oauth2credentialprovider/*`,
        ],
      })
    )

    oauth2ProviderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:CreateTokenVault",
          "bedrock-agentcore:GetTokenVault",
          "bedrock-agentcore:DeleteTokenVault",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default/*`,
        ],
      })
    )

    oauth2ProviderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "secretsmanager:CreateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret",
          "secretsmanager:PutSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity!default/oauth2/*`,
        ],
      })
    )

    const oauth2Provider = new cr.Provider(this, "OAuth2ProviderProvider", {
      onEventHandler: oauth2ProviderLambda,
    })

    new cdk.CustomResource(this, "RuntimeCredentialProvider", {
      serviceToken: oauth2Provider.serviceToken,
      properties: {
        ProviderName: providerName,
        ClientSecretArn: machineClientSecret.secretArn,
        DiscoveryUrl: cognitoDiscoveryUrl,
        ClientId: machineClient.userPoolClientId,
      },
    })

    // Create Gateway using L2 construct.
    // [SWAP POINTS] authorizerConfiguration is the inbound-auth plug point (Cognito custom
    // JWT here; GatewayAuthorizer also supports IAM / other JWT issuers). The target below
    // is the tool plug point (a Lambda here; targets can also be OpenAPI/Smithy, and you
    // can add more than one). Both are local to this construct — swap without touching callers.
    const gateway = new agentcore.Gateway(this, "AgentCoreGateway", {
      gatewayName: `${config.stack_name_base}-gateway`,
      role: gatewayRole,
      protocolConfiguration: new agentcore.McpProtocolConfiguration({
        supportedVersions: [agentcore.MCPProtocolVersion.MCP_2025_03_26],
      }),
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingCustomJwt({
        discoveryUrl: cognitoDiscoveryUrl,
        allowedClients: [machineClient.userPoolClientId],
      }),
      description: "AgentCore Gateway with MCP protocol and JWT authentication",
    })

    // Gateway target. addLambdaTarget grants invoke + the resource-based permission the
    // CreateGatewayTarget dry-run validation requires.
    const gatewayTarget = gateway.addLambdaTarget("GatewayTarget", {
      gatewayTargetName: "sample-tool-target",
      description: "Sample tool Lambda target",
      lambdaFunction: toolLambda,
      toolSchema: agentcore.ToolSchema.fromLocalAsset(toolSpecPath),
    })

    gateway.node.addDependency(machineClient)
    gateway.node.addDependency(gatewayRole)

    this.gatewayUrl = gateway.gatewayUrl!
    this.gatewayArn = gateway.gatewayArn

    // Optionally add AgentCore Policy (Cedar) for fine-grained, per-tool authorization.
    // Off by default. The gateway enforces authentication regardless; this adds authorization.
    if (config.backend.use_policy_engine) {
      this.createCedarPolicy(config, gateway, gatewayRole, gatewayTarget)
    }

    // Store AgentCore Gateway URL in SSM for AgentCore Runtime access
    new ssm.StringParameter(this, "GatewayUrlParam", {
      parameterName: `/${config.stack_name_base}/gateway_url`,
      stringValue: gateway.gatewayUrl!,
      description: "AgentCore Gateway URL",
    })

    new cdk.CfnOutput(this, "GatewayId", {
      value: gateway.gatewayId,
      description: "AgentCore Gateway ID",
    })

    new cdk.CfnOutput(this, "GatewayUrl", {
      value: gateway.gatewayUrl!,
      description: "AgentCore Gateway URL",
    })

    new cdk.CfnOutput(this, "GatewayArn", {
      value: gateway.gatewayArn,
      description: "AgentCore Gateway ARN",
    })

    new cdk.CfnOutput(this, "GatewayTargetId", {
      value: gatewayTarget.targetId,
      description: "AgentCore Gateway Target ID",
    })

    new cdk.CfnOutput(this, "ToolLambdaArn", {
      description: "ARN of the sample tool Lambda",
      value: toolLambda.functionArn,
    })
  }

  /**
   * Creates the AgentCore Policy (Cedar) engine and policy and attaches it to the gateway.
   * Only invoked when config.backend.use_policy_engine is true.
   */
  private createCedarPolicy(
    config: AppConfig,
    gateway: agentcore.Gateway,
    gatewayRole: iam.Role,
    gatewayTarget: agentcore.GatewayTarget
  ): void {
    const cedarPolicyLambda = new PythonFunction(this, "CedarPolicyLambda", {
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(__dirname, "../../lambdas/cedar-policy"), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      handler: "handler",
      timeout: cdk.Duration.minutes(14),
      logGroup: new logs.LogGroup(this, "CedarPolicyLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-cedar-policy`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    cedarPolicyLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:CreatePolicyEngine",
          "bedrock-agentcore:GetPolicyEngine",
          "bedrock-agentcore:DeletePolicyEngine",
          "bedrock-agentcore:ListPolicyEngines",
          "bedrock-agentcore:CreatePolicy",
          "bedrock-agentcore:GetPolicy",
          "bedrock-agentcore:DeletePolicy",
          "bedrock-agentcore:ListPolicies",
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:policy-engine/*`,
        ],
      })
    )

    // InvokeGateway is required for CreatePolicy/UpdatePolicy: policy validation calls the
    // gateway to validate the actions in the Cedar statement against its tools.
    cedarPolicyLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:UpdateGateway",
          "bedrock-agentcore:GetGateway",
          "bedrock-agentcore:InvokeGateway",
          "bedrock-agentcore:ManageResourceScopedPolicy",
          "bedrock-agentcore:ListGatewayTargets",
        ],
        resources: [gateway.gatewayArn],
      })
    )

    cedarPolicyLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [gatewayRole.roleArn],
      })
    )

    const cedarPolicyProvider = new cr.Provider(this, "CedarPolicyProvider", {
      onEventHandler: cedarPolicyLambda,
    })

    const policyDocument = fs
      .readFileSync(
        path.join(__dirname, "../../../gateway/policies/policy.cedar"), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        "utf-8"
      )
      .split("\n")
      .filter((line: string) => !line.trimStart().startsWith("//"))
      .join("\n")
      .trim()
      .replaceAll("{{GATEWAY_ARN}}", gateway.gatewayArn)

    const cedarPolicy = new cdk.CustomResource(this, "GatewayPolicy", {
      serviceToken: cedarPolicyProvider.serviceToken,
      properties: {
        GatewayIdentifier: gateway.gatewayId,
        PolicyDocument: policyDocument,
        PolicyEngineName: `${config.stack_name_base.replace(/-/g, "_")}_policy_engine`,
        Description: "Department-based tool access control for AgentCore Policy demo",
      },
    })

    cedarPolicy.node.addDependency(gatewayTarget)

    new cdk.CfnOutput(this, "PolicyEngineId", {
      description: "ID of the Policy Engine for Cedar policies",
      value: cedarPolicy.getAttString("PolicyEngineId"),
    })

    new cdk.CfnOutput(this, "CedarPolicyId", {
      description: "ID of the Cedar policy for department-based access control",
      value: cedarPolicy.getAttString("PolicyId"),
    })
  }
}
