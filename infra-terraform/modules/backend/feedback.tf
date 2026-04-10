# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# Feedback API
# Maps to: backend-stack.ts createFeedbackApi() + createFeedbackTable()
# =============================================================================

# -----------------------------------------------------------------------------
# DynamoDB Table for Feedback Storage
# -----------------------------------------------------------------------------

resource "aws_dynamodb_table" "feedback" {
  name         = "${var.stack_name_base}-feedback"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "feedbackId"

  attribute {
    name = "feedbackId"
    type = "S"
  }

  attribute {
    name = "feedbackType"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "N"
  }

  # GSI for querying by feedbackType with timestamp sorting
  global_secondary_index {
    name            = "feedbackType-timestamp-index"
    hash_key        = "feedbackType"
    range_key       = "timestamp"
    projection_type = "ALL"
  }

  # Deletion protection disabled (allows terraform destroy)
  deletion_protection_enabled = false

  # Point-in-time recovery
  point_in_time_recovery {
    enabled = true
  }

  # Server-side encryption (AWS managed)
  server_side_encryption {
    enabled = true
  }

}

# -----------------------------------------------------------------------------
# CloudWatch Log Group for Lambda
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "feedback_lambda" {
  name              = "/aws/lambda/${var.stack_name_base}-feedback"
  retention_in_days = local.log_retention_days

}

# -----------------------------------------------------------------------------
# IAM Role for Lambda Function
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "feedback_lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "feedback_lambda" {
  name               = "${var.stack_name_base}-feedback-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.feedback_lambda_assume_role.json
  description        = "Execution role for feedback Lambda function"

}

data "aws_iam_policy_document" "feedback_lambda_policy" {
  # CloudWatch Logs
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["${aws_cloudwatch_log_group.feedback_lambda.arn}:*"]
  }

  # DynamoDB access
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan"
    ]
    resources = [
      aws_dynamodb_table.feedback.arn,
      "${aws_dynamodb_table.feedback.arn}/index/*"
    ]
  }
}

resource "aws_iam_role_policy" "feedback_lambda" {
  name   = "${var.stack_name_base}-feedback-lambda-policy"
  role   = aws_iam_role.feedback_lambda.id
  policy = data.aws_iam_policy_document.feedback_lambda_policy.json
}

# -----------------------------------------------------------------------------
# Lambda Function for Feedback API
# -----------------------------------------------------------------------------

