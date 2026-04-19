# Terraform Infrastructure for Fullstack AgentCore Solution Template

This directory contains Terraform configurations for deploying the Fullstack AgentCore Solution Template (FAST).

> **Deployment guide:** For step-by-step deployment instructions, see [Terraform Deployment Guide](../docs/TERRAFORM_DEPLOYMENT.md). This README covers module architecture, configuration reference, and developer documentation.

## Architecture

The infrastructure is organized into 3 Terraform modules, mirroring the CDK stack structure:

1. **Amplify Hosting** (`modules/amplify-hosting/`) - S3 staging buckets and frontend app hosting
2. **Cognito** (`modules/cognito/`) - User Pool, web client, domain, and admin user
3. **Backend** (`modules/backend/`) - All AgentCore and API resources:
   - AgentCore Memory - Persistent memory for agent conversations
   - M2M Authentication - Cognito resource server and machine client
   - OAuth2 Credential Provider - Lambda for Runtime -> Gateway authentication
   - AgentCore Gateway - MCP gateway with Lambda tool targets
   - AgentCore Runtime - ECR repository and containerized agent runtime
   - Feedback API - API Gateway + Lambda + DynamoDB
   - SSM Parameters and Secrets Manager

## Quick Start

```bash
cd infra-terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your configuration
terraform init
terraform apply
python scripts/deploy-frontend.py
```

See the [Terraform Deployment Guide](../docs/TERRAFORM_DEPLOYMENT.md) for detailed instructions, VPC deployment, troubleshooting, and cleanup.

## Configuration Reference

### Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `stack_name_base` | Base name for all resources (required) | - |
| `admin_user_email` | Email for Cognito admin user | `null` |
| `backend_pattern` | Agent pattern to deploy | `"strands-single-agent"` |
| `backend_deployment_type` | `"docker"` (ECR container) or `"zip"` (S3 package) | `"docker"` |
| `backend_network_mode` | Network mode (PUBLIC/VPC) | `"PUBLIC"` |
| `backend_vpc_id` | VPC ID (required when VPC mode) | `null` |
| `backend_vpc_subnet_ids` | Subnet IDs (required when VPC mode) | `[]` |
| `backend_vpc_security_group_ids` | Security group IDs (optional for VPC mode) | `[]` |

**Region:** Set via the `AWS_REGION` environment variable or AWS CLI profile. No region variable is needed.

**Tags:** Default tags (Project, ManagedBy, Repository) are applied automatically via the provider's `default_tags` block in `main.tf`.

### CDK config.yaml to Terraform Variable Mapping

Terraform uses flat variables with a `backend_` prefix to mirror the CDK's nested `config.yaml` structure:

| CDK config.yaml path | Terraform variable |
|---|---|
| `stack_name_base` | `stack_name_base` |
| `admin_user_email` | `admin_user_email` |
| `backend.pattern` | `backend_pattern` |
| `backend.deployment_type` | `backend_deployment_type` |
| `backend.network_mode` | `backend_network_mode` |
| `backend.vpc.vpc_id` | `backend_vpc_id` |
| `backend.vpc.subnet_ids` | `backend_vpc_subnet_ids` |
| `backend.vpc.security_group_ids` | `backend_vpc_security_group_ids` |

Values that are hardcoded in CDK (not in `config.yaml`) are defined as module-internal locals in Terraform: agent name (`FASTAgent`), memory event expiry (30 days), callback URLs, and password minimum length.

## Module Structure

```
infra-terraform/
├── main.tf                    # Root module - orchestrates all child modules
├── variables.tf               # Input variables
├── outputs.tf                 # Output values
├── locals.tf                  # Local values and computed variables
├── versions.tf                # Provider and version constraints
├── terraform.tfvars.example   # Example variable file
├── backend.tf.example         # Example S3 backend configuration
├── README.md                  # This file
├── lambdas/
│   └── zip-packager/              # Lambda for packaging agent code (zip mode)
│       └── index.py
├── scripts/
│   ├── build-and-push-image.sh    # Build and push Docker image to ECR
│   ├── deploy-frontend.py         # Deploy frontend (Python, cross-platform)
│   ├── deploy-frontend.sh         # Deploy frontend (Shell, macOS/Linux)
│   └── test-agent.py              # Test deployed agent
└── modules/
    ├── amplify-hosting/       # S3 staging buckets and Amplify app
    ├── cognito/               # User Pool, web client, domain, admin user
    └── backend/               # All AgentCore + Feedback resources
        ├── versions.tf
        ├── locals.tf          # Shared data sources, naming, paths
        ├── variables.tf       # Consolidated inputs from root
        ├── outputs.tf
        ├── artifacts/         # Build artifacts (.gitignored)
        ├── memory.tf          # AgentCore Memory + IAM
        ├── auth.tf            # M2M resource server + machine client
        ├── oauth2_provider.tf # OAuth2 provider Lambda + lifecycle management
        ├── gateway.tf         # Gateway + Lambda tool target
        ├── runtime.tf         # ECR/S3 + Agent Runtime (conditional)
        ├── zip_packager.tf    # S3 + Lambda packager (zip mode only)
        ├── feedback.tf        # DynamoDB + Lambda + API Gateway
        └── ssm.tf             # SSM parameters + Secrets Manager
```

> **Note:** Feedback and OAuth2 provider Lambda code is shared from `infra-cdk/lambdas/`. The zip-packager Lambda is Terraform-specific and lives under `infra-terraform/lambdas/`.

## Deployment Order

The modules are deployed in this order:

