import * as cdk from "aws-cdk-lib"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as iam from "aws-cdk-lib/aws-iam"
import * as logs from "aws-cdk-lib/aws-logs"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as path from "path"
import { Construct } from "constructs"
import { AppConfig } from "../utils/config-manager"

export interface CognitoConstructProps {
  config: AppConfig
  callbackUrls?: string[]
}

export class CognitoConstruct extends Construct {
  public userPoolId: string
  public userPoolClientId: string
  public userPoolDomain: cognito.UserPoolDomain
  /** The user pool, exposed for consumers that import it (e.g. API authorizers). */
  public userPool: cognito.UserPool
  /** Machine (M2M) client used by the gateway for client-credentials auth. */
  public machineClient: cognito.UserPoolClient
  /** Secret holding the machine client secret, consumed by the OAuth2 provider. */
  public machineClientSecret: secretsmanager.Secret

  constructor(scope: Construct, id: string, props: CognitoConstructProps) {
    super(scope, id)

    this.createCognitoUserPool(props.config, props.callbackUrls)
    this.createMachineAuthentication(props.config)
    this.createSsmParameters(props.config)
  }

  /**
   * Stores identity configuration in SSM for the frontend, tests, and the agent runtime.
   * These four values form the identity contract other components depend on; a different
   * IdP would publish the same parameters.
   */
  private createSsmParameters(config: AppConfig): void {
    new ssm.StringParameter(this, "CognitoUserPoolIdParam", {
      parameterName: `/${config.stack_name_base}/cognito-user-pool-id`,
      stringValue: this.userPoolId,
      description: "Cognito User Pool ID",
    })

    new ssm.StringParameter(this, "CognitoUserPoolClientIdParam", {
      parameterName: `/${config.stack_name_base}/cognito-user-pool-client-id`,
      stringValue: this.userPoolClientId,
      description: "Cognito User Pool Client ID",
    })

    new ssm.StringParameter(this, "MachineClientIdParam", {
      parameterName: `/${config.stack_name_base}/machine_client_id`,
      stringValue: this.machineClient.userPoolClientId,
      description: "Machine Client ID for M2M authentication",
    })

    new ssm.StringParameter(this, "CognitoDomainParam", {
      parameterName: `/${config.stack_name_base}/cognito_provider`,
      stringValue: `${this.userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      description: "Cognito domain URL for token endpoint",
    })
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
    // custom claims (user_id, department, role) into the M2M access token.
    // These are application-defined claims, not standard JWT/OIDC claims.
    // The claims are read from clientMetadata.verified_user_id (the Cognito sub / UUID),
    // which is passed via the aws_client_metadata parameter in the direct Cognito
    // /oauth2/token call (see patterns/utils/auth.py — get_gateway_access_token).
    //
    // Group assignment uses a UUID-based mapping (USER_ROLE_MAP). On first deploy,
    // all users are assigned "guest/viewer". After deploy, look up user subs and
    // update the mapping, then redeploy. See docs/IDENTITY_POLICY.md for details.
    //
    // To use dynamic group assignment, replace the hardcoded mapping in the
    // Pre-Token Lambda (infra-cdk/lambdas/pretoken-v3/index.py) with a
    // DynamoDB lookup, directory service query, or other identity provider.
    const preTokenLambda = new lambda.Function(this, "PreTokenLambda", {
      functionName: `${config.stack_name_base}-pretoken-v3`,
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "lambdas", "pretoken-v3")), // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
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
    this.userPool = userPool
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

  /**
   * Creates the Machine-to-Machine (M2M) authentication resources: a resource server
   * defining gateway scopes, a confidential machine client using the client-credentials
   * flow, and a Secrets Manager secret holding the client secret. These are Cognito
   * resources consumed by the gateway (client id for the JWT authorizer) and the OAuth2
   * credential provider (client secret).
   */
  private createMachineAuthentication(config: AppConfig): void {
    const resourceServer = new cognito.UserPoolResourceServer(this, "ResourceServer", {
      userPool: this.userPool,
      identifier: `${config.stack_name_base}-gateway`,
      userPoolResourceServerName: `${config.stack_name_base}-gateway-resource-server`,
      scopes: [
        new cognito.ResourceServerScope({
          scopeName: "read",
          scopeDescription: "Read access to gateway",
        }),
        new cognito.ResourceServerScope({
          scopeName: "write",
          scopeDescription: "Write access to gateway",
        }),
      ],
    })

    // Confidential client for the OAuth2 Client Credentials (service-to-service) flow.
    this.machineClient = new cognito.UserPoolClient(this, "MachineClient", {
      userPool: this.userPool,
      userPoolClientName: `${config.stack_name_base}-machine-client`,
      generateSecret: true,
      oAuth: {
        flows: {
          clientCredentials: true,
        },
        scopes: [
          cognito.OAuthScope.resourceServer(
            resourceServer,
            new cognito.ResourceServerScope({
              scopeName: "read",
              scopeDescription: "Read access to gateway",
            })
          ),
          cognito.OAuthScope.resourceServer(
            resourceServer,
            new cognito.ResourceServerScope({
              scopeName: "write",
              scopeDescription: "Write access to gateway",
            })
          ),
        ],
      },
    })

    this.machineClient.node.addDependency(resourceServer)

    // Store the machine client secret in Secrets Manager for the OAuth2 provider and tests.
    this.machineClientSecret = new secretsmanager.Secret(this, "MachineClientSecret", {
      secretName: `/${config.stack_name_base}/machine_client_secret`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        this.machineClient.userPoolClientSecret.unsafeUnwrap()
      ),
      description: "Machine Client Secret for M2M authentication",
    })
  }
}
