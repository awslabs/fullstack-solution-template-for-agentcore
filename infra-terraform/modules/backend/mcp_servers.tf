# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# Dynamic MCP Servers
# Maps to: infra-cdk/lib/utils/mcp-servers.ts + McpPrefsTable/McpPrefsLambda in
# backend-construct.ts
#
# - Each enabled entry in var.mcp_servers becomes an AgentCore Gateway target
#   named "{stack_name_base}-mcp-{id}" (streamable-HTTP MCP endpoint).
# - OAUTH entries get a native OAuth2 credential provider; secrets are read
#   from Secrets Manager at plan time and never appear in state outputs.
# - Per-user preferences: DynamoDB table + mcp-prefs Lambda on the feedback
#   API Gateway (GET/PUT /mcp-servers, same Cognito authorizer). The agent
#   runtime filters gateway tools per user (see patterns/*/tools/mcp_prefs.py).
# =============================================================================

locals {
  mcp_servers_enabled = [for s in var.mcp_servers : s if s.enabled]
  mcp_servers_by_id   = { for s in local.mcp_servers_enabled : s.id => s }
  mcp_oauth_servers   = { for s in local.mcp_servers_enabled : s.id => s if try(s.auth.type, "NONE") == "OAUTH" }
  mcp_feature_enabled = length(local.mcp_servers_enabled) > 0

  # Deploy-time catalog shared by the prefs Lambda and the agent runtime.
  # Contains no secrets.
  mcp_servers_catalog = jsonencode([
    for s in local.mcp_servers_enabled : {
      id              = s.id
      name            = s.name
      description     = coalesce(s.description, "")
      default_enabled = s.default_enabled
    }
  ])

  # Reuses the CDK Lambda source (same pattern as the feedback Lambda).
  mcp_prefs_lambda_source_path = "${path.module}/../../../infra-cdk/lambdas/mcp-prefs"
}

# -----------------------------------------------------------------------------
# OAuth2 credential providers (OAUTH entries only)
# -----------------------------------------------------------------------------

data "aws_secretsmanager_secret_version" "mcp_oauth_client_secret" {
  for_each  = local.mcp_oauth_servers
  secret_id = each.value.auth.client_secret_secret_arn
}

data "aws_secretsmanager_secret_version" "mcp_oauth_client_id" {
  for_each  = { for id, s in local.mcp_oauth_servers : id => s if try(s.auth.client_id_secret_arn, null) != null }
  secret_id = each.value.auth.client_id_secret_arn
}

resource "aws_bedrockagentcore_oauth2_credential_provider" "mcp" {
  for_each = local.mcp_oauth_servers

  name                       = "${var.stack_name_base}-mcp-${each.key}-oauth"
  credential_provider_vendor = "CustomOauth2"

  oauth2_provider_config {
    custom_oauth2_provider_config {
      client_id = (
        try(each.value.auth.client_id, null) != null
        ? each.value.auth.client_id
        : data.aws_secretsmanager_secret_version.mcp_oauth_client_id[each.key].secret_string
      )
      client_secret = data.aws_secretsmanager_secret_version.mcp_oauth_client_secret[each.key].secret_string

      oauth_discovery {
        discovery_url = each.value.auth.discovery_url
      }
    }
  }
}

# -----------------------------------------------------------------------------
# Gateway targets
# -----------------------------------------------------------------------------

resource "aws_bedrockagentcore_gateway_target" "mcp" {
  for_each = local.mcp_servers_by_id

  # Short name: gateway tool names become "{target}___{tool}" and must stay
  # within Bedrock's 64-char tool-name limit, so no stack prefix here
  # (the gateway is already stack-scoped).
  name               = "mcp-${each.key}"
  gateway_identifier = aws_bedrockagentcore_gateway.main.gateway_id
  description        = coalesce(each.value.description, each.value.name)

  # NONE auth: the block is omitted entirely — the Gateway API rejects any
  # credential provider type on unauthenticated MCP-server targets.
  dynamic "credential_provider_configuration" {
    for_each = try(each.value.auth.type, "NONE") == "OAUTH" ? [1] : []
    content {
      oauth {
        provider_arn = aws_bedrockagentcore_oauth2_credential_provider.mcp[each.key].credential_provider_arn
        scopes       = try(each.value.auth.scopes, [])
      }
    }
  }

  target_configuration {
    mcp {
      mcp_server {
        endpoint = each.value.endpoint
      }
    }
  }

  depends_on = [aws_bedrockagentcore_gateway.main]
}

# -----------------------------------------------------------------------------
# Per-user preferences: DynamoDB table
# -----------------------------------------------------------------------------

resource "aws_dynamodb_table" "mcp_prefs" {
  count = local.mcp_feature_enabled ? 1 : 0

  name         = "${var.stack_name_base}-mcp-prefs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  deletion_protection_enabled = false

  server_side_encryption {
    enabled = true
  }
}

# -----------------------------------------------------------------------------
# Preferences Lambda (GET/PUT /mcp-servers)
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "mcp_prefs_lambda" {
  count = local.mcp_feature_enabled ? 1 : 0

  name              = "/aws/lambda/${var.stack_name_base}-mcp-prefs"
  retention_in_days = local.log_retention_days
}

data "aws_iam_policy_document" "mcp_prefs_lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "mcp_prefs_lambda" {
  count = local.mcp_feature_enabled ? 1 : 0

  name               = "${var.stack_name_base}-mcp-prefs-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.mcp_prefs_lambda_assume_role.json
  description        = "Execution role for MCP preferences Lambda function"
}

