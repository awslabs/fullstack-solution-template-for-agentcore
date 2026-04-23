import * as cdk from "aws-cdk-lib"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as iam from "aws-cdk-lib/aws-iam"
import * as logs from "aws-cdk-lib/aws-logs"
import * as path from "path"
import { Construct } from "constructs"
import { AppConfig } from "./utils/config-manager"

export interface CognitoStackProps extends cdk.NestedStackProps {
  config: AppConfig
  callbackUrls?: string[]
}

export class CognitoStack extends cdk.NestedStack {
  public userPoolId: string
  public userPoolClientId: string
  public userPoolDomain: cognito.UserPoolDomain

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props)

    this.createCognitoUserPool(props.config, props.callbackUrls)
  }

  private createCognitoUserPool(config: AppConfig, callbackUrls?: string[]): void {
    // Use provided callback URLs or defaults
    const defaultCallbackUrls = ["http://localhost:3000", "https://localhost:3000"]
    const finalCallbackUrls = callbackUrls || defaultCallbackUrls

    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${config.stack_name_base}-user-pool`,
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // Essentials tier is required for V3 Pre-Token Generation Lambda triggers.
      // V3 triggers fire on Client Credentials (M2M) grants, enabling user identity
      // propagation into M2M tokens for AgentCore Policy enforcement.
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      userInvitation: {
        emailSubject: `Welcome to ${config.stack_name_base}!`,
        emailBody: `<p>Hello {username},</p>
<p>Welcome to ${config.stack_name_base}! Your username is <strong>{username}</strong> and your temporary password is: <strong>{####}</strong></p>
<p>Please use this temporary password to log in and set your permanent password.</p>
<p>The CloudFront URL to your application is stored as an output in the "${config.stack_name_base}" stack, and will be printed to your terminal once the deployment process completes.</p>
<p>Thanks,</p>
<p>Fullstack AgentCore Solution Template Team</p>`,
      },
    })

    const userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: userPool,
      userPoolClientName: `${config.stack_name_base}-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        // Support both localhost development and production URLs
        callbackUrls: finalCallbackUrls,
        logoutUrls: finalCallbackUrls,
      },
      preventUserExistenceErrors: true,
    })

    // Create domain without managedLoginVersion initially to avoid race condition
    // with CfnManagedLoginBranding. The domain is updated to v2 after branding is created
    // via L1 escape hatch below. This resolves "Internal error from downstream service"
    // that occurs with newer CDK versions when ESSENTIALS tier + NEWER_MANAGED_LOGIN +
    // CfnManagedLoginBranding are created simultaneously.
    this.userPoolDomain = new cognito.UserPoolDomain(this, "UserPoolDomain", {
      userPool: userPool,
      cognitoDomain: {
        domainPrefix: `${config.stack_name_base.toLowerCase()}-${cdk.Aws.ACCOUNT_ID}-${
          cdk.Aws.REGION
        }`,
      },
    })

    // Create managed login branding with Cognito's default styles
    const managedLoginBranding = new cognito.CfnManagedLoginBranding(this, "ManagedLoginBranding", {
      userPoolId: userPool.userPoolId,
      clientId: userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
    })

    managedLoginBranding.node.addDependency(this.userPoolDomain)

    // Update domain to use managed login v2 after branding resource is defined.
    // Uses L1 escape hatch to set ManagedLoginVersion on the CloudFormation resource.
    const cfnDomain = this.userPoolDomain.node.defaultChild as cognito.CfnUserPoolDomain
    cfnDomain.managedLoginVersion = 2

    // ========================================
    // V3 Pre-Token Generation Lambda
    // ========================================
    // This Lambda fires on M2M token generation (Client Credentials flow) and injects
    // user identity claims (user_id, department, role) into the M2M access token.
    // The claims are read from clientMetadata.verified_user_id, which is passed via
    // the aws_client_metadata parameter in the direct Cognito /oauth2/token call
    // (see patterns/utils/auth.py — get_gateway_access_token).
    //
    // For this demo, group assignment is hardcoded based on the user's email:
    // - alice@* → department: "finance", role: "admin"
    // - bob@*   → department: "engineering", role: "developer"
    // - others  → department: "guest", role: "viewer"
    //
    // To use dynamic group assignment, replace the hardcoded logic in the
    // Pre-Token Lambda (infra-cdk/lambdas/pretoken-v3/index.py) with a
    // DynamoDB lookup, directory service query, or other identity provider.
    const preTokenLambda = new lambda.Function(this, "PreTokenLambda", {
      functionName: `${config.stack_name_base}-pretoken-v3`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambdas", "pretoken-v3")), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      timeout: cdk.Duration.seconds(30),
      description: "V3 Pre-Token Lambda for M2M user identity propagation",
      logGroup: new logs.LogGroup(this, "PreTokenLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-pretoken-v3`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Grant Cognito permission to invoke the Pre-Token Lambda
    preTokenLambda.addPermission("CognitoInvoke", {
      principal: new iam.ServicePrincipal("cognito-idp.amazonaws.com"),
      sourceArn: userPool.userPoolArn,
    })

    // Attach V3 Lambda using L1 escape hatch.
    // The CDK L2 UserPool.addTrigger() only supports V1_0 and V2_0,
    // so addPropertyOverride is used to set V3_0 on the CloudFormation template directly.
    const cfnUserPool = userPool.node.defaultChild as cognito.CfnUserPool
    cfnUserPool.addPropertyOverride("LambdaConfig.PreTokenGenerationConfig", {
      LambdaArn: preTokenLambda.functionArn,
      LambdaVersion: "V3_0",
    })

    // Store the IDs for export
    this.userPoolId = userPool.userPoolId
    this.userPoolClientId = userPoolClient.userPoolClientId

    // Create admin user if email is provided in config
    if (config.admin_user_email) {
      new cognito.CfnUserPoolUser(this, "AdminUser", {
        userPoolId: userPool.userPoolId,
        username: config.admin_user_email,
        userAttributes: [
          {
            name: "email",
            value: config.admin_user_email,
          },
        ],
        desiredDeliveryMediums: ["EMAIL"],
      })

      // Output admin user creation status
      new cdk.CfnOutput(this, "AdminUserCreated", {
        description: "Admin user created and credentials emailed",
        value: `Admin user created: ${config.admin_user_email}`,
      })
    }

    new cdk.CfnOutput(this, "PreTokenLambdaArn", {
      description: "ARN of the V3 Pre-Token Generation Lambda",
      value: preTokenLambda.functionArn,
    })
  }
}
