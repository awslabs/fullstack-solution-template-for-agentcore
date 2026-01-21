# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

variable "stack_name_base" {
  description = "Base name for all resources."
  type        = string
}

variable "backend_pattern" {
  description = "Agent pattern to deploy."
  type        = string
  default     = "strands-single-agent"
}

variable "agent_name" {
  description = "Name for the agent runtime."
  type        = string
  default     = "StrandsAgent"
}

variable "runtime_name" {
  description = "Full name for the runtime resource."
  type        = string
}

variable "network_mode" {
  description = "Network mode for AgentCore resources (PUBLIC or PRIVATE)."
  type        = string
  default     = "PUBLIC"
}

variable "vpc_id" {
  description = "VPC ID for private network mode."
  type        = string
  default     = null
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for private network mode."
  type        = list(string)
  default     = []
}

variable "security_group_ids" {
  description = "List of security group IDs for private network mode."
  type        = list(string)
  default     = []
}

variable "user_pool_id" {
  description = "Cognito User Pool ID for JWT authorizer."
  type        = string
}

variable "web_client_id" {
  description = "Cognito Web Client ID for JWT authorizer."
  type        = string
}

variable "memory_id" {
  description = "AgentCore Memory ID."
  type        = string
}

variable "memory_arn" {
  description = "AgentCore Memory ARN."
  type        = string
}

variable "container_uri" {
  description = "Container image URI. If not provided, ECR repository will be created."
  type        = string
  default     = null
}

variable "description" {
  description = "Description for the runtime."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
