# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# =============================================================================
# Required Variables
# =============================================================================

variable "stack_name_base" {
  description = "Base name for all resources. Used as prefix for resource naming."
  type        = string

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9-]{2,62}$", var.stack_name_base))
    error_message = "Stack name must start with a letter, be 3-63 characters, and contain only alphanumeric characters and hyphens."
  }
}

variable "aws_region" {
  description = "AWS region for deployment."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-\\d$", var.aws_region))
    error_message = "Must be a valid AWS region (e.g., us-east-1, eu-west-1)."
  }
}

# =============================================================================
# Optional Variables - Admin User
# =============================================================================

variable "admin_user_email" {
  description = "Email address for the admin user. If provided, creates an admin user and sends credentials via email. Set to null to skip admin user creation."
  type        = string
  default     = null

  validation {
    condition     = var.admin_user_email == null || can(regex("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$", var.admin_user_email))
    error_message = "Must be a valid email address or null."
  }
}

# =============================================================================
# Backend Configuration
# =============================================================================

variable "backend_pattern" {
  description = "Agent pattern to deploy. Available patterns: strands-single-agent, langgraph-single-agent"
  type        = string
  default     = "strands-single-agent"

  validation {
    condition     = contains(["strands-single-agent", "langgraph-single-agent"], var.backend_pattern)
    error_message = "Backend pattern must be one of: strands-single-agent, langgraph-single-agent."
  }
}

variable "agent_name" {
  description = "Name for the agent runtime."
  type        = string
  default     = "StrandsAgent"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{1,62}$", var.agent_name))
    error_message = "Agent name must start with a letter, be 2-63 characters, and contain only alphanumeric characters and underscores."
  }
}

variable "network_mode" {
  description = "Network mode for AgentCore resources. PUBLIC uses public internet, PRIVATE requires VPC configuration."
  type        = string
  default     = "PUBLIC"

  validation {
    condition     = contains(["PUBLIC", "PRIVATE"], var.network_mode)
    error_message = "Network mode must be PUBLIC or PRIVATE."
  }
}

# =============================================================================
# VPC Configuration (Required if network_mode = PRIVATE)
# =============================================================================

variable "vpc_id" {
  description = "VPC ID for private network mode. Required if network_mode is PRIVATE."
  type        = string
  default     = null
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for private network mode. Required if network_mode is PRIVATE."
  type        = list(string)
  default     = []
}

variable "security_group_ids" {
  description = "List of security group IDs for private network mode. Required if network_mode is PRIVATE."
  type        = list(string)
  default     = []
}

# =============================================================================
# Cognito Configuration
# =============================================================================

variable "callback_urls" {
  description = "OAuth callback URLs for Cognito. Defaults include localhost for development."
  type        = list(string)
  default     = ["http://localhost:3000", "https://localhost:3000"]
}

variable "password_minimum_length" {
  description = "Minimum password length for Cognito User Pool."
  type        = number
  default     = 8

  validation {
    condition     = var.password_minimum_length >= 8 && var.password_minimum_length <= 99
    error_message = "Password minimum length must be between 8 and 99."
  }
}

# =============================================================================
# Memory Configuration
# =============================================================================

variable "memory_event_expiry_days" {
  description = "Number of days after which memory events expire. Must be between 7 and 365."
  type        = number
  default     = 30

  validation {
    condition     = var.memory_event_expiry_days >= 7 && var.memory_event_expiry_days <= 365
    error_message = "Memory event expiry must be between 7 and 365 days."
  }
}

# =============================================================================
# Tagging
# =============================================================================

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}

variable "environment" {
  description = "Environment name (e.g., dev, staging, prod)."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod", "test"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod, test."
  }
}
