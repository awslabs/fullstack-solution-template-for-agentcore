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

  # Memory name (unique within account/region)
  # Must match ^[a-zA-Z][a-zA-Z0-9_]{0,47}$ - no hyphens allowed
  memory_name = "${replace(var.stack_name_base, "-", "_")}_memory"

  # Description for memory resource
  memory_description = var.description != null ? var.description : "Short-term memory for ${var.stack_name_base} agent"
}

# =============================================================================
# IAM Role for Memory Execution
# =============================================================================
# Role assumed by AgentCore Memory service for processing operations

data "aws_iam_policy_document" "memory_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "memory_execution" {
  name               = "${var.stack_name_base}-memory-execution-role"
  assume_role_policy = data.aws_iam_policy_document.memory_assume_role.json
  description        = "Execution role for AgentCore Memory"

  tags = var.tags
}

# Attach the AWS managed policy for Bedrock model inference
# This is required for long-term memory strategies that use model processing
resource "aws_iam_role_policy_attachment" "memory_bedrock_policy" {
  role       = aws_iam_role.memory_execution.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonBedrockAgentCoreMemoryBedrockModelInferenceExecutionRolePolicy"
}

# =============================================================================
# AgentCore Memory
# =============================================================================
# Persistent memory resource for AI agent interactions
# Configured with short-term memory (conversation history) as default
# To enable long-term strategies (summaries, preferences, facts), add memory_strategies

resource "aws_bedrockagentcore_memory" "main" {
  name                  = local.memory_name
  event_expiry_duration = var.memory_event_expiry_days
  description           = local.memory_description

  # Optional: Custom KMS encryption
  encryption_key_arn = var.encryption_key_arn

  # Memory execution role for model processing (required for long-term strategies)
  memory_execution_role_arn = aws_iam_role.memory_execution.arn

  # Note: memory_strategies is empty array by default = short-term only (conversation history)
  # For long-term strategies, configure in a separate resource or variable

  tags = merge(
    var.tags,
    {
      Name      = "${var.stack_name_base}_Memory"
      ManagedBy = "Terraform"
    }
  )
}
