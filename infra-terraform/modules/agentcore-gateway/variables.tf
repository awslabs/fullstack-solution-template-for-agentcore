# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

variable "stack_name_base" {
  description = "Base name for all resources."
  type        = string
}

variable "user_pool_id" {
  description = "Cognito User Pool ID for JWT authorization."
  type        = string
}

variable "user_pool_arn" {
  description = "Cognito User Pool ARN."
  type        = string
}

variable "machine_client_id" {
  description = "Machine Client ID for JWT authorization."
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days."
  type        = number
  default     = 7
}

variable "lambda_source_path" {
  description = "Path to Lambda source code. If not provided, uses default gateway/tools/sample_tool path."
  type        = string
  default     = null
}

variable "tool_spec_path" {
  description = "Path to tool specification JSON. If not provided, uses default gateway/tools/sample_tool/tool_spec.json."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
