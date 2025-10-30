import * as cdk from "aws-cdk-lib"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as codebuild from "aws-cdk-lib/aws-codebuild"
import * as iam from "aws-cdk-lib/aws-iam"
import * as s3Assets from "aws-cdk-lib/aws-s3-assets"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as logs from "aws-cdk-lib/aws-logs"
// Note: Using CfnResource for BedrockAgentCore as the L2 construct may not be available yet
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha"
import * as lambda from "aws-cdk-lib/aws-lambda"
import { Construct } from "constructs"
import { AppConfig } from "./utils/config-manager"
import { AgentCoreRole } from "./utils/agentcore-role"
import * as path from "path"

export interface BackendStackProps extends cdk.NestedStackProps {
  config: AppConfig
}

export class BackendStack extends cdk.NestedStack {
  public userPool: cognito.UserPool
  public userPoolClient: cognito.UserPoolClient
  public userPoolDomain: cognito.UserPoolDomain
  public runtimeArn: string
  public ecrRepository: ecr.Repository
  public buildProject: codebuild.Project
  private agentName: cdk.CfnParameter
  private imageTag: cdk.CfnParameter
  private networkMode: cdk.CfnParameter

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props)

    // Create Cognito User Pool first
    this.createCognitoUserPool(props.config)

    // Store Cognito config in SSM for frontend stack
    this.createCognitoSSMParameters(props.config)

    // Create ECR repository and CodeBuild project
    this.createECRAndCodeBuild(props.config)

    // Create AgentCore Runtime resources
    this.createAgentCoreRuntime(props.config)

    // Store runtime ARN in SSM for frontend stack
    this.createRuntimeSSMParameters(props.config)

    // Create Feedback DynamoDB table (example of application data storage)
    const feedbackTable = this.createFeedbackTable(props.config)

    // Create Feedback API resources (example of best-practice API Gateway + Lambda pattern)
    this.createFeedbackApi(props.config, feedbackTable)
  }

  private createCognitoUserPool(config: AppConfig): void {
    this.userPool = new cognito.UserPool(this, "UserPool", {
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
      userInvitation: {
        emailSubject: `Welcome to ${config.stack_name_base}!`,
        emailBody: `<p>Hello {username},</p>
<p>Welcome to ${config.stack_name_base}! Your username is <strong>{username}</strong> and your temporary password is: <strong>{####}</strong></p>
<p>Please use this temporary password to log in and set your permanent password.</p>
<p>The CloudFront URL to your application is stored as an output in the "${config.stack_name_base}" stack, and will be printed to your terminal once the deployment process completes.</p>
<p>Thanks,</p>
<p>AWS GENAIIC Team</p>`,
      },
    })

    this.userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: this.userPool,
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
        callbackUrls: ["http://localhost:5173", "https://localhost:5173"],
      },
      preventUserExistenceErrors: true,
    })

    this.userPoolDomain = new cognito.UserPoolDomain(this, "UserPoolDomain", {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: `${config.stack_name_base}-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      },
    })

    // Create admin user if email is provided in config
    if (config.admin_user_email) {
      const adminUser = new cognito.CfnUserPoolUser(this, "AdminUser", {
        userPoolId: this.userPool.userPoolId,
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
  }

  private createCognitoSSMParameters(config: AppConfig): void {
    new ssm.StringParameter(this, "CognitoUserPoolIdParam", {
      parameterName: `/${config.stack_name_base}/cognito-user-pool-id`,
      stringValue: this.userPool.userPoolId,
    })

    new ssm.StringParameter(this, "CognitoUserPoolClientIdParam", {
      parameterName: `/${config.stack_name_base}/cognito-user-pool-client-id`,
      stringValue: this.userPoolClient.userPoolClientId,
    })

    new ssm.StringParameter(this, "CognitoDomainParam", {
      parameterName: `/${config.stack_name_base}/cognito-domain`,
      stringValue: `${this.userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
    })
  }

  private createECRAndCodeBuild(config: AppConfig): void {
    const pattern = config.backend?.pattern || "strands-single-agent"

    // Parameters
    this.agentName = new cdk.CfnParameter(this, "AgentName", {
      type: "String",
      default: "StrandsAgent",
      description: "Name for the agent runtime",
    })

    this.imageTag = new cdk.CfnParameter(this, "ImageTag", {
      type: "String",
      default: "latest",
      description: "Tag for the Docker image",
    })

    this.networkMode = new cdk.CfnParameter(this, "NetworkMode", {
      type: "String",
      default: "PUBLIC",
      description: "Network mode for AgentCore resources",
      allowedValues: ["PUBLIC", "PRIVATE"],
    })

    // ECR Repository
    this.ecrRepository = new ecr.Repository(this, "ECRRepository", {
      repositoryName: `${config.stack_name_base.toLowerCase()}-${pattern}`,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
    })

    // S3 Asset for source code
    const patternPath = path.join(__dirname, "..", "..", "patterns", pattern)
    const sourceAsset = new s3Assets.Asset(this, "SourceAsset", {
      path: patternPath,
    })

    // CodeBuild Role
    const codebuildRole = new iam.Role(this, "CodeBuildRole", {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      inlinePolicies: {
        CodeBuildPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "CloudWatchLogs",
              effect: iam.Effect.ALLOW,
              actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/*`],
            }),
            new iam.PolicyStatement({
              sid: "ECRAccess",
              effect: iam.Effect.ALLOW,
              actions: [
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "ecr:GetAuthorizationToken",
                "ecr:PutImage",
                "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:CompleteLayerUpload",
              ],
              resources: [this.ecrRepository.repositoryArn, "*"],
            }),
            new iam.PolicyStatement({
              sid: "S3SourceAccess",
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetObject"],
              resources: [`${sourceAsset.bucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    })

    // CodeBuild Project
    this.buildProject = new codebuild.Project(this, "AgentImageBuildProject", {
      projectName: `${config.stack_name_base}-${pattern}-build`,
      description: `Build ${pattern} agent Docker image for ${config.stack_name_base}`,
      role: codebuildRole,
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: codebuild.ComputeType.LARGE,
        privileged: true,
      },
      source: codebuild.Source.s3({
        bucket: sourceAsset.bucket,
        path: sourceAsset.s3ObjectKey,
      }),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              "echo Logging in to Amazon ECR...",
              "aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com",
            ],
          },
          build: {
            commands: [
              "echo Build started on `date`",
              "echo Building the Docker image for agent ARM64...",
              "docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .",
              "docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG",
            ],
          },
          post_build: {
            commands: [
              "echo Build completed on `date`",
              "echo Pushing the Docker image...",
              "docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG",
              "echo ARM64 Docker image pushed successfully",
            ],
          },
        },
      }),
      environmentVariables: {
        AWS_DEFAULT_REGION: {
          value: this.region,
        },
        AWS_ACCOUNT_ID: {
          value: this.account,
        },
        IMAGE_REPO_NAME: {
          value: this.ecrRepository.repositoryName,
        },
        IMAGE_TAG: {
          value: this.imageTag.valueAsString,
        },
        STACK_NAME: {
          value: config.stack_name_base,
        },
      },
    })
  }

  private createAgentCoreRuntime(config: AppConfig): void {
    const pattern = config.backend?.pattern || "strands-single-agent"

    // Lambda function to trigger and wait for CodeBuild using Python 3.13
    const buildTriggerFunction = new PythonFunction(this, "BuildTriggerFunction", {
      entry: path.join(__dirname, "utils", "build-trigger-lambda"),
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "handler",
      timeout: cdk.Duration.minutes(15),
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["codebuild:StartBuild", "codebuild:BatchGetBuilds"],
          resources: [this.buildProject.projectArn],
        }),
      ],
    })

    // Custom Resource using the Lambda function
    const triggerBuild = new cdk.CustomResource(this, "TriggerImageBuild", {
      serviceToken: buildTriggerFunction.functionArn,
      properties: {
        ProjectName: this.buildProject.projectName,
      },
    })

    // Create AgentCore execution role
    const agentRole = new AgentCoreRole(this, "AgentCoreRole")

    // Handle memory: either use existing or create new
    let memoryId: string | undefined
    let memoryArn: string | undefined

    if (config.backend?.memory_id) {
      // Use existing memory ID from config
      memoryId = config.backend.memory_id
      memoryArn = `arn:aws:bedrock-agentcore:${this.region}:${this.account}:memory/${memoryId}`
    } else {
      // Create new memory resource using CloudFormation 
      const memory = new cdk.CfnResource(this, "AgentMemory", {
        type: "AWS::BedrockAgentCore::Memory",
        properties: {
          Name: `${config.stack_name_base.replace(/-/g, "_")}_${this.agentName.valueAsString}_Memory`,
          EventExpiryDuration: 7,
          Description: `Memory for ${config.stack_name_base} agent`,
          MemoryStrategies: [],
          MemoryExecutionRoleArn: agentRole.roleArn,
          Tags: {
            Name: `${config.stack_name_base}_Memory`,
            ManagedBy: "CDK",
          },
        },
      })
      memoryId = memory.getAtt("MemoryId").toString()
      memoryArn = memory.getAtt("MemoryArn").toString()
    }

    // Add memory-specific permissions to agent role
    if (memoryArn) {
      agentRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "MemoryResourceAccess",
          effect: iam.Effect.ALLOW,
          actions: [
            "bedrock-agentcore:GetMemory",
            "bedrock-agentcore:ListMemories",
            "bedrock-agentcore:CreateMemorySession",
            "bedrock-agentcore:GetMemorySession",
            "bedrock-agentcore:DeleteMemorySession",
            "bedrock-agentcore:CreateEvent",
            "bedrock-agentcore:GetEvent",
            "bedrock-agentcore:ListEvents",
          ],
          resources: [memoryArn],
        })
      )
    }

    // Create AgentCore Runtime with JWT authorizer using CloudFormation resource
    const agentRuntime = new cdk.CfnResource(this, "AgentRuntime", {
      type: "AWS::BedrockAgentCore::Runtime",
      properties: {
        AgentRuntimeName: `${config.stack_name_base.replace(/-/g, "_")}_${
          this.agentName.valueAsString
        }`,
        AgentRuntimeArtifact: {
          ContainerConfiguration: {
            ContainerUri: `${this.ecrRepository.repositoryUri}:${this.imageTag.valueAsString}`,
          },
        },
        NetworkConfiguration: {
          NetworkMode: this.networkMode.valueAsString,
        },
        ProtocolConfiguration: "HTTP",
        RoleArn: agentRole.roleArn,
        Description: `${pattern} agent runtime for ${config.stack_name_base}`,
        EnvironmentVariables: {
          AWS_DEFAULT_REGION: this.region,
          MEMORY_ID: memoryId,
        },
        // Add JWT authorizer with Cognito configuration
        AuthorizerConfiguration: {
          CustomJWTAuthorizer: {
            DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}/.well-known/openid-configuration`,
            AllowedClients: [this.userPoolClient.userPoolClientId],
          },
        },
      },
    })

    agentRuntime.node.addDependency(triggerBuild)

    // Store the runtime ARN
    this.runtimeArn = agentRuntime.getAtt("AgentRuntimeArn").toString()

    // Outputs
    new cdk.CfnOutput(this, "AgentRuntimeId", {
      description: "ID of the created agent runtime",
      value: agentRuntime.getAtt("AgentRuntimeId").toString(),
    })

    new cdk.CfnOutput(this, "AgentRuntimeArn", {
      description: "ARN of the created agent runtime",
      value: agentRuntime.getAtt("AgentRuntimeArn").toString(),
      exportName: `${config.stack_name_base}-AgentRuntimeArn`,
    })

    new cdk.CfnOutput(this, "AgentRoleArn", {
      description: "ARN of the agent execution role",
      value: agentRole.roleArn,
    })

    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      description: "Cognito User Pool ID - create users manually in AWS Console",
      value: this.userPool.userPoolId,
    })

    // Memory ARN output
    if (memoryArn) {
      new cdk.CfnOutput(this, "MemoryArn", {
        description: "ARN of the agent memory resource",
        value: memoryArn,
      })
    }

    // Ensure the custom resource depends on the build project
    triggerBuild.node.addDependency(this.buildProject)
  }

  private createRuntimeSSMParameters(config: AppConfig): void {
    // Store runtime ARN in SSM for frontend stack
    new ssm.StringParameter(this, "RuntimeArnParam", {
      parameterName: `/${config.stack_name_base}/runtime-arn`,
      stringValue: this.runtimeArn,
    })
  }

  // Creates a DynamoDB table for storing user feedback.
  private createFeedbackTable(config: AppConfig): dynamodb.Table {
    const feedbackTable = new dynamodb.Table(this, "FeedbackTable", {
      tableName: `${config.stack_name_base}-feedback`,
      partitionKey: {
        name: "feedbackId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // Add GSI for querying by feedbackType with timestamp sorting
    feedbackTable.addGlobalSecondaryIndex({
      indexName: "feedbackType-timestamp-index",
      partitionKey: {
        name: "feedbackType",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "timestamp",
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    return feedbackTable
  }

  /**
   * Creates an API Gateway with Lambda integration for the feedback endpoint.
   * This is an EXAMPLE implementation demonstrating best practices for API Gateway + Lambda.
   *
   * API Contract - POST /feedback
   * Authorization: Bearer <cognito-access-token> (required)
   *
   * Request Body:
   *   sessionId: string (required, max 100 chars, alphanumeric with -_) - Conversation session ID
   *   message: string (required, max 5000 chars) - Agent's response being rated
   *   feedbackType: "positive" | "negative" (required) - User's rating
   *   comment: string (optional, max 5000 chars) - User's explanation for rating
   *
   * Success Response (200):
   *   { success: true, feedbackId: string }
   *
   * Error Responses:
   *   400: { error: string } - Validation failure (missing fields, invalid format)
   *   401: { error: "Unauthorized" } - Invalid/missing JWT token
   *   500: { error: "Internal server error" } - DynamoDB or processing error
   *
   * Implementation: infra-cdk/lambdas/feedback/index.py
   */

  private createFeedbackApi(config: AppConfig, feedbackTable: dynamodb.Table): void {
    // Create Lambda function for feedback using Python
    const feedbackLambda = new PythonFunction(this, "FeedbackLambda", {
      functionName: `${config.stack_name_base}-feedback`,
      runtime: lambda.Runtime.PYTHON_3_13,
      entry: path.join(__dirname, "..", "lambdas", "feedback"),
      handler: "handler",
      environment: {
        TABLE_NAME: feedbackTable.tableName,
        ALLOWED_ORIGINS: "*", // Wildcard CORS - see API Gateway comment below for security rationale
      },
      timeout: cdk.Duration.seconds(30),
      logGroup: new logs.LogGroup(this, "FeedbackLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-feedback`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Grant Lambda permissions to write to DynamoDB
    feedbackTable.grantWriteData(feedbackLambda)

    /*
     * CORS TODO: Wildcard (*) used because Backend deploys before Frontend in nested stack order.
     * For Lambda proxy integrations, the Lambda's ALLOWED_ORIGINS env var is the primary CORS control.
     * API Gateway defaultCorsPreflightOptions below only handles OPTIONS preflight requests.
     * See detailed explanation and fix options in: infra-cdk/lambdas/feedback/index.py
     */
    const api = new apigateway.RestApi(this, "FeedbackApi", {
      restApiName: `${config.stack_name_base}-api`,
      description: "API for user feedback and future endpoints",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
      },
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    })

    // Create Cognito authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "FeedbackApiAuthorizer", {
      cognitoUserPools: [this.userPool],
      identitySource: "method.request.header.Authorization",
      authorizerName: `${config.stack_name_base}-authorizer`,
    })

    // Create /feedback resource and POST method
    const feedbackResource = api.root.addResource("feedback")
    feedbackResource.addMethod("POST", new apigateway.LambdaIntegration(feedbackLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    })

    // Store API URL in SSM for frontend
    new ssm.StringParameter(this, "FeedbackApiUrlParam", {
      parameterName: `/${config.stack_name_base}/feedback-api-url`,
      stringValue: api.url,
      description: "Feedback API Gateway URL",
    })

    // Output - only the API URL needed for frontend
    new cdk.CfnOutput(this, "FeedbackApiUrl", {
      description: "Feedback API URL",
      value: api.url,
    })
  }
}
