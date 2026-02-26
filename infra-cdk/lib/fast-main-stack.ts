import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import { AppConfig } from "./utils/config-manager"

// Import constructs (no longer nested stacks)
import { BackendConstruct } from "./backend-stack"
import { AmplifyHostingConstruct } from "./amplify-hosting-stack"
import { CognitoConstruct } from "./cognito-stack"

export interface FastAmplifyStackProps extends cdk.StackProps {
  config: AppConfig
}

export class FastMainStack extends cdk.Stack {
  public readonly amplifyHostingConstruct: AmplifyHostingConstruct
  public readonly backendConstruct: BackendConstruct
  public readonly cognitoConstruct: CognitoConstruct

  constructor(scope: Construct, id: string, props: FastAmplifyStackProps) {
    const description =
      "Fullstack AgentCore Solution Template - Main Stack (v0.3.1) (uksb-v6dos0t5g8)"
    super(scope, id, { ...props, description })

    // Step 1: Create the Amplify construct to get the predictable domain
    this.amplifyHostingConstruct = new AmplifyHostingConstruct(this, `${id}-amplify`, {
      config: props.config,
    })

    this.cognitoConstruct = new CognitoConstruct(this, `${id}-cognito`, {
      config: props.config,
      callbackUrls: ["http://localhost:3000", this.amplifyHostingConstruct.amplifyUrl],
    })

    // Step 2: Create backend construct with the predictable Amplify URL and Cognito details
    this.backendConstruct = new BackendConstruct(this, `${id}-backend`, {
      config: props.config,
      userPoolId: this.cognitoConstruct.userPoolId,
      userPoolClientId: this.cognitoConstruct.userPoolClientId,
      userPoolDomain: this.cognitoConstruct.userPoolDomain,
      frontendUrl: this.amplifyHostingConstruct.amplifyUrl,
    })

    // Outputs
    new cdk.CfnOutput(this, "AmplifyAppId", {
      value: this.amplifyHostingConstruct.amplifyApp.appId,
      description: "Amplify App ID - use this for manual deployment",
      exportName: `${props.config.stack_name_base}-AmplifyAppId`,
    })

    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: this.cognitoConstruct.userPoolId,
      description: "Cognito User Pool ID",
      exportName: `${props.config.stack_name_base}-CognitoUserPoolId`,
    })

    new cdk.CfnOutput(this, "CognitoClientId", {
      value: this.cognitoConstruct.userPoolClientId,
      description: "Cognito User Pool Client ID",
      exportName: `${props.config.stack_name_base}-CognitoClientId`,
    })

    new cdk.CfnOutput(this, "CognitoDomain", {
      value: `${this.cognitoConstruct.userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      description: "Cognito Domain for OAuth",
      exportName: `${props.config.stack_name_base}-CognitoDomain`,
    })

    new cdk.CfnOutput(this, "RuntimeArn", {
      value: this.backendConstruct.runtimeArn,
      description: "AgentCore Runtime ARN",
      exportName: `${props.config.stack_name_base}-RuntimeArn`,
    })

    new cdk.CfnOutput(this, "MemoryArn", {
      value: this.backendConstruct.memoryArn,
      description: "AgentCore Memory ARN",
      exportName: `${props.config.stack_name_base}-MemoryArn`,
    })

    new cdk.CfnOutput(this, "FeedbackApiUrl", {
      value: this.backendConstruct.feedbackApiUrl,
      description: "Feedback API Gateway URL",
      exportName: `${props.config.stack_name_base}-FeedbackApiUrl`,
    })

    new cdk.CfnOutput(this, "AmplifyConsoleUrl", {
      value: `https://console.aws.amazon.com/amplify/apps/${this.amplifyHostingConstruct.amplifyApp.appId}`,
      description: "Amplify Console URL for monitoring deployments",
    })

    new cdk.CfnOutput(this, "AmplifyUrl", {
      value: this.amplifyHostingConstruct.amplifyUrl,
      description: "Amplify Frontend URL (available after deployment)",
    })

    new cdk.CfnOutput(this, "StagingBucketName", {
      value: this.amplifyHostingConstruct.stagingBucket.bucketName,
      description: "S3 bucket for Amplify deployment staging",
      exportName: `${props.config.stack_name_base}-StagingBucket`,
    })
  }
}
