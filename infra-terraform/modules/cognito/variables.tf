# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

variable "stack_name_base" {
  description = "Base name for all resources."
  type        = string
}

variable "admin_user_email" {
  description = "Email address for the admin user. If provided, creates an admin user."
  type        = string
  default     = null
}

variable "callback_urls" {
  description = "OAuth callback URLs for Cognito."
  type        = list(string)
  default     = ["http://localhost:3000", "https://localhost:3000"]
}

variable "amplify_url" {
  description = "Amplify app URL to add to callback URLs."
  type        = string
  default     = null
}

variable "password_minimum_length" {
  description = "Minimum password length for Cognito User Pool."
  type        = number
  default     = 8
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
