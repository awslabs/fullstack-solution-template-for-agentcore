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

  # Cognito domain prefix (must be globally unique and lowercase)
  domain_prefix = "${lower(replace(var.stack_name_base, "_", "-"))}-${local.account_id}-${local.region}"

  # Combine callback URLs with Amplify URL if provided
  all_callback_urls = var.amplify_url != null ? concat(var.callback_urls, [var.amplify_url]) : var.callback_urls

  # User invitation email template
  invitation_email_subject = "Welcome to ${var.stack_name_base}!"
  invitation_email_body    = <<-EOF
<p>Hello {username},</p>
<p>Welcome to ${var.stack_name_base}! Your username is <strong>{username}</strong> and your temporary password is: <strong>{####}</strong></p>
<p>Please use this temporary password to log in and set your permanent password.</p>
<p>The CloudFront URL to your application is stored as an output in the "${var.stack_name_base}" stack, and will be printed to your terminal once the deployment process completes.</p>
<p>Thanks,</p>
<p>Fullstack AgentCore Solution Template Team</p>
EOF
}

# =============================================================================
# Cognito User Pool
# =============================================================================
# Main user pool for authentication with password policy and invitation templates

resource "aws_cognito_user_pool" "main" {
  name = "${var.stack_name_base}-user-pool"

  # Admin-only user creation (self sign-up disabled)
  admin_create_user_config {
    allow_admin_create_user_only = true

    # User invitation email template
    invite_message_template {
      email_subject = local.invitation_email_subject
      email_message = local.invitation_email_body
      sms_message   = "Your username is {username} and temporary password is {####}"
    }
  }

  # Sign-in with email
  username_attributes = ["email"]

  # Auto-verify email
  auto_verified_attributes = ["email"]

  # Account recovery via email only
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Password policy
  password_policy {
    minimum_length                   = var.password_minimum_length
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # Email attribute (required and immutable)
  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = false
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 0
      max_length = 2048
    }
  }

  # Email configuration
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Allow deletion (no protection)
  deletion_protection = "INACTIVE"

  tags = var.tags
}

# =============================================================================
# Cognito User Pool Domain
# =============================================================================
# Domain for hosted UI with managed login V2

resource "aws_cognito_user_pool_domain" "main" {
  domain       = local.domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

# =============================================================================
# Cognito Managed Login Branding (V2)
# =============================================================================
# Required for the v2 managed login to display properly

resource "aws_cognito_managed_login_branding" "main" {
  user_pool_id = aws_cognito_user_pool.main.id
  client_id    = aws_cognito_user_pool_client.web.id

  # Use Cognito's default styles
  use_cognito_provided_values = true

  depends_on = [aws_cognito_user_pool_domain.main]
}

# =============================================================================
# Cognito User Pool Client - Web (Frontend)
# =============================================================================
# OAuth client for frontend application

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.stack_name_base}-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # No secret for public client
  generate_secret = false

  # Auth flows
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  # OAuth configuration
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  # Callback and logout URLs
  callback_urls = local.all_callback_urls
  logout_urls   = local.all_callback_urls

  # Supported identity providers
  supported_identity_providers = ["COGNITO"]

  # Prevent user existence errors
  prevent_user_existence_errors = "ENABLED"

  # Token validity
  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

# =============================================================================
# Cognito Resource Server (for M2M Authentication)
# =============================================================================
# Defines API scopes that machine clients can request access to

resource "aws_cognito_resource_server" "gateway" {
  identifier   = "${var.stack_name_base}-gateway"
  name         = "${var.stack_name_base}-gateway-resource-server"
  user_pool_id = aws_cognito_user_pool.main.id

  # Scopes for gateway access
  scope {
    scope_name        = "read"
    scope_description = "Read access to gateway"
  }

  scope {
    scope_name        = "write"
    scope_description = "Write access to gateway"
  }
}

# =============================================================================
# Cognito User Pool Client - Machine (M2M)
# =============================================================================
# OAuth client for machine-to-machine authentication with client credentials flow

resource "aws_cognito_user_pool_client" "machine" {
  name         = "${var.stack_name_base}-machine-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # Secret required for client credentials flow
  generate_secret = true

  # OAuth configuration for M2M
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_flows_user_pool_client = true

  # Resource server scopes
  allowed_oauth_scopes = [
    "${aws_cognito_resource_server.gateway.identifier}/read",
    "${aws_cognito_resource_server.gateway.identifier}/write"
  ]

  # Supported identity providers
  supported_identity_providers = ["COGNITO"]

  # Token validity for M2M
  access_token_validity = 1

  token_validity_units {
    access_token = "hours"
  }

  # Machine client depends on resource server
  depends_on = [aws_cognito_resource_server.gateway]
}

# =============================================================================
# Cognito Admin User (Conditional)
# =============================================================================
# Creates admin user if email is provided

resource "aws_cognito_user" "admin" {
  count = var.admin_user_email != null ? 1 : 0

  user_pool_id = aws_cognito_user_pool.main.id
  username     = var.admin_user_email

  attributes = {
    email          = var.admin_user_email
    email_verified = true
  }

  # Send invitation email with temporary password
  desired_delivery_mediums = ["EMAIL"]
}
