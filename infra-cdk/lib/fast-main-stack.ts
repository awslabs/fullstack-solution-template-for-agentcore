import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import { AppConfig } from "./utils/config-manager"

// Import constructs
import { AmplifyHostingConstruct } from "./constructs/amplify-hosting"
import { CognitoConstruct } from "./constructs/cognito"
import { GatewayConstruct } from "./constructs/gateway"
import { AgentConstruct } from "./constructs/agent"
import { ApiConstruct } from "./constructs/api"

export interface FastAmplifyStackProps extends cdk.StackProps {
  config: AppConfig
}

export class FastMainStack extends cdk.Stack {
  public readonly amplifyHosting: AmplifyHostingConstruct
  public readonly cognito: CognitoConstruct
  public readonly gateway: GatewayConstruct
  public readonly agent: AgentConstruct
  public readonly api: ApiConstruct

  constructor(scope: Construct, id: string, props: FastAmplifyStackProps) {
    const description =
      "Fullstack AgentCore Solution Template - Main Stack (v0.4.2) (uksb-v6dos0t5g8)"
    super(scope, id, { ...props, description })

    // =========================================================================
    // Composition root. Each construct below is a self-contained feature with a
    // documented plug point: what it provides, what it depends on, and how to
    // remove or swap it. Resources are owned by their construct, so deleting a
    // construct (and any noted integration call) removes everything it created.
    // =========================================================================

    // [Hosting] Frontend hosting on Amplify. Provides the predictable app URL used
    // for Cognito callback/logout URLs. Remove if you host the frontend elsewhere;
    // then supply callback URLs to Cognito by another means.
    this.amplifyHosting = new AmplifyHostingConstruct(this, `${id}-amplify`, {
      config: props.config,
    })

    // [Identity] Cognito user pool + M2M client, and the identity SSM contract
    // (issuer, client ids). SWAP POINT for a different IdP: replace this construct
    // with one that publishes the same outputs (userPool, machineClient,
    // machineClientSecret, SSM params); downstream constructs depend only on those.
    this.cognito = new CognitoConstruct(this, `${id}-cognito`, {
      config: props.config,
      callbackUrls: ["http://localhost:3000", this.amplifyHosting.amplifyUrl],
    })

    // [Gateway] AgentCore Gateway exposing tools over MCP, with inbound JWT auth from
    // the M2M client and an optional Cedar policy. OPTIONAL: to run without a gateway,
    // delete this construct AND the agent's addGatewayIntegration() call (see agent.ts).
    // Depends on: Cognito (machine client + secret for inbound auth / OAuth2 provider).
    this.gateway = new GatewayConstruct(this, `${id}-gateway`, {
      config: props.config,
      userPool: this.cognito.userPool,
      machineClient: this.cognito.machineClient,
      machineClientSecret: this.cognito.machineClientSecret,
    })

    // [Agent] The AgentCore runtime + short-term memory (the core). Depends on:
    // Cognito (JWT issuer/client for the runtime authorizer). The gatewayCredentialProviderName
    // prop is the single agent<->gateway seam: it opts the agent into authenticating to the
    // gateway. Omit it (and the GatewayConstruct above) to run the agent with no gateway.
    this.agent = new AgentConstruct(this, `${id}-agent`, {
      config: props.config,
      userPoolId: this.cognito.userPoolId,
      userPoolClientId: this.cognito.userPoolClientId,
      gatewayCredentialProviderName: this.gateway.credentialProviderName,
    })

    // [API] Generic REST API (API Gateway) with a shared Cognito authorizer. The
    // feedback endpoint inside is an EXAMPLE route. OPTIONAL: remove if you don't need
    // an HTTP API; add your own routes via api.restApi / api.authorizer. Depends on:
    // Cognito (authorizer) and the Amplify URL (CORS).
    this.api = new ApiConstruct(this, `${id}-api`, {
      config: props.config,
      userPool: this.cognito.userPool,
      frontendUrl: this.amplifyHosting.amplifyUrl,
    })

    // Outputs
    new cdk.CfnOutput(this, "AmplifyAppId", {
      value: this.amplifyHosting.amplifyApp.appId,
      description: "Amplify App ID - use this for manual deployment",
      exportName: `${props.config.stack_name_base}-AmplifyAppId`,
    })

    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: this.cognito.userPoolId,
      description: "Cognito User Pool ID",
      exportName: `${props.config.stack_name_base}-CognitoUserPoolId`,
    })

    new cdk.CfnOutput(this, "CognitoClientId", {
      value: this.cognito.userPoolClientId,
      description: "Cognito User Pool Client ID",
      exportName: `${props.config.stack_name_base}-CognitoClientId`,
    })

    new cdk.CfnOutput(this, "CognitoDomain", {
      value: `${this.cognito.userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      description: "Cognito Domain for OAuth",
      exportName: `${props.config.stack_name_base}-CognitoDomain`,
    })

    new cdk.CfnOutput(this, "RuntimeArn", {
      value: this.agent.runtimeArn,
      description: "AgentCore Runtime ARN",
      exportName: `${props.config.stack_name_base}-RuntimeArn`,
    })

    new cdk.CfnOutput(this, "MemoryArn", {
      value: this.agent.memoryArn,
      description: "AgentCore Memory ARN",
      exportName: `${props.config.stack_name_base}-MemoryArn`,
    })

    new cdk.CfnOutput(this, "FeedbackApiUrl", {
      value: this.api.apiUrl,
      description: "Feedback API Gateway URL",
      exportName: `${props.config.stack_name_base}-FeedbackApiUrl`,
    })

    new cdk.CfnOutput(this, "AmplifyConsoleUrl", {
      value: `https://console.aws.amazon.com/amplify/apps/${this.amplifyHosting.amplifyApp.appId}`,
      description: "Amplify Console URL for monitoring deployments",
    })

    new cdk.CfnOutput(this, "AmplifyUrl", {
      value: this.amplifyHosting.amplifyUrl,
      description: "Amplify Frontend URL (available after deployment)",
    })

    new cdk.CfnOutput(this, "StagingBucketName", {
      value: this.amplifyHosting.stagingBucket.bucketName,
      description: "S3 bucket for Amplify deployment staging",
      exportName: `${props.config.stack_name_base}-StagingBucket`,
    })
  }
}
