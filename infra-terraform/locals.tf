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
  # Account and region information
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.id

  # Normalized stack name (lowercase, hyphens only)
  stack_name_normalized = lower(replace(var.stack_name_base, "_", "-"))

  # Stack name for resource naming (underscores for some AWS resources)
  stack_name_underscore = replace(var.stack_name_base, "-", "_")

  # Cognito domain prefix (must be globally unique and lowercase)
  cognito_domain_prefix = "${local.stack_name_normalized}-${local.account_id}-${local.region}"

  # Cognito provider URL (for OAuth token endpoint)
  cognito_provider_url = "${local.cognito_domain_prefix}.auth.${local.region}.amazoncognito.com"

  # Cognito OIDC discovery URL
  cognito_discovery_url = "https://cognito-idp.${local.region}.amazonaws.com"

  # Runtime name (underscores required by AgentCore)
  runtime_name = "${local.stack_name_underscore}_${var.agent_name}"

  # Amplify URL (predictable format)
  # Will be: https://main.{appId}.amplifyapp.com
  # Set after amplify module creates the app
  amplify_url_placeholder = "https://main.AMPLIFY_APP_ID.amplifyapp.com"

  # Lambda Powertools layer ARN (region-specific, Python 3.13, ARM64)
  # See: https://docs.powertools.aws.dev/lambda/python/latest/#install
  powertools_layer_arn = "arn:aws:lambda:${local.region}:017000801446:layer:AWSLambdaPowertoolsPythonV3-python313-arm64:18"

  # Common tags applied to all resources
  common_tags = merge(
    {
      Project     = var.stack_name_base
      Environment = var.environment
      ManagedBy   = "Terraform"
      Repository  = "fullstack-agentcore-solution-template"
    },
    var.tags
  )

  # SSM parameter paths
  ssm_parameter_prefix = "/${var.stack_name_base}"

  # Log retention in days
  log_retention_days = 7

  # S3 lifecycle rules
  staging_bucket_expiry_days = 30
  access_logs_expiry_days    = 90

  # API Gateway settings
  api_throttling_rate_limit  = 100
  api_throttling_burst_limit = 200
  api_cache_ttl_seconds      = 300
  api_cache_cluster_size     = "0.5"

  # Callback URLs for Cognito (includes Amplify URL when available)
  default_callback_urls = concat(
    var.callback_urls,
    [] # Amplify URL will be added dynamically via amplify_url variable
  )
}
