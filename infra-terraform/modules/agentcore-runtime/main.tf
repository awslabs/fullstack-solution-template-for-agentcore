# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# =============================================================================
# Data Sources
# =============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# =============================================================================
# Local Values
# =============================================================================

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.id

  # Runtime description
  runtime_description = var.description != null ? var.description : "${var.backend_pattern} agent runtime for ${var.stack_name_base}"

  # ECR repository name
  ecr_repo_name = "${var.stack_name_base}-agent-runtime"

  # Container URI (use provided or build from ECR)
  container_uri = var.container_uri != null ? var.container_uri : "${aws_ecr_repository.agent[0].repository_url}:latest"

  # OIDC discovery URL for Cognito JWT authorizer
  oidc_discovery_url = "https://cognito-idp.${local.region}.amazonaws.com/${var.user_pool_id}/.well-known/openid-configuration"
}

# =============================================================================
# ECR Repository (for container image)
# =============================================================================
# Only created if container_uri is not provided

resource "aws_ecr_repository" "agent" {
  count = var.container_uri == null ? 1 : 0

  name                 = local.ecr_repo_name
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = var.tags
}

# ECR Lifecycle policy to keep only recent images
resource "aws_ecr_lifecycle_policy" "agent" {
  count = var.container_uri == null ? 1 : 0

  repository = aws_ecr_repository.agent[0].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep only 5 most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# =============================================================================
# IAM Role for AgentCore Runtime
# =============================================================================
# Comprehensive execution role with all required policy statements

data "aws_iam_policy_document" "runtime_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "runtime" {
  name               = "${var.stack_name_base}-agentcore-runtime-role"
  assume_role_policy = data.aws_iam_policy_document.runtime_assume_role.json
  description        = "Execution role for AgentCore Runtime"

  tags = var.tags
}

# =============================================================================
# IAM Policy Document
# =============================================================================

data "aws_iam_policy_document" "runtime_policy" {
  # 1. ECRImageAccess - ECR repository access for container images
  statement {
    sid    = "ECRImageAccess"
    effect = "Allow"
    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchCheckLayerAvailability"
    ]
    resources = ["arn:aws:ecr:${local.region}:${local.account_id}:repository/*"]
  }

  # 2. ECRTokenAccess - ECR authorization token
  statement {
    sid       = "ECRTokenAccess"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # 3. CloudWatchLogsGroupAccess - Log group operations for runtime
  statement {
    sid    = "CloudWatchLogsGroupAccess"
    effect = "Allow"
    actions = [
      "logs:DescribeLogStreams",
      "logs:CreateLogGroup"
    ]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*"]
  }

  # 4. CloudWatchLogsDescribeGroups - List log groups
  statement {
    sid       = "CloudWatchLogsDescribeGroups"
    effect    = "Allow"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:*"]
  }

  # 5. CloudWatchLogsStreamAccess - Log stream operations
  statement {
    sid    = "CloudWatchLogsStreamAccess"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*"]
  }

  # 6. X-Ray Tracing - Trace segments and telemetry
  statement {
    sid    = "XRayTracing"
    effect = "Allow"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
      "xray:GetSamplingRules",
      "xray:GetSamplingTargets"
    ]
    resources = ["*"]
  }

  # 7. CloudWatch Metrics - PutMetricData with namespace condition
  statement {
    sid       = "CloudWatchMetrics"
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["bedrock-agentcore"]
    }
  }

  # 8. GetAgentAccessToken - Workload identity directory access
  statement {
    sid    = "GetAgentAccessToken"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:GetWorkloadAccessToken",
      "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
      "bedrock-agentcore:GetWorkloadAccessTokenForUserId"
    ]
    resources = [
      "arn:aws:bedrock-agentcore:${local.region}:${local.account_id}:workload-identity-directory/default",
      "arn:aws:bedrock-agentcore:${local.region}:${local.account_id}:workload-identity-directory/default/workload-identity/*"
    ]
  }

  # 9. BedrockModelInvocation - Model invocation (region-agnostic)
  statement {
    sid    = "BedrockModelInvocation"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream"
    ]
    resources = [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:${local.region}:${local.account_id}:*"
    ]
  }

  # 10. SecretsManagerAccess - Machine client secret retrieval
  statement {
    sid       = "SecretsManagerAccess"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:/*/machine_client_secret*"]
  }

  # 11. MemoryResourceAccess - Memory create/get/list events
  statement {
    sid    = "MemoryResourceAccess"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:CreateEvent",
      "bedrock-agentcore:GetEvent",
      "bedrock-agentcore:ListEvents",
      "bedrock-agentcore:RetrieveMemoryRecords"
    ]
    resources = [var.memory_arn]
  }

  # 12. SSMParameterAccess - Gateway URL and config lookup
  statement {
    sid    = "SSMParameterAccess"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters"
    ]
    resources = ["arn:aws:ssm:${local.region}:${local.account_id}:parameter/${var.stack_name_base}/*"]
  }

  # 13. CodeInterpreterAccess - Code interpreter operations
  statement {
    sid    = "CodeInterpreterAccess"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:StartCodeInterpreterSession",
      "bedrock-agentcore:StopCodeInterpreterSession",
      "bedrock-agentcore:InvokeCodeInterpreter"
    ]
    resources = ["arn:aws:bedrock-agentcore:${local.region}:aws:code-interpreter/*"]
  }
}

resource "aws_iam_role_policy" "runtime" {
  name   = "${var.stack_name_base}-agentcore-runtime-policy"
  role   = aws_iam_role.runtime.id
  policy = data.aws_iam_policy_document.runtime_policy.json
}

# =============================================================================
# AgentCore Runtime
# =============================================================================
# Containerized execution environment for AI agents

resource "aws_bedrockagentcore_agent_runtime" "main" {
  agent_runtime_name = var.runtime_name
  role_arn           = aws_iam_role.runtime.arn
  description        = local.runtime_description

  # Container configuration
  agent_runtime_artifact {
    container_configuration {
      container_uri = local.container_uri
    }
  }

  # Network configuration
  network_configuration {
    network_mode = var.network_mode

    # VPC configuration for PRIVATE mode
    dynamic "network_mode_config" {
      for_each = var.network_mode == "PRIVATE" && length(var.private_subnet_ids) > 0 ? [1] : []
      content {
        subnets         = var.private_subnet_ids
        security_groups = var.security_group_ids
      }
    }
  }

  # JWT authorizer configuration (Cognito)
  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url    = local.oidc_discovery_url
      allowed_audience = [var.web_client_id]
    }
  }

  # Protocol configuration (HTTP for agent communication)
  protocol_configuration {
    server_protocol = "HTTP"
  }

  # Environment variables for the runtime
  environment_variables = {
    AWS_REGION         = local.region
    AWS_DEFAULT_REGION = local.region
    MEMORY_ID          = var.memory_id
    STACK_NAME         = var.stack_name_base
  }

  tags = var.tags

  depends_on = [aws_iam_role_policy.runtime]
}
