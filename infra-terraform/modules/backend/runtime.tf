# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# AgentCore Runtime
# Maps to: backend-stack.ts createAgentCoreRuntime() - runtime section
# =============================================================================

# -----------------------------------------------------------------------------
# ECR Repository (for container image)
# Only created if container_uri is not provided
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "agent" {
  count = local.is_docker && var.container_uri == null ? 1 : 0

  name                 = "${var.stack_name_base}-agent-runtime"
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
  count = local.is_docker && var.container_uri == null ? 1 : 0

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

# -----------------------------------------------------------------------------
# Docker Build & Push (docker mode only)
# Automatically builds and pushes the agent container image during apply
# -----------------------------------------------------------------------------

# Content hash for Docker image change detection — triggers rebuild and runtime replacement.
# Always created (no count) so the runtime's replace_triggered_by can reference it in both modes.
# In zip mode the value is static ("zip"), so it never triggers a replacement.
resource "terraform_data" "docker_image_hash" {
  input = local.is_docker && var.container_uri == null ? sha256(join("", concat(
    [filesha256("${local.pattern_dir}/Dockerfile")],
    [filesha256("${local.pattern_dir}/requirements.txt")],
    [for f in fileset(local.pattern_dir, "*.py") : filesha256("${local.pattern_dir}/${f}")],
    [for f in fileset("${local.project_root}/patterns/utils", "**/*.py") : filesha256("${local.project_root}/patterns/utils/${f}")],
    [for f in fileset("${local.project_root}/gateway", "**/*.py") : filesha256("${local.project_root}/gateway/${f}")],
    [for f in fileset("${local.project_root}/tools", "**/*.py") : filesha256("${local.project_root}/tools/${f}")],
    [filesha256("${local.project_root}/pyproject.toml")],
  ))) : "zip"
}

resource "null_resource" "docker_build_push" {
  count = local.is_docker && var.container_uri == null ? 1 : 0

  triggers = {
    content_hash   = terraform_data.docker_image_hash.output
    repository_url = aws_ecr_repository.agent[0].repository_url
  }

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    command     = <<-EOT
      set -e

      ECR_REPO="${aws_ecr_repository.agent[0].repository_url}"
      REGION="${local.region}"
      ACCOUNT_ID="${local.account_id}"
      PROJECT_ROOT="${local.project_root}"
      DOCKERFILE="patterns/${var.backend_pattern}/Dockerfile"

      # Verify Docker is running
      if ! docker info >/dev/null 2>&1; then
        echo "ERROR: Docker is not running. Please start Docker Desktop." >&2
        exit 1
      fi

      # ECR login
      echo "Logging into ECR..."
      aws ecr get-login-password --region "$REGION" | \
        docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

      # Build ARM64 image
      echo "Building Docker image (ARM64)..."
      cd "$PROJECT_ROOT"
      docker build \
        --platform linux/arm64 \
        -f "$DOCKERFILE" \
        -t "$ECR_REPO:latest" \
        .

      # Push to ECR
      echo "Pushing image to ECR..."
      docker push "$ECR_REPO:latest"

      echo "SUCCESS: Image pushed to $ECR_REPO:latest"
    EOT
  }

  depends_on = [
    aws_ecr_repository.agent[0],
    aws_ecr_lifecycle_policy.agent[0]
  ]
}

# -----------------------------------------------------------------------------
# IAM Role for AgentCore Runtime
# -----------------------------------------------------------------------------

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

