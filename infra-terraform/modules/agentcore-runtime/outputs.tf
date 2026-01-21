# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

output "runtime_id" {
  description = "AgentCore Runtime ID"
  value       = aws_bedrockagentcore_agent_runtime.main.agent_runtime_id
}

output "runtime_arn" {
  description = "AgentCore Runtime ARN"
  value       = aws_bedrockagentcore_agent_runtime.main.agent_runtime_arn
}

output "runtime_version" {
  description = "AgentCore Runtime version"
  value       = aws_bedrockagentcore_agent_runtime.main.agent_runtime_version
}

output "role_arn" {
  description = "AgentCore Runtime execution role ARN"
  value       = aws_iam_role.runtime.arn
}

output "ecr_repository_url" {
  description = "ECR repository URL for agent container"
  value       = var.container_uri == null ? aws_ecr_repository.agent[0].repository_url : null
}

output "ecr_repository_name" {
  description = "ECR repository name"
  value       = var.container_uri == null ? aws_ecr_repository.agent[0].name : null
}
