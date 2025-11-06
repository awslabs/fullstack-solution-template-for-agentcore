# Deployment and Test Scripts

This directory contains scripts for deploying and testing the GenAIIC AgentCore Starter Pack
infrastructure and frontend.

## Main Deployment Workflow

### 1. Deploy Infrastructure

```bash
cd infra-cdk
cdk deploy
```

This deploys the CDK stack. Configuration generation is now handled during frontend deployment.

### 2. Deploy Frontend

```bash
# From root directory
./scripts/deploy-frontend.sh
```

This script automatically:

- Generates fresh `aws-exports.json` from CDK stack outputs
- Installs/updates npm dependencies if needed
- Builds the Next.js frontend
- Deploys to AWS Amplify Hosting

## Individual Scripts

### Frontend Deployment

- `deploy-frontend.sh` - Complete frontend deployment with automatic dependency management and
  config generation. Calls the `post-deploy.py` script below automatically, and will run `npm`
  commands as needed.

### Configuration Generation

_(You will not need to run this manually)_

- `post-deploy.py` - Generates `aws-exports.json` from stack outputs

The script creates `frontend/public/aws-exports.json` with the following structure. This information
is read by the React application to configure Cognito Authentication. If any of this is incorrect,
Cognito will not work. It's generated automatically from the scripts, and you should not need to
change anything:

```json
{
  "authority": "https://cognito-idp.region.amazonaws.com/user-pool-id",
  "client_id": "your-client-id",
  "redirect_uri": "https://your-amplify-url",
  "post_logout_redirect_uri": "https://your-amplify-url",
  "response_type": "code",
  "scope": "email openid profile",
  "automaticSilentRenew": true
}
```

## Requirements

- AWS CLI configured with appropriate permissions
- Python 3 (for post-deploy.py)
- Node.js and npm (for frontend build)
- CDK stack deployed with the required outputs:
  - `CognitoClientId`
  - `CognitoUserPoolId`
  - `AmplifyUrl`

## Key Features

- **Automatic Region Detection**: Extracts region directly from CloudFormation stack ARN
- **Smart Dependency Management**: Automatically installs npm dependencies when needed
- **No Custom Resources**: Avoids CDK custom resource deployment issues
- **Local Generation**: Fast and reliable configuration generation
- **Easy Debugging**: Clear error messages and logging
- **Fresh Config**: Always generates up-to-date configuration from current stack outputs

## New User Experience

For brand new installations, simply run:

```bash
cd infra-cdk
cdk deploy
cd ..
./scripts/deploy-frontend.sh
```

The frontend deployment script will automatically handle:

1. Installing npm dependencies (if node_modules doesn't exist)
2. Generating fresh aws-exports.json from your deployed stack
3. Building and deploying the frontend

# Test Scripts

Utility scripts for deployment verification and operational tasks.

## Setup

```bash
# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Create virtual environment
uv venv

# Install dependencies
uv pip install -r requirements.txt
```

## Available Scripts

### test-agent-invocation.py

Interactive chat interface for testing agent invocations with conversation continuity.

**Modes:**

- **Remote** (default): Test deployed agent via Cognito authentication
- **Local** (`--local`): Test agent running on localhost:8080

**Usage:**

```bash
# Remote mode (prompts for credentials)
uv run python scripts/test-agent-invocation.py

# Local mode (auto-starts agent if not running)
uv run python scripts/test-agent-invocation.py --local
```

**Prerequisites:**

- Remote: Deployed stack with Cognito user
- Local: Memory ID from deployed stack

---

### test-memory.py

Tests AgentCore Memory operations (create, list, get events and pagination).

**Usage:**

```bash
# Auto-discover memory from stack
uv run python scripts/test-memory.py

# Use specific memory ARN
uv run python scripts/test-memory.py --memory-arn <arn>
```

**Tests:**

1. Create conversation events
2. List events with pagination
3. Get specific events by ID
4. Session ID validation
5. Error handling

---

### test-feedback-api.py

Tests the deployed Feedback API endpoint with Cognito authentication.

**Prerequisites:**

- Stack deployed to AWS
- Cognito user created (see [Deployment Guide](../docs/DEPLOYMENT.md))

**Usage:**

```bash
uv run python scripts/test-feedback-api.py
```

**What it does:**

1. Fetches configuration from SSM Parameter Store
2. Authenticates with Cognito (prompts for credentials)
3. Runs API tests (positive/negative feedback, validation)
4. Displays test results

---

## Shared Utilities

`test_utils.py` provides common functions:

- Stack configuration and SSM parameter retrieval
- Cognito authentication
- AWS client creation
- Session ID generation

## Troubleshooting

- **Authentication fails**: Verify Cognito user exists and credentials are correct
- **Stack not found**: Ensure stack is deployed and `config.yaml` has correct `stack_name_base`
- **Local agent fails**: Check Memory ID and AWS credentials are configured
- **Port 8080 in use**: Stop other services or use remote mode
