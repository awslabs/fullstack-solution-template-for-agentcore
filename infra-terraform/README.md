# Terraform Infrastructure for Fullstack AgentCore Solution Template

This directory contains Terraform configurations for deploying the Fullstack AgentCore Solution Template (FAST).

> **Note:** All commands and scripts in this README run from the `infra-terraform/` directory. This folder is self-contained and independent from the CDK deployment (`infra-cdk/`).

## Architecture

The infrastructure deploys the following AWS resources:

1. **Amplify Hosting** - Frontend React/Next.js application hosting
2. **Cognito** - User authentication with User Pool, Web Client, and Machine Client (M2M)
3. **AgentCore Memory** - Persistent memory for AI agent conversations
4. **AgentCore Gateway** - MCP gateway with Lambda tool targets
5. **AgentCore Runtime** - Containerized agent runtime with ECR repository
6. **Feedback API** - API Gateway + Lambda + DynamoDB for user feedback

## Prerequisites

1. **Terraform** >= 1.5.0
2. **AWS CLI** configured with appropriate credentials
3. **Docker** (for building agent container images)

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

# Deploy infrastructure (Step 1 of 3)
terraform apply

# Build and push Docker image (Step 2 of 3)
./scripts/build-and-push-image.sh

# Deploy AgentCore Runtime (Step 3 of 3)
terraform apply
```

## Deployment Workflow

Terraform requires a **3-step deployment process** because the AgentCore Runtime needs the Docker image to exist in ECR before it can be created.

> **Why 3 steps instead of a single command?** The Docker image build is kept separate to provide better error handling, faster iteration during development, and CI/CD flexibility. While Terraform's `local-exec` provisioner could consolidate this, it adds complexity and makes build failures harder to diagnose.

### Step 1: Create Infrastructure (ECR, Cognito, Memory, Gateway, etc.)

**Optional:** Validate and preview changes:
```bash
terraform fmt       # Format .tf files
terraform validate  # Check configuration syntax
terraform plan      # Preview what will be created
```

Deploy:
```bash
terraform apply
```
This creates all resources **except** the AgentCore Runtime.

### Step 2: Build and Push Docker Image
```bash
./scripts/build-and-push-image.sh
```
This script:
- Reads configuration from `terraform.tfvars`
- Logs into ECR
- Builds the agent Docker image with ARM64 architecture (required by AgentCore)
- Pushes to ECR

**Options:**
```bash
./scripts/build-and-push-image.sh -h                          # Show help
./scripts/build-and-push-image.sh -p langgraph-single-agent   # Use LangGraph pattern
./scripts/build-and-push-image.sh -s my-stack -r us-west-2    # Override stack/region
```

### Step 3: Create AgentCore Runtime
```bash
terraform apply
```
Now that the image exists in ECR, Terraform creates the AgentCore Runtime.

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
├── scripts/                   # Terraform deployment scripts (not project root scripts/)
│   ├── build-and-push-image.sh   # Build and push Docker image to ECR
│   ├── deploy-frontend.py        # Deploy frontend (Python, cross-platform)
│   ├── deploy-frontend.sh        # Deploy frontend (Shell, macOS/Linux)
│   └── test-agent.py             # Test deployed agent
├── lambdas/                   # Lambda source code
│   ├── feedback/              # Feedback API Lambda
│   └── gateway-tools/         # Gateway tool Lambda
└── modules/
    ├── amplify-hosting/       # S3 staging buckets and Amplify app
    ├── cognito/               # User Pool, clients, and authentication
    ├── agentcore-memory/      # Memory resource for agent conversations
    ├── agentcore-gateway/     # Gateway with Lambda tool targets
    ├── agentcore-runtime/     # ECR repository and agent runtime
    └── feedback-api/          # API Gateway, Lambda, and DynamoDB
```

## Deployment Order

The modules are deployed in this order:

1. **Amplify Hosting** - First, to get predictable app URL
2. **Cognito** - Uses Amplify URL for OAuth callback URLs
3. **AgentCore Memory** - Independent, can deploy in parallel
4. **AgentCore Gateway** - Depends on Cognito for JWT authentication
5. **AgentCore Runtime** - Depends on Cognito and Memory
6. **Feedback API** - Depends on Cognito and Amplify URL for CORS

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
| `ecr_repository_url` | ECR repository for agent container |
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
