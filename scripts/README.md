# Deployment Scripts

This directory contains scripts for deploying the Fullstack AgentCore Solution Template
infrastructure and frontend.

## Main Deployment Workflow

### 1. Deploy Infrastructure

```bash
cd infra-cdk
cdk deploy
```

This deploys the CDK stack. Configuration generation is handled during frontend deployment.

### 2. Deploy Frontend

```bash
# From root directory
python scripts/deploy-frontend.py
```

This script automatically:

- Generates fresh `aws-exports.json` from CDK stack outputs
- Installs/updates npm dependencies if needed
- Builds the frontend
- Deploys to AWS Amplify Hosting

## Individual Scripts

### Frontend Deployment

- `deploy-frontend.py` - Cross-platform frontend deployment script (works on Windows, Mac, Linux).
  Uses only Python standard library and AWS CLI. Handles dependency management and config generation.

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
---

### CodeBuild Deployment

- `deploy-with-codebuild.py` - Deploys the entire FAST stack (backend + frontend) using a CodeBuild project. No local Node.js, Docker, CDK, or npm required — only Python 3.11+, AWS CLI, and git.

```bash
python scripts/deploy-with-codebuild.py
```

Packages your git-tracked source and runs the full deployment in the cloud via a CodeBuild project, streaming logs to your terminal. On a **successful** build, all created resources (S3 source bucket, CodeBuild project, IAM role, permission boundary) are removed. On a **failed** build, they are retained for debugging and reused on the next run.

Only git-tracked or staged files are deployed — stage or commit first, as untracked files are skipped with a warning. This does not remove your deployed FAST stack; for that, run `cd infra-cdk && cdk destroy`.

The IAM role has `AdministratorAccess` constrained by a permission boundary that denies dangerous actions (`iam:CreateUser`, `iam:CreateAccessKey`, `organizations:*`, etc.) to prevent privilege escalation.

Your IAM user/role needs these permissions to run the script:

- `s3:CreateBucket`, `s3:DeleteBucket`, `s3:PutObject`, `s3:DeleteObject`, `s3:PutLifecycleConfiguration`
- `iam:CreateRole`, `iam:DeleteRole`, `iam:AttachRolePolicy`, `iam:DetachRolePolicy`
- `iam:CreatePolicy`, `iam:DeletePolicy`
- `codebuild:CreateProject`, `codebuild:DeleteProject`, `codebuild:StartBuild`, `codebuild:BatchGetBuilds`
- `logs:GetLogEvents`
- `sts:GetCallerIdentity`

---

## Requirements

- AWS CLI configured with appropriate permissions
- Python 3.11+ (standard library only, no pip install needed for deployment)
- Node.js and npm (for frontend build)
- CDK stack deployed with the required outputs:
  - `CognitoClientId`
  - `CognitoUserPoolId`
  - `AmplifyUrl`

## Key Features

- **Cross-Platform**: Works on Windows, Mac, and Linux
- **No Python Dependencies**: Uses only standard library (no virtual environment needed)
- **Automatic Region Detection**: Extracts region directly from CloudFormation stack ARN
- **Smart Dependency Management**: Automatically installs npm dependencies when needed
- **Fresh Config**: Always generates up-to-date configuration from current stack outputs

## New User Experience

For brand new installations, simply run:

```bash
cd infra-cdk
cdk deploy
cd ..
python scripts/deploy-frontend.py
```

The frontend deployment script will automatically handle:

1. Installing npm dependencies (if node_modules doesn't exist)
2. Generating fresh aws-exports.json from your deployed stack
3. Building and deploying the frontend

## Test Scripts

Test scripts have been moved to the `test-scripts/` directory. See [test-scripts/README.md](../test-scripts/README.md) for testing utilities and verification scripts.