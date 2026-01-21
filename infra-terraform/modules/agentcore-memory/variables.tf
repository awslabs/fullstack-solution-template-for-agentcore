# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

variable "stack_name_base" {
  description = "Base name for all resources."
  type        = string
}

variable "memory_event_expiry_days" {
  description = "Number of days after which memory events expire."
  type        = number
  default     = 30
}

variable "description" {
  description = "Description for the memory resource."
  type        = string
  default     = null
}

variable "encryption_key_arn" {
  description = "ARN of KMS key for encryption. If not provided, AWS managed encryption is used."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