# -----------------------------------------------------------------------------
# IAM Policy Document
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "runtime_policy" {
  # ECRImageAccess (docker mode only)
  dynamic "statement" {
    for_each = local.is_docker ? [1] : []
    content {
      sid    = "ECRImageAccess"
      effect = "Allow"
      actions = [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability"
      ]
      resources = ["arn:aws:ecr:${local.region}:${local.account_id}:repository/*"]
    }
  }

  # ECRTokenAccess (docker mode only)
  dynamic "statement" {
    for_each = local.is_docker ? [1] : []
    content {
      sid       = "ECRTokenAccess"
      effect    = "Allow"
      actions   = ["ecr:GetAuthorizationToken"]
      resources = ["*"]
    }
  }

  # S3 Agent Code Access (zip mode only)
  dynamic "statement" {
    for_each = local.is_zip ? [1] : []
    content {
      sid    = "S3AgentCodeAccess"
      effect = "Allow"
      actions = [
        "s3:GetObject",
        "s3:GetBucketLocation"
      ]
      resources = [
        aws_s3_bucket.agent_code[0].arn,
        "${aws_s3_bucket.agent_code[0].arn}/*"
      ]
    }
  }

  # CloudWatchLogsGroupAccess
  statement {
    sid    = "CloudWatchLogsGroupAccess"
    effect = "Allow"
    actions = [
      "logs:DescribeLogStreams",
      "logs:CreateLogGroup"
    ]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*"]
  }

  # CloudWatchLogsDescribeGroups
  statement {
    sid       = "CloudWatchLogsDescribeGroups"
    effect    = "Allow"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:*"]
  }

  # CloudWatchLogsStreamAccess
  statement {
    sid    = "CloudWatchLogsStreamAccess"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*"]
  }

  # X-Ray Tracing
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

  # CloudWatch Metrics
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

  # GetAgentAccessToken
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

  # BedrockModelInvocation
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

  # SecretsManagerOAuth2Access
  # Runtime needs to read OAuth2 credentials from Token Vault secret
  # created by AgentCore Identity (not the machine client secret directly)
  statement {
    sid     = "SecretsManagerOAuth2Access"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:bedrock-agentcore-identity!default/oauth2/${var.stack_name_base}-runtime-gateway-auth*"
    ]
  }

  # MemoryResourceAccess - references memory resource directly (no variable passing)
  statement {
    sid    = "MemoryResourceAccess"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:CreateEvent",
      "bedrock-agentcore:GetEvent",
      "bedrock-agentcore:ListEvents",
      "bedrock-agentcore:RetrieveMemoryRecords"
    ]
    resources = [aws_bedrockagentcore_memory.main.arn]
  }

  # SSMParameterAccess
  statement {
    sid    = "SSMParameterAccess"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters"
    ]
    resources = ["arn:aws:ssm:${local.region}:${local.account_id}:parameter/${var.stack_name_base}/*"]
  }

  # CodeInterpreterAccess
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

  # OAuth2CredentialProviderAccess
  # The @requires_access_token decorator performs a two-stage process:
  # GetOauth2CredentialProvider - Looks up provider metadata
  # GetResourceOauth2Token - Fetches the actual access token from Token Vault
  statement {
    sid    = "OAuth2CredentialProviderAccess"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:GetOauth2CredentialProvider",
      "bedrock-agentcore:GetResourceOauth2Token"
    ]
    resources = [
      "arn:aws:bedrock-agentcore:${local.region}:${local.account_id}:oauth2-credential-provider/*",
      "arn:aws:bedrock-agentcore:${local.region}:${local.account_id}:token-vault/*",
      "arn:aws:bedrock-agentcore:${local.region}:${local.account_id}:workload-identity-directory/*"
    ]
  }
}

resource "aws_iam_role_policy" "runtime" {
  name   = "${var.stack_name_base}-agentcore-runtime-policy"
  role   = aws_iam_role.runtime.id
  policy = data.aws_iam_policy_document.runtime_policy.json
}

# -----------------------------------------------------------------------------
# AgentCore Runtime
# -----------------------------------------------------------------------------

resource "aws_bedrockagentcore_agent_runtime" "main" {
  agent_runtime_name = local.runtime_name
  role_arn           = aws_iam_role.runtime.arn
  description        = "${var.backend_pattern} agent runtime for ${var.stack_name_base}"

  # Artifact configuration (docker or zip)
  agent_runtime_artifact {
    # Docker mode: container image from ECR or custom URI
    dynamic "container_configuration" {
      for_each = local.is_docker ? [1] : []
      content {
        container_uri = var.container_uri != null ? var.container_uri : "${aws_ecr_repository.agent[0].repository_url}:latest"
      }
    }

    # Zip mode: S3 Python package
    dynamic "code_configuration" {
      for_each = local.is_zip ? [1] : []
      content {
        runtime     = "PYTHON_3_12"
        entry_point = local.zip_entry_point
        code {
          s3 {
            bucket = aws_s3_bucket.agent_code[0].id
            prefix = "deployment_package.zip"
          }
        }
      }
    }
  }

  # Network configuration
  network_configuration {
    network_mode = var.network_mode

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
      discovery_url   = local.oidc_discovery_url
      allowed_clients = [var.web_client_id]
    }
  }

  # Protocol configuration (HTTP for agent communication)
  protocol_configuration {
    server_protocol = "HTTP"
  }

  # Request header configuration (allowlist Authorization for JWT sub claim)
  request_header_configuration {
    request_header_allowlist = ["Authorization"]
  }

  # Environment variables for the runtime
  environment_variables = {
    AWS_REGION                       = local.region
    AWS_DEFAULT_REGION               = local.region
    MEMORY_ID                        = aws_bedrockagentcore_memory.main.id
    STACK_NAME                       = var.stack_name_base
    GATEWAY_CREDENTIAL_PROVIDER_NAME = "${var.stack_name_base}-runtime-gateway-auth"
  }

  tags = var.tags

  # Force runtime replacement when agent code changes (zip or docker)
  lifecycle {
    replace_triggered_by = [
      terraform_data.agent_code_hash,
      terraform_data.docker_image_hash,
    ]
  }

  depends_on = [
    aws_iam_role_policy.runtime,
    null_resource.invoke_zip_packager,
    null_resource.docker_build_push,
    null_resource.invoke_oauth2_provider # Ensure provider is registered before Runtime starts
  ]
}
