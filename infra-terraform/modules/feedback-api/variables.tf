# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

variable "stack_name_base" {
  description = "Base name for all resources."
  type        = string
}

variable "user_pool_id" {
  description = "Cognito User Pool ID for authorizer."
  type        = string
}

variable "user_pool_arn" {
  description = "Cognito User Pool ARN for authorizer."
  type        = string
}

variable "frontend_url" {
  description = "Frontend URL for CORS configuration."
  type        = string
}

variable "powertools_layer_arn" {
  description = "ARN of the AWS Lambda Powertools layer."
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days."
  type        = number
  default     = 7
}

variable "throttling_rate_limit" {
  description = "API Gateway throttling rate limit."
  type        = number
  default     = 100
}

variable "throttling_burst_limit" {
  description = "API Gateway throttling burst limit."
  type        = number
  default     = 200
}

variable "cache_ttl_seconds" {
  description = "API Gateway cache TTL in seconds."
  type        = number
  default     = 300
}

variable "cache_cluster_size" {
  description = "API Gateway cache cluster size."
  type        = string
  default     = "0.5"
}

variable "lambda_source_path" {
  description = "Path to Lambda source code. If not provided, uses default lambdas/feedback path."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