data "aws_iam_policy_document" "mcp_prefs_lambda_policy" {
  count = local.mcp_feature_enabled ? 1 : 0

  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["${aws_cloudwatch_log_group.mcp_prefs_lambda[0].arn}:*"]
  }

  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem"
    ]
    resources = [aws_dynamodb_table.mcp_prefs[0].arn]
  }
}

resource "aws_iam_role_policy" "mcp_prefs_lambda" {
  count = local.mcp_feature_enabled ? 1 : 0

  name   = "${var.stack_name_base}-mcp-prefs-lambda-policy"
  role   = aws_iam_role.mcp_prefs_lambda[0].id
  policy = data.aws_iam_policy_document.mcp_prefs_lambda_policy[0].json
}

# No pip build needed — the Lambda has no dependencies beyond the Powertools
# layer and the runtime's boto3, so the source dir is zipped directly.
data "archive_file" "mcp_prefs_lambda" {
  count = local.mcp_feature_enabled ? 1 : 0

  type        = "zip"
  source_dir  = local.mcp_prefs_lambda_source_path
  output_path = "${path.module}/artifacts/mcp_prefs_lambda.zip"
  excludes    = ["__pycache__", "*.pyc"]
}

resource "aws_lambda_function" "mcp_prefs" {
  count = local.mcp_feature_enabled ? 1 : 0

  function_name = "${var.stack_name_base}-mcp-prefs"
  role          = aws_iam_role.mcp_prefs_lambda[0].arn
  handler       = "index.handler"
  runtime       = "python3.13"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.mcp_prefs_lambda[0].output_path
  source_code_hash = data.archive_file.mcp_prefs_lambda[0].output_base64sha256

  layers = [local.powertools_layer_arn]

  environment {
    variables = {
      TABLE_NAME           = aws_dynamodb_table.mcp_prefs[0].name
      MCP_SERVERS_CATALOG  = local.mcp_servers_catalog
      CORS_ALLOWED_ORIGINS = "${var.frontend_url},http://localhost:3000"
    }
  }

  depends_on = [aws_cloudwatch_log_group.mcp_prefs_lambda]
}

resource "aws_lambda_permission" "mcp_prefs_api_gateway" {
  count = local.mcp_feature_enabled ? 1 : 0

  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mcp_prefs[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.feedback.execution_arn}/*/*"
}

# -----------------------------------------------------------------------------
# API Gateway routes: /mcp-servers (GET, PUT, OPTIONS) on the feedback API
# -----------------------------------------------------------------------------

resource "aws_api_gateway_resource" "mcp_servers" {
  count = local.mcp_feature_enabled ? 1 : 0

  rest_api_id = aws_api_gateway_rest_api.feedback.id
  parent_id   = aws_api_gateway_rest_api.feedback.root_resource_id
  path_part   = "mcp-servers"
}

resource "aws_api_gateway_method" "mcp_servers" {
  for_each = local.mcp_feature_enabled ? toset(["GET", "PUT"]) : toset([])

  rest_api_id   = aws_api_gateway_rest_api.feedback.id
  resource_id   = aws_api_gateway_resource.mcp_servers[0].id
  http_method   = each.value
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "mcp_servers" {
  for_each = local.mcp_feature_enabled ? toset(["GET", "PUT"]) : toset([])

  rest_api_id             = aws_api_gateway_rest_api.feedback.id
  resource_id             = aws_api_gateway_resource.mcp_servers[0].id
  http_method             = aws_api_gateway_method.mcp_servers[each.value].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.mcp_prefs[0].invoke_arn
}

# OPTIONS /mcp-servers (CORS preflight)
resource "aws_api_gateway_method" "options_mcp_servers" {
  count = local.mcp_feature_enabled ? 1 : 0

  rest_api_id   = aws_api_gateway_rest_api.feedback.id
  resource_id   = aws_api_gateway_resource.mcp_servers[0].id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_mcp_servers" {
  count = local.mcp_feature_enabled ? 1 : 0

  rest_api_id = aws_api_gateway_rest_api.feedback.id
  resource_id = aws_api_gateway_resource.mcp_servers[0].id
  http_method = aws_api_gateway_method.options_mcp_servers[0].http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = jsonencode({
      statusCode = 200
    })
  }
}

resource "aws_api_gateway_method_response" "options_mcp_servers" {
  count = local.mcp_feature_enabled ? 1 : 0

  rest_api_id = aws_api_gateway_rest_api.feedback.id
  resource_id = aws_api_gateway_resource.mcp_servers[0].id
  http_method = aws_api_gateway_method.options_mcp_servers[0].http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_mcp_servers" {
  count = local.mcp_feature_enabled ? 1 : 0

  rest_api_id = aws_api_gateway_rest_api.feedback.id
  resource_id = aws_api_gateway_resource.mcp_servers[0].id
  http_method = aws_api_gateway_method.options_mcp_servers[0].http_method
  status_code = aws_api_gateway_method_response.options_mcp_servers[0].status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,PUT,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.frontend_url}'"
  }

  depends_on = [aws_api_gateway_integration.options_mcp_servers]
}

# The API Gateway cache does not vary on the Authorization header, so the
# per-user GET /mcp-servers response must never be cached (cross-user leak).
resource "aws_api_gateway_method_settings" "mcp_servers_get" {
  count = local.mcp_feature_enabled ? 1 : 0

  rest_api_id = aws_api_gateway_rest_api.feedback.id
  stage_name  = aws_api_gateway_stage.prod.stage_name
  method_path = "mcp-servers/GET"

  settings {
    caching_enabled = false
  }
}