# Build lambda package with dependencies (pip install from requirements.txt)
resource "null_resource" "feedback_lambda_build" {
  triggers = {
    source_hash       = sha256(join("", [for f in fileset(local.feedback_lambda_source_path, "*.py") : filesha256("${local.feedback_lambda_source_path}/${f}")]))
    requirements_hash = fileexists("${local.feedback_lambda_source_path}/requirements.txt") ? filesha256("${local.feedback_lambda_source_path}/requirements.txt") : ""
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD_DIR="${path.module}/artifacts/feedback_lambda_build"
      rm -rf "$BUILD_DIR"
      mkdir -p "$BUILD_DIR"
      cp ${local.feedback_lambda_source_path}/*.py "$BUILD_DIR/"
      if [ -f "${local.feedback_lambda_source_path}/requirements.txt" ]; then
        python3 -m pip install -r "${local.feedback_lambda_source_path}/requirements.txt" -t "$BUILD_DIR/" --quiet --upgrade
      fi
    EOT
  }
}

data "archive_file" "feedback_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/artifacts/feedback_lambda_build"
  output_path = "${path.module}/artifacts/feedback_lambda.zip"
  excludes    = ["__pycache__", "*.pyc", "*.dist-info"]

  depends_on = [null_resource.feedback_lambda_build]
}

resource "aws_lambda_function" "feedback" {
  function_name = "${var.stack_name_base}-feedback"
  role          = aws_iam_role.feedback_lambda.arn
  handler       = "index.handler"
  runtime       = "python3.13"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.feedback_lambda.output_path
  source_code_hash = data.archive_file.feedback_lambda.output_base64sha256

  # Lambda Powertools layer
  layers = [local.powertools_layer_arn]

  # Environment variables
  environment {
    variables = {
      TABLE_NAME           = aws_dynamodb_table.feedback.name
      CORS_ALLOWED_ORIGINS = "${var.frontend_url},http://localhost:3000"
    }
  }

  depends_on = [aws_cloudwatch_log_group.feedback_lambda]

}

# -----------------------------------------------------------------------------
# API Gateway REST API
# -----------------------------------------------------------------------------

resource "aws_api_gateway_rest_api" "feedback" {
  name        = "${var.stack_name_base}-feedback-api"
  description = "API Gateway for feedback collection"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

}

# -----------------------------------------------------------------------------
# Cognito Authorizer
# -----------------------------------------------------------------------------

resource "aws_api_gateway_authorizer" "cognito" {
  name                             = "${var.stack_name_base}-cognito-authorizer"
  rest_api_id                      = aws_api_gateway_rest_api.feedback.id
  type                             = "COGNITO_USER_POOLS"
  provider_arns                    = [var.user_pool_arn]
  identity_source                  = "method.request.header.Authorization"
  authorizer_result_ttl_in_seconds = local.api_cache_ttl_seconds
}

# -----------------------------------------------------------------------------
# API Gateway Resources
# -----------------------------------------------------------------------------

# /feedback resource
resource "aws_api_gateway_resource" "feedback" {
  rest_api_id = aws_api_gateway_rest_api.feedback.id
  parent_id   = aws_api_gateway_rest_api.feedback.root_resource_id
  path_part   = "feedback"
}

# -----------------------------------------------------------------------------
# API Gateway Methods
# -----------------------------------------------------------------------------

# POST /feedback
resource "aws_api_gateway_method" "post_feedback" {
  rest_api_id   = aws_api_gateway_rest_api.feedback.id
  resource_id   = aws_api_gateway_resource.feedback.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

# OPTIONS /feedback (CORS preflight)
resource "aws_api_gateway_method" "options_feedback" {
  rest_api_id   = aws_api_gateway_rest_api.feedback.id
  resource_id   = aws_api_gateway_resource.feedback.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

# -----------------------------------------------------------------------------
# API Gateway Integrations
# -----------------------------------------------------------------------------

# POST /feedback -> Lambda
resource "aws_api_gateway_integration" "post_feedback" {
  rest_api_id             = aws_api_gateway_rest_api.feedback.id
  resource_id             = aws_api_gateway_resource.feedback.id
  http_method             = aws_api_gateway_method.post_feedback.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.feedback.invoke_arn
}

# OPTIONS /feedback -> Mock (CORS)
resource "aws_api_gateway_integration" "options_feedback" {
  rest_api_id = aws_api_gateway_rest_api.feedback.id
  resource_id = aws_api_gateway_resource.feedback.id
  http_method = aws_api_gateway_method.options_feedback.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = jsonencode({
      statusCode = 200
    })
  }
}

# OPTIONS method response
resource "aws_api_gateway_method_response" "options_feedback" {
  rest_api_id = aws_api_gateway_rest_api.feedback.id
  resource_id = aws_api_gateway_resource.feedback.id
  http_method = aws_api_gateway_method.options_feedback.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

# OPTIONS integration response
resource "aws_api_gateway_integration_response" "options_feedback" {
  rest_api_id = aws_api_gateway_rest_api.feedback.id
  resource_id = aws_api_gateway_resource.feedback.id
  http_method = aws_api_gateway_method.options_feedback.http_method
  status_code = aws_api_gateway_method_response.options_feedback.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.frontend_url}'"
  }

  depends_on = [aws_api_gateway_integration.options_feedback]
}

# -----------------------------------------------------------------------------
# Lambda Permission for API Gateway
# -----------------------------------------------------------------------------

resource "aws_lambda_permission" "feedback_api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.feedback.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.feedback.execution_arn}/*/*"
}

# -----------------------------------------------------------------------------
# API Gateway Deployment
# -----------------------------------------------------------------------------

resource "aws_api_gateway_deployment" "feedback" {
  rest_api_id = aws_api_gateway_rest_api.feedback.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.feedback.id,
      aws_api_gateway_method.post_feedback.id,
      aws_api_gateway_method.options_feedback.id,
      aws_api_gateway_integration.post_feedback.id,
      aws_api_gateway_integration.options_feedback.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.post_feedback,
    aws_api_gateway_integration.options_feedback
  ]
}

resource "aws_api_gateway_stage" "prod" {
  stage_name    = "prod"
  rest_api_id   = aws_api_gateway_rest_api.feedback.id
  deployment_id = aws_api_gateway_deployment.feedback.id

  # Access logs
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway_access.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      ip               = "$context.identity.sourceIp"
      caller           = "$context.identity.caller"
      user             = "$context.identity.user"
      requestTime      = "$context.requestTime"
      httpMethod       = "$context.httpMethod"
      resourcePath     = "$context.resourcePath"
      status           = "$context.status"
      protocol         = "$context.protocol"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }


  depends_on = [aws_cloudwatch_log_group.api_gateway_access]
}

# CloudWatch Log Group for API Gateway access logs
resource "aws_cloudwatch_log_group" "api_gateway_access" {
  name              = "/aws/apigateway/${var.stack_name_base}-feedback-api/access-logs"
  retention_in_days = local.log_retention_days

}

# -----------------------------------------------------------------------------
# API Gateway Method Settings (throttling + caching)
# -----------------------------------------------------------------------------

resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.feedback.id
  stage_name  = aws_api_gateway_stage.prod.stage_name
  method_path = "*/*"

  settings {
    throttling_rate_limit  = local.api_throttling_rate_limit
    throttling_burst_limit = local.api_throttling_burst_limit
    caching_enabled        = true
    cache_data_encrypted   = true
    cache_ttl_in_seconds   = local.api_cache_ttl_seconds
    logging_level          = "INFO"
    metrics_enabled        = true
    data_trace_enabled     = false
  }
}
