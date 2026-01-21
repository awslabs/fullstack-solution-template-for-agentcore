# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

output "gateway_id" {
  description = "AgentCore Gateway ID"
  value       = aws_bedrockagentcore_gateway.main.gateway_id
}

output "gateway_arn" {
  description = "AgentCore Gateway ARN"
  value       = aws_bedrockagentcore_gateway.main.gateway_arn
}

output "gateway_url" {
  description = "AgentCore Gateway URL"
  value       = aws_bedrockagentcore_gateway.main.gateway_url
}

output "gateway_target_id" {
  description = "AgentCore Gateway Target ID"
  value       = aws_bedrockagentcore_gateway_target.sample_tool.target_id
}

output "tool_lambda_arn" {
  description = "Sample tool Lambda function ARN"
  value       = aws_lambda_function.sample_tool.arn
}

output "gateway_role_arn" {
  description = "Gateway IAM role ARN"
  value       = aws_iam_role.gateway.arn
}