1. **Amplify Hosting** - First, to get predictable app URL
2. **Cognito** - Uses Amplify URL for OAuth callback URLs
3. **Backend** - Depends on Cognito and Amplify URL; internally creates Memory, Auth, Gateway, Runtime, Feedback API, and SSM resources with correct dependency ordering

## Outputs

| Output | Description |
|--------|-------------|
| `amplify_app_url` | Frontend application URL |
| `amplify_app_id` | Amplify App ID |
| `amplify_staging_bucket` | S3 bucket for frontend staging deployments |
| `cognito_user_pool_id` | Cognito User Pool ID |
| `cognito_web_client_id` | Cognito Web Client ID (for frontend) |
| `cognito_machine_client_id` | Cognito Machine Client ID (for M2M authentication) |
| `cognito_domain_url` | Cognito domain URL for OAuth |
| `gateway_id` | AgentCore Gateway ID |
| `gateway_arn` | AgentCore Gateway ARN |
| `gateway_url` | AgentCore Gateway URL |
| `gateway_target_id` | AgentCore Gateway Target ID |
| `tool_lambda_arn` | Sample tool Lambda function ARN |
| `runtime_id` | AgentCore Runtime ID |
| `runtime_arn` | AgentCore Runtime ARN |
| `runtime_role_arn` | AgentCore Runtime execution role ARN |
| `memory_arn` | AgentCore Memory ARN |
| `feedback_api_url` | Feedback API endpoint |
| `ssm_parameter_prefix` | SSM parameter prefix for this deployment |
| `deployment_summary` | Combined summary of all resources |

## State Management

By default, Terraform uses **local state** (`terraform.tfstate`). For team collaboration, use the S3 backend with native locking (`use_lockfile`, requires Terraform >= 1.11) and bucket versioning:

```bash
# 1. Create the state bucket (one-time)
aws s3 mb s3://YOUR-BUCKET-NAME --region us-east-1

# 2. Enable versioning (keeps prior state objects for rollback)
aws s3api put-bucket-versioning \
  --bucket YOUR-BUCKET-NAME \
  --versioning-configuration Status=Enabled

# 3. Block public access on the state bucket
aws s3api put-public-access-block \
  --bucket YOUR-BUCKET-NAME \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 4. Copy and edit the backend config
cp backend.tf.example backend.tf
# Edit backend.tf with your bucket name

# 5. Migrate state
terraform init -migrate-state
```

See `backend.tf.example` for the full configuration.

### Rolling back state

With bucket versioning enabled, a prior `terraform.tfstate` object can be restored without `terraform state` surgery. **Only do this when no operator is running Terraform against the stack** -- coordinate before restoring.

```bash
# 1. List historical versions of the state object
aws s3api list-object-versions \
  --bucket YOUR-BUCKET-NAME \
  --prefix fast/terraform.tfstate

# 2. Restore a prior version by copying it over the current object
aws s3api copy-object \
  --bucket YOUR-BUCKET-NAME \
  --key fast/terraform.tfstate \
  --copy-source "YOUR-BUCKET-NAME/fast/terraform.tfstate?versionId=<PRIOR_VERSION_ID>"

# 3. Run plan first to verify the drift matches expectations before any apply
terraform plan
```

Versioning is **not retroactive**: only state objects written after versioning was enabled can be recovered. Enable versioning on day one, not after an incident.

### Migrating from DynamoDB-only locking

Earlier versions of this template used a DynamoDB `terraform-locks` table. To migrate, use a two-phase rollout so teams running both old and new configs remain safe. Every operator must be on Terraform >= 1.11 before starting.

**Phase 1 -- dual-lock transition.** Temporarily keep both locks active so any `apply` from either config is protected:

```hcl
terraform {
  backend "s3" {
    bucket         = "YOUR-BUCKET-NAME"
    key            = "fast/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"   # keep during transition
    use_lockfile   = true                # new
    encrypt        = true
  }
}
```

Run `terraform init -reconfigure` and have every operator pull the dual-lock config before phase 2.

If versioning was not enabled on the existing bucket, enable it now with the `put-bucket-versioning` command above. Prior state objects are not recoverable retroactively.

**Phase 2 -- cut over to S3-only.** Once everyone is on the dual-lock config, remove `dynamodb_table` (matching the shipped `backend.tf.example`), run `terraform init -reconfigure`, then delete the table:

```bash
aws dynamodb delete-table --table-name terraform-locks --region us-east-1
```

The `dynamodb_table` argument is deprecated in Terraform 1.11 and may be removed in a future major release, so do not stay on the dual-lock config indefinitely.

## Resource Reference

| Resource Type | Terraform Resource |
|--------------|-------------------|
| User Pool | `aws_cognito_user_pool` |
| User Pool Client | `aws_cognito_user_pool_client` |
| User Pool Domain | `aws_cognito_user_pool_domain` |
| Resource Server | `aws_cognito_resource_server` |
| Amplify App | `aws_amplify_app` |
| Amplify Branch | `aws_amplify_branch` |
| AgentCore Memory | `aws_bedrockagentcore_memory` |
| AgentCore Gateway | `aws_bedrockagentcore_gateway` |
| Gateway Target | `aws_bedrockagentcore_gateway_target` |
| Agent Runtime | `aws_bedrockagentcore_agent_runtime` |
| DynamoDB Table | `aws_dynamodb_table` |
| REST API | `aws_api_gateway_rest_api` |
| Lambda Function | `aws_lambda_function` |
| SSM Parameter | `aws_ssm_parameter` |
| Secrets Manager | `aws_secretsmanager_secret` |

## Contributing

When modifying the Terraform configuration, run `terraform fmt` and `terraform validate` before committing.
