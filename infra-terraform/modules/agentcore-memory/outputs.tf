# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

output "memory_id" {
  description = "AgentCore Memory ID"
  value       = aws_bedrockagentcore_memory.main.id
}

output "memory_arn" {
  description = "AgentCore Memory ARN"
  value       = aws_bedrockagentcore_memory.main.arn
}

output "memory_name" {
  description = "AgentCore Memory name"
  value       = aws_bedrockagentcore_memory.main.name
}

output "execution_role_arn" {
  description = "Memory execution role ARN"
  value       = aws_iam_role.memory_execution.arn
}
