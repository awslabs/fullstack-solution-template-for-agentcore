# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# =============================================================================
# User Pool Outputs
# =============================================================================

output "user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_endpoint" {
  description = "Cognito User Pool endpoint"
  value       = aws_cognito_user_pool.main.endpoint
}

# =============================================================================
# Web Client Outputs
# =============================================================================

output "web_client_id" {
  description = "Cognito Web Client ID (for frontend)"
  value       = aws_cognito_user_pool_client.web.id
}

# =============================================================================
# Machine Client Outputs
# =============================================================================

output "machine_client_id" {
  description = "Cognito Machine Client ID (for M2M authentication)"
  value       = aws_cognito_user_pool_client.machine.id
}

output "machine_client_secret" {
  description = "Cognito Machine Client Secret (for M2M authentication)"
  value       = aws_cognito_user_pool_client.machine.client_secret
  sensitive   = true
}

# =============================================================================
# Domain Outputs
# =============================================================================

output "domain_name" {
  description = "Cognito domain name"
  value       = aws_cognito_user_pool_domain.main.domain
}

output "cognito_domain_url" {
  description = "Full Cognito domain URL for OAuth token endpoint"
  value       = "${aws_cognito_user_pool_domain.main.domain}.auth.${local.region}.amazoncognito.com"
}

output "hosted_ui_url" {
  description = "Cognito hosted UI login URL"
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${local.region}.amazoncognito.com/login?client_id=${aws_cognito_user_pool_client.web.id}&response_type=code&redirect_uri=${urlencode(local.all_callback_urls[0])}"
}

# =============================================================================
# Resource Server Outputs
# =============================================================================

output "resource_server_identifier" {
  description = "Cognito Resource Server identifier"
  value       = aws_cognito_resource_server.gateway.identifier
}

# =============================================================================
# OIDC Configuration Outputs
# =============================================================================

output "oidc_issuer_url" {
  description = "OIDC issuer URL for JWT validation"
  value       = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "oidc_discovery_url" {
  description = "OIDC discovery URL (well-known configuration)"
  value       = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.main.id}/.well-known/openid-configuration"
}

# =============================================================================
# Admin User Outputs
# =============================================================================

output "admin_user_created" {
  description = "Whether admin user was created"
  value       = var.admin_user_email != null
}
