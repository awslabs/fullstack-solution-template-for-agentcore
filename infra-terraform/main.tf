# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# =============================================================================
# Provider Configuration
# =============================================================================

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

# =============================================================================
# DEPLOYMENT ORDER:
# 1. Amplify Hosting - Creates app and gets predictable URL
# 2. Cognito - Uses Amplify URL for callback URLs
# 3. Backend Resources (Memory, Gateway, Runtime, Feedback API)
# =============================================================================

# =============================================================================
# Module: Amplify Hosting (Frontend)
# =============================================================================
# Creates:
# - S3 bucket for access logs
# - S3 bucket for frontend staging
# - Amplify App (WEB platform)
# - Amplify Branch (main, PRODUCTION)

module "amplify_hosting" {
  source = "./modules/amplify-hosting"

  stack_name_base = var.stack_name_base

  staging_bucket_expiry_days = local.staging_bucket_expiry_days
  access_logs_expiry_days    = local.access_logs_expiry_days

  tags = local.common_tags
}

# =============================================================================
# Module: Cognito (Authentication)
# =============================================================================
# Creates:
# - User Pool with password policy and invitation templates
# - User Pool Domain with managed login V2 branding
# - Web Client (for frontend OAuth)
# - Resource Server (for M2M scopes)
# - Machine Client (for AgentCore Gateway)
# - Admin User (optional)

module "cognito" {
  source = "./modules/cognito"

  stack_name_base         = var.stack_name_base
  admin_user_email        = var.admin_user_email
  callback_urls           = local.default_callback_urls
  password_minimum_length = var.password_minimum_length

  # Use the predictable Amplify URL from the app_url output
  amplify_url = module.amplify_hosting.app_url

  tags = local.common_tags

  depends_on = [module.amplify_hosting]
}

# =============================================================================
# Module: AgentCore Memory
# =============================================================================
# Creates:
# - IAM Role for memory execution
# - BedrockAgentCore Memory resource

module "agentcore_memory" {
  source = "./modules/agentcore-memory"

  stack_name_base          = var.stack_name_base
  memory_event_expiry_days = var.memory_event_expiry_days

  tags = local.common_tags
}

# =============================================================================
# Module: AgentCore Gateway
# =============================================================================
# Creates:
# - IAM Role for gateway
# - Lambda function for sample tool
# - CloudWatch Log Group for Lambda
# - BedrockAgentCore Gateway
# - BedrockAgentCore Gateway Target

module "agentcore_gateway" {
  source = "./modules/agentcore-gateway"

  stack_name_base = var.stack_name_base

  # Cognito configuration for JWT authentication
  user_pool_id      = module.cognito.user_pool_id
  user_pool_arn     = module.cognito.user_pool_arn
  machine_client_id = module.cognito.machine_client_id

  log_retention_days = local.log_retention_days

  tags = local.common_tags

  depends_on = [module.cognito]
}

# =============================================================================
# Module: AgentCore Runtime
# =============================================================================
# Creates:
# - ECR Repository for container image
# - IAM Role with 13 policy statements
# - BedrockAgentCore Agent Runtime

module "agentcore_runtime" {
  source = "./modules/agentcore-runtime"

  stack_name_base = var.stack_name_base
  backend_pattern = var.backend_pattern
  agent_name      = var.agent_name
  network_mode    = var.network_mode
  runtime_name    = local.runtime_name

  # VPC configuration (for PRIVATE mode)
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids
  security_group_ids = var.security_group_ids

  # Cognito configuration for JWT authorizer
  user_pool_id  = module.cognito.user_pool_id
  web_client_id = module.cognito.web_client_id

  # Memory configuration
  memory_id  = module.agentcore_memory.memory_id
  memory_arn = module.agentcore_memory.memory_arn

  tags = local.common_tags

  depends_on = [module.cognito, module.agentcore_memory]
}

# =============================================================================
# Module: Feedback API
# =============================================================================
# Creates:
# - DynamoDB Table with GSI and PITR
# - Lambda function with Powertools layer
# - CloudWatch Log Groups (Lambda + API Gateway)
# - API Gateway REST API with Cognito authorizer
# - Request validator and stage configuration

module "feedback_api" {
  source = "./modules/feedback-api"

  stack_name_base = var.stack_name_base

  # Cognito configuration
  user_pool_id  = module.cognito.user_pool_id
  user_pool_arn = module.cognito.user_pool_arn

  # Frontend URL for CORS (using predictable Amplify URL)
  frontend_url = module.amplify_hosting.app_url

  # Lambda configuration
  powertools_layer_arn = local.powertools_layer_arn
  log_retention_days   = local.log_retention_days

  # API Gateway configuration
  throttling_rate_limit  = local.api_throttling_rate_limit
  throttling_burst_limit = local.api_throttling_burst_limit
  cache_ttl_seconds      = local.api_cache_ttl_seconds
  cache_cluster_size     = local.api_cache_cluster_size

  tags = local.common_tags

  depends_on = [module.cognito, module.amplify_hosting]
}

# =============================================================================
# SSM Parameters
# =============================================================================
# Store configuration values for cross-stack references and frontend access

resource "aws_ssm_parameter" "runtime_arn" {
  name        = "${local.ssm_parameter_prefix}/runtime-arn"
  description = "AgentCore Runtime ARN"
  type        = "String"
  value       = module.agentcore_runtime.runtime_arn

  tags = local.common_tags
}

resource "aws_ssm_parameter" "cognito_user_pool_id" {
  name        = "${local.ssm_parameter_prefix}/cognito-user-pool-id"
  description = "Cognito User Pool ID"
  type        = "String"
  value       = module.cognito.user_pool_id

  tags = local.common_tags
}

resource "aws_ssm_parameter" "cognito_user_pool_client_id" {
  name        = "${local.ssm_parameter_prefix}/cognito-user-pool-client-id"
  description = "Cognito User Pool Client ID"
  type        = "String"
  value       = module.cognito.web_client_id

  tags = local.common_tags
}

resource "aws_ssm_parameter" "machine_client_id" {
  name        = "${local.ssm_parameter_prefix}/machine_client_id"
  description = "Machine Client ID for M2M authentication"
  type        = "String"
  value       = module.cognito.machine_client_id

  tags = local.common_tags
}

resource "aws_ssm_parameter" "cognito_provider" {
  name        = "${local.ssm_parameter_prefix}/cognito_provider"
  description = "Cognito domain URL for token endpoint"
  type        = "String"
  value       = module.cognito.cognito_domain_url

  tags = local.common_tags
}

resource "aws_ssm_parameter" "feedback_api_url" {
  name        = "${local.ssm_parameter_prefix}/feedback-api-url"
  description = "Feedback API Gateway URL"
  type        = "String"
  value       = module.feedback_api.api_url

  tags = local.common_tags
}

resource "aws_ssm_parameter" "gateway_url" {
  name        = "${local.ssm_parameter_prefix}/gateway_url"
  description = "AgentCore Gateway URL"
  type        = "String"
  value       = module.agentcore_gateway.gateway_url

  tags = local.common_tags
}

# =============================================================================
# Secrets Manager - Machine Client Secret
# =============================================================================
# Store the machine client secret securely

resource "aws_secretsmanager_secret" "machine_client_secret" {
  name        = "${local.ssm_parameter_prefix}/machine_client_secret"
  description = "Machine Client Secret for M2M authentication"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "machine_client_secret" {
  secret_id     = aws_secretsmanager_secret.machine_client_secret.id
  secret_string = module.cognito.machine_client_secret
}
