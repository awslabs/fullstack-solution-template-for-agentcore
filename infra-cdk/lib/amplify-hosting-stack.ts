import * as cdk from "aws-cdk-lib"
import * as amplify from "@aws-cdk/aws-amplify-alpha"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as iam from "aws-cdk-lib/aws-iam"
import { Construct } from "constructs"
import { AppConfig } from "./utils/config-manager"

export interface AmplifyStackProps extends cdk.NestedStackProps {
  config: AppConfig
}

export class AmplifyHostingStack extends cdk.NestedStack {
  public readonly amplifyApp: amplify.App
  public readonly amplifyUrl: string
  public readonly stagingBucket: s3.Bucket

  constructor(scope: Construct, id: string, props: AmplifyStackProps) {
    const description = "GenAIID AgentCore Starter Pack - Amplify Hosting Stack"
    super(scope, id, { ...props, description })

    // Create staging bucket for Amplify deployments with dynamic name
    this.stagingBucket = new s3.Bucket(this, "StagingBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true, // Enable versioning as required by Amplify
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: "DeleteOldDeployments",
          enabled: true,
          expiration: cdk.Duration.days(30), // Clean up old deployment artifacts after 30 days
        },
      ],
    })

    // Add bucket policy to allow Amplify service access
    this.stagingBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AmplifyAccess",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("amplify.amazonaws.com")],
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        resources: [this.stagingBucket.arnForObjects("*")],
      })
    )

    // Create the Amplify app
    this.amplifyApp = new amplify.App(this, "AmplifyApp", {
      appName: `${props.config.stack_name_base}-frontend`,
      description: `${props.config.stack_name_base} - React/Next.js Frontend`,
      platform: amplify.Platform.WEB,
    })

    // Create main branch for the Amplify app
    this.amplifyApp.addBranch("main", {
      stage: "PRODUCTION",
      branchName: "main",
    })

    // The predictable domain format: https://main.{appId}.amplifyapp.com
    this.amplifyUrl = `https://main.${this.amplifyApp.appId}.amplifyapp.com`
  }
}
