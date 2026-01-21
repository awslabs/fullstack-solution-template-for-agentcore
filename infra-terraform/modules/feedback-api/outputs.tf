# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

output "api_url" {
  description = "Feedback API endpoint URL"
  value       = "${aws_api_gateway_stage.prod.invoke_url}/feedback"
}

output "api_id" {
  description = "API Gateway REST API ID"
  value       = aws_api_gateway_rest_api.feedback.id
}

output "dynamodb_table_name" {
  description = "DynamoDB table name for feedback storage"
  value       = aws_dynamodb_table.feedback.name
}

output "dynamodb_table_arn" {
  description = "DynamoDB table ARN"
  value       = aws_dynamodb_table.feedback.arn
}

output "lambda_function_arn" {
  description = "Feedback Lambda function ARN"
  value       = aws_lambda_function.feedback.arn
}
