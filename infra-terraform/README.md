# Terraform Infrastructure for Fullstack AgentCore Solution Template

This directory contains Terraform configurations for deploying the Fullstack AgentCore Solution Template (FAST).

> **Note:** All commands and scripts in this README run from the `infra-terraform/` directory. This folder is self-contained and independent from the CDK deployment (`infra-cdk/`).

## Architecture

The infrastructure is organized into 3 Terraform modules, mirroring the CDK stack structure:

1. **Amplify Hosting** (`modules/amplify-hosting/`) - S3 staging buckets and frontend app hosting
2. **Cognito** (`modules/cognito/`) - User Pool, web client, domain, and admin user
3. **Backend** (`modules/backend/`) - All AgentCore and API resources:
   - AgentCore Memory - Persistent memory for agent conversations
   - M2M Authentication - Cognito resource server and machine client
   - AgentCore Gateway - MCP gateway with Lambda tool targets
   - AgentCore Runtime - ECR repository and containerized agent runtime
   - Feedback API - API Gateway + Lambda + DynamoDB
   - SSM Parameters and Secrets Manager

## Prerequisites

1. **Terraform** >= 1.5.0
2. **AWS CLI** configured with appropriate credentials
3. **Docker** (only required for `deployment_type = "docker"`)

> **Note:** This project requires **AWS provider v6.22.0 - v6.34.x**. AWS provider v6.35.0+ has a regression that breaks Gateway Target resources. The version is constrained in `versions.tf`. See [Troubleshooting](#gateway-target-schema-error) for details.

## Deployment Types

FAST supports two deployment types for the AgentCore Runtime:

| | Docker (default) | Zip |
|---|---|---|
| **How it works** | Builds a Docker container image and pushes to ECR | Packages Python code + ARM64 wheels via Lambda and uploads to S3 |
| **Requires Docker** | Yes | No |
| **Best for** | Custom runtime images, complex dependencies | Quick deployment, CI/CD, environments without Docker |

Set `deployment_type` in your `terraform.tfvars`:
```hcl
deployment_type = "docker"  # or "zip"
```

## Quick Start

```bash
# Navigate to the terraform directory
cd infra-terraform

# Copy the example variables file
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars with your configuration
# At minimum, set admin_user_email for the Cognito admin user

# Initialize Terraform
terraform init
```

### Deploy
```bash
terraform apply
```

- **Docker mode** (default): Builds an ARM64 Docker image, pushes to ECR, and creates the runtime. Requires Docker to be running locally.
- **Zip mode**: Deploys a packager Lambda that bundles your agent code with ARM64 wheels, uploads to S3, and creates the runtime. No Docker required.

> **Note:** If you provide a pre-built image via `container_uri`, Terraform skips the build and uses your image directly.

### Manual Docker Build (Optional)

If you prefer to build the Docker image separately (e.g., in CI/CD), you can use the build script:
```bash
./scripts/build-and-push-image.sh
```

**Options:**
```bash
./scripts/build-and-push-image.sh -h                          # Show help
./scripts/build-and-push-image.sh -p langgraph-single-agent   # Use LangGraph pattern
./scripts/build-and-push-image.sh -s my-stack -r us-west-2    # Override stack/region
```

### (Optional) Verify Deployment
```bash
terraform output deployment_summary
```

## Configuration

### Required Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `stack_name_base` | Base name for all resources | `"fast"` |
| `aws_region` | AWS region for deployment | `"us-east-1"` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `admin_user_email` | Email for Cognito admin user | `null` |
| `backend_pattern` | Agent pattern to deploy | `"strands-single-agent"` |
| `deployment_type` | `"docker"` (ECR container) or `"zip"` (S3 package) | `"docker"` |
| `agent_name` | Name for the agent runtime | `"StrandsAgent"` |
| `network_mode` | Network mode (PUBLIC/PRIVATE) | `"PUBLIC"` |
| `environment` | Environment name for tagging | `"dev"` |
| `memory_event_expiry_days` | Memory event TTL in days | `30` |

### VPC Configuration (Private Mode)

For `PRIVATE` network mode, provide VPC details:

```hcl
network_mode       = "PRIVATE"
vpc_id             = "vpc-xxxxxxxx"
private_subnet_ids = ["subnet-xxx", "subnet-yyy"]
security_group_ids = ["sg-xxxxxxxx"]
```

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
        ├── gateway.tf         # Gateway + Lambda tool target
        ├── runtime.tf         # ECR/S3 + Agent Runtime (conditional)
        ├── zip_packager.tf    # S3 + Lambda packager (zip mode only)
        ├── feedback.tf        # DynamoDB + Lambda + API Gateway
        └── ssm.tf             # SSM parameters + Secrets Manager
```

> **Note:** Feedback Lambda source code is shared from `infra-cdk/lambdas/feedback/`. The zip-packager Lambda is Terraform-specific and lives under `infra-terraform/lambdas/`.

## Deployment Order

The modules are deployed in this order:

1. **Amplify Hosting** - First, to get predictable app URL
2. **Cognito** - Uses Amplify URL for OAuth callback URLs
3. **Backend** - Depends on Cognito and Amplify URL; internally creates Memory, Auth, Gateway, Runtime, Feedback API, and SSM resources with correct dependency ordering

## Post-Deployment Steps

### 1. Deploy Frontend

Two deployment scripts are available:

**Python (cross-platform - recommended):**
```bash
# From infra-terraform directory
python scripts/deploy-frontend.py

# Or with options
python scripts/deploy-frontend.py --pattern langgraph-single-agent
```

**Shell (macOS/Linux only):**
```bash
# From infra-terraform directory
./scripts/deploy-frontend.sh

# Or with options
./scripts/deploy-frontend.sh -p langgraph-single-agent
```

Both scripts perform the same operations:
- Fetch configuration from Terraform outputs
- Generate `aws-exports.json` for frontend authentication
- Build the Next.js application
- Package and upload to S3
- Trigger Amplify deployment and monitor status

### 2. Test the Agent (Optional)

```bash
# From infra-terraform directory
pip install boto3 requests colorama  # First time only
python scripts/test-agent.py 'Hello, what can you do?'
```

### 3. Verify Deployment

```bash
# Get deployment summary
terraform output deployment_summary

# Get all outputs
terraform output
```

## Outputs

| Output | Description |
|--------|-------------|
| `amplify_app_url` | Frontend application URL |
| `cognito_hosted_ui_url` | Cognito login page URL |
| `gateway_url` | AgentCore Gateway URL |
| `runtime_arn` | AgentCore Runtime ARN |
| `memory_arn` | AgentCore Memory ARN |
| `feedback_api_url` | Feedback API endpoint |
| `ecr_repository_url` | ECR repository for agent container (docker mode) |
| `agent_code_bucket` | S3 bucket for agent code (zip mode) |
| `deployment_type` | Deployment type used (docker or zip) |
| `deployment_summary` | Combined summary of all resources |

## State Management

By default, Terraform uses **local state** (`terraform.tfstate`). For team collaboration, use the S3 backend:

```bash
# 1. Create S3 bucket & DynamoDB table (one-time)
aws s3 mb s3://YOUR-BUCKET-NAME --region us-east-1
aws dynamodb create-table --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region us-east-1

# 2. Copy and edit the backend config
cp backend.tf.example backend.tf
# Edit backend.tf with your bucket name

# 3. Migrate state
terraform init -migrate-state
```

See `backend.tf.example` for the full configuration.

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

## Troubleshooting

### Terraform Init Fails

Ensure you have the correct provider versions:
```bash
terraform init -upgrade
```

### Authentication Errors

Verify AWS credentials:
```bash
aws sts get-caller-identity
```

### AgentCore Resources Not Found

AgentCore resources require AWS provider version >= 5.82.0 with the `aws_bedrockagentcore_*` resources.

If your provider version doesn't support these resources yet, use the AWS CLI:

```bash
aws bedrock-agentcore create-agent-runtime --cli-input-json file://runtime-config.json
```

### Gateway Target Schema Error

**Error Message:**
```
Error: reading Bedrock AgentCore Gateway Target: Unsupported Type
  with module.backend.aws_bedrockagentcore_gateway_target.sample_tool,
  on modules/backend/gateway.tf line 226
Cause: schema definition flatten: *types.SchemaDefinition
```

**Cause:**
AWS Terraform provider regression introduced in v6.35.0 affects Gateway Target resources with nested `input_schema.property` blocks. The provider cannot deserialize the schema during state refresh.

**Solution:**
This project requires **AWS provider v6.22.0 through v6.34.x**. The version is constrained in `versions.tf`:

```hcl
required_providers {
  aws = {
    source  = "hashicorp/aws"
    version = ">= 6.22.0, < 6.35.0"
  }
}
```

**Alternative Solution (if you need AWS provider v6.35.0+):**

If you must use a provider version >= v6.35.0 and are facing this issue, you can skip automatic state refresh to avoid the deserialization error:

```bash
# Skip refresh during plan
terraform plan -refresh=false

# Skip refresh during apply
terraform apply -refresh=false
```

Note: This workaround bypasses the bug but means Terraform won't detect external changes to your Gateway Target resources. Use with caution and ensure you manually verify resource state. See [Terraform docs on skipping state refresh](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/run/modes-and-options#skipping-automatic-state-refresh).

**Provider Version Compatibility:**
- v6.22.0 - v6.34.0: Recommended (full feature support)
- v6.35.0+: Broken (Gateway Target schema deserialization fails)

## Cleanup

To remove all provisioned resources:

```bash
terraform destroy
```

Terraform handles resource dependencies automatically and destroys in the correct order.

**Note:** All Cognito users and their data will be permanently deleted.

### Verify Cleanup

After destroy completes, verify no resources remain:
```bash
aws resourcegroupstaggingapi get-resources --tag-filters Key=stack,Values=<your-stack-name>
```

### Cost Note

Ensure `terraform destroy` completes successfully. Orphaned resources (especially AgentCore Runtime, DynamoDB, or API Gateway) may continue incurring charges.

## Contributing

When modifying the Terraform configuration, run `terraform fmt` and `terraform validate` before committing.
