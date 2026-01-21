# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# =============================================================================
# Cognito Outputs
# =============================================================================

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.cognito.user_pool_id
}

output "cognito_user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = module.cognito.user_pool_arn
}

output "cognito_web_client_id" {
  description = "Cognito Web Client ID (for frontend)"
  value       = module.cognito.web_client_id
}

output "cognito_machine_client_id" {
  description = "Cognito Machine Client ID (for M2M authentication)"
  value       = module.cognito.machine_client_id
}

output "cognito_domain_url" {
  description = "Cognito domain URL for OAuth"
  value       = module.cognito.cognito_domain_url
}

output "cognito_hosted_ui_url" {
  description = "Cognito hosted UI login URL"
  value       = module.cognito.hosted_ui_url
}

# =============================================================================
# Amplify Outputs
# =============================================================================

output "amplify_app_id" {
  description = "Amplify App ID"
  value       = module.amplify_hosting.app_id
}

output "amplify_app_url" {
  description = "Amplify App URL (frontend)"
  value       = module.amplify_hosting.app_url
}

output "amplify_staging_bucket" {
  description = "S3 bucket for frontend staging deployments"
  value       = module.amplify_hosting.staging_bucket_name
}

# =============================================================================
# AgentCore Memory Outputs
# =============================================================================

output "memory_id" {
  description = "AgentCore Memory ID"
  value       = module.agentcore_memory.memory_id
}

output "memory_arn" {
  description = "AgentCore Memory ARN"
  value       = module.agentcore_memory.memory_arn
}

# =============================================================================
# AgentCore Gateway Outputs
# =============================================================================

output "gateway_id" {
  description = "AgentCore Gateway ID"
  value       = module.agentcore_gateway.gateway_id
}

output "gateway_arn" {
  description = "AgentCore Gateway ARN"
  value       = module.agentcore_gateway.gateway_arn
}

output "gateway_url" {
  description = "AgentCore Gateway URL"
  value       = module.agentcore_gateway.gateway_url
}

output "gateway_target_id" {
  description = "AgentCore Gateway Target ID"
  value       = module.agentcore_gateway.gateway_target_id
}

output "tool_lambda_arn" {
  description = "Sample tool Lambda function ARN"
  value       = module.agentcore_gateway.tool_lambda_arn
}

# =============================================================================
# AgentCore Runtime Outputs
# =============================================================================

output "runtime_id" {
  description = "AgentCore Runtime ID"
  value       = module.agentcore_runtime.runtime_id
}

output "runtime_arn" {
  description = "AgentCore Runtime ARN"
  value       = module.agentcore_runtime.runtime_arn
}

output "runtime_role_arn" {
  description = "AgentCore Runtime execution role ARN"
  value       = module.agentcore_runtime.role_arn
}

output "ecr_repository_url" {
  description = "ECR repository URL for agent container"
  value       = module.agentcore_runtime.ecr_repository_url
}

# =============================================================================
# Feedback API Outputs
# =============================================================================

output "feedback_api_url" {
  description = "Feedback API Gateway URL"
  value       = module.feedback_api.api_url
}

output "feedback_api_id" {
  description = "Feedback API Gateway ID"
  value       = module.feedback_api.api_id
}

output "feedback_table_name" {
  description = "Feedback DynamoDB table name"
  value       = module.feedback_api.dynamodb_table_name
}

output "feedback_lambda_arn" {
  description = "Feedback Lambda function ARN"
  value       = module.feedback_api.lambda_function_arn
}

# =============================================================================
# SSM Parameter Paths (for reference)
# =============================================================================

output "ssm_parameter_prefix" {
  description = "SSM parameter prefix for this deployment"
  value       = local.ssm_parameter_prefix
}

# =============================================================================
# Summary Output
# =============================================================================

output "deployment_summary" {
  description = "Summary of deployed resources"
  value = {
    stack_name    = var.stack_name_base
    region        = local.region
    account_id    = local.account_id
    environment   = var.environment
    frontend_url  = module.amplify_hosting.app_url
    gateway_url   = module.agentcore_gateway.gateway_url
    api_url       = module.feedback_api.api_url
    cognito_login = module.cognito.hosted_ui_url
  }
}
