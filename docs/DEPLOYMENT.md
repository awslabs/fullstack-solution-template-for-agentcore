# Deployment Guide

This guide walks you through deploying the Fullstack AgentCore Solution Template (FAST) to AWS.

## Prerequisites

Before deploying, ensure you have:

- **Node.js 20+** installed (see [AWS guide for installing Node.js on EC2](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-up-node-on-ec2-instance.html))
- **AWS CLI** configured with credentials (`aws configure`) - see [AWS CLI Configuration guide](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-quickstart.html)
- **AWS CDK CLI** installed: `npm install -g aws-cdk` (see [CDK Getting Started guide](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html))
- **Python 3.11 or above+** (standard library only - no virtual environment needed for deployment)
- **Docker** - Required for all deployments. See [Install Docker Engine](https://docs.docker.com/engine/install/). Verify with `docker ps`. Alternatively, [Finch](https://github.com/runfinch/finch) can be used on Mac. See below if you have a non-ARM machine.
- An AWS account with sufficient permissions to create:
  - S3 buckets
  - CloudFront distributions
  - Cognito User Pools
  - Amplify Hosting projects
  - Bedrock AgentCore resources
  - IAM roles and policies

## Configuration

### 1. Update Configuration File

Edit `infra-cdk/config.yaml` to customize your deployment:

```yaml
stack_name_base: your-project-name # Change this to your preferred stack name (max 35 chars)

admin_user_email: null # Optional: admin@example.com (auto-creates user & emails credentials)

backend:
  pattern: strands-single-agent # Available patterns: strands-single-agent, langgraph
  deployment_type: docker # Available deployment types: docker (default), zip
```

**Important**: 
- Change `stack_name_base` to a unique name for your project to avoid conflicts
- Maximum length is 35 characters (due to AWS AgentCore runtime naming constraints)

### Deployment Types

FAST supports two deployment types for AgentCore Runtime. Set `deployment_type` in `infra-cdk/config.yaml`:

| Type | Description |
|------|-------------|
| `docker` (default) | Builds container image, pushes to ECR |
| `zip` | Packages code via Lambda, uploads to S3 |

**Note**: Docker is required for both deployment types. The `zip` option only affects how the agent runtime is packaged. Other Lambda functions in the stack still use Docker for dependency bundling.

**Use Docker (default) when:**
- You need native C/C++ libraries without ARM64 wheels on PyPI
- Your deployment package exceeds 250 MB
- You need custom OS-level dependencies
- You want maximum compatibility

**Use ZIP when:**
- You want faster iteration during development
- Your dependencies are pure Python or have ARM64 wheels available
- You need higher session throughput

**ZIP packaging includes**: The `patterns/<your-pattern>/`, `gateway/`, and `tools/` directories are bundled together with dependencies from `requirements.txt`. This matches the `COPY` commands in the Docker deployment's Dockerfile.

## Deployment Steps

### TL;DR version
Here are the commands to deploy backend and frontend:
```bash
cd infra-cdk
npm install
cdk bootstrap # Once ever
cdk deploy
cd ..
python scripts/deploy-frontend.py
```

### Deploy Without Local Tooling (via CodeBuild)

If you don't have Node.js, Docker, or CDK installed locally, you can deploy entirely in the cloud using a temporary CodeBuild project. Requires only Python 3.8+ and AWS CLI:

```bash
python scripts/deploy-with-codebuild.py
```

See `scripts/README.md` for details and required IAM permissions.

### 1. Install Dependencies

Install infrastructure dependencies:

```bash
cd infra-cdk
npm install
```

**Note**: Frontend dependencies are automatically installed during deployment via Docker bundling, so no separate frontend `npm install` is required.

### 2. Bootstrap CDK (First Time Only)

If this is your first time using CDK in this AWS account/region:

```bash
cdk bootstrap
```

### 3. Deploy backend with CDK

Build and deploy the complete stack:

```bash
cdk deploy
```

The deployment will:

1. Create a Cognito User Pool for authentication
1. Build and push the agent container to ECR
1. Create the AgentCore runtime
1. Set up CloudFront distribution for the frontend

**Note**: The deployment takes approximately 5-10 minutes due to container building and AgentCore setup.

### 4. Deploy frontend

```bash
# From root directory
python scripts/deploy-frontend.py
```

This script automatically:

- Generates fresh `aws-exports.json` from CDK stack outputs (see below for more information about `aws-exports.json`)
- Installs/updates npm dependencies if needed
- Builds the frontend
- Deploys to AWS Amplify Hosting

You will see the URL for application in the script's output, which will look similar to this:

```
ℹ App URL: https://main.d123abc456def7.amplifyapp.com
```

### 5. Create a Cognito User (if necessary)

**If you provided `admin_user_email` in config:**

- Check your email for temporary password
- Sign in and change password on first login

**If you didn't provide email:**

1. Go to the [AWS Cognito Console](https://console.aws.amazon.com/cognito/)
2. Find your User Pool (named `{stack_name_base}-user-pool`)
3. Click on the User Pool
4. Go to "Users" tab
5. Click "Create user"
6. Fill in the user details:
   - **Email**: Your email address
   - **Temporary password**: Create a temporary password
   - **Mark email as verified**: Check this box
7. Click "Create user"

### 6. Access the Application

1. Open the Amplify Hosting URL in your browser
1. Sign in with the Cognito user you created
1. You'll be prompted to change your temporary password on first login

## Post-Deployment

### Updating the Application

To update the frontend code:

```bash
# From root directory
python scripts/deploy-frontend.py
```

To update the backend agent:

**Docker deployment:**
```bash
cd infra-cdk
cdk deploy --all
```

### Monitoring and Logs

- **Frontend logs**: Check CloudFront access logs
- **Backend logs**: Check CloudWatch logs for the AgentCore runtime
- **Build logs**: Check CodeBuild project logs for container builds

## Cleanup

To remove all resources:

```bash
cd infra-cdk
cdk destroy --force
```

**Warning**: This will delete all data including S3 buckets created during deployment and ECR images.

## Troubleshooting

### Common Issues

1. **`cdk deploy` fails with Docker errors**

   - Ensure Docker is installed and the daemon is running: `docker ps`
   - On Mac, open Docker Desktop or start Finch: `finch vm start`
   - On Linux: `sudo systemctl start docker`

2. **"Architecture incompatible" or "exec format error" during Docker build**

   - This occurs when deploying from a non-ARM machine without cross-platform build setup
   - Follow the "Docker Cross-Platform Build Setup" instructions in the Prerequisites section
   - Ensure you've installed QEMU emulation: `docker run --privileged --rm tonistiigi/binfmt --install all`
   - Verify ARM64 support: `docker buildx ls` should show `linux/arm64` in platforms

3. **"Agent Runtime ARN not configured"**

   - Ensure the backend stack deployed successfully
   - Check that SSM parameters were created correctly

4. **Authentication errors**

   - Verify you created a Cognito user
   - Check that the user's email is verified

4. **Build failures**

   - Check CodeBuild logs in the AWS Console
   - Ensure your agent code in `patterns/` is valid

5. **Permission errors**
   - Verify your AWS credentials have sufficient permissions
   - Check IAM roles created by the stack

### Getting Help

- Check CloudWatch logs for detailed error messages
- Review the CDK deployment output for any warnings
- Ensure all prerequisites are met

## Security Considerations

- The Cognito User Pool is configured with strong password policies
- All communication uses HTTPS via CloudFront
- AgentCore runtime uses JWT authentication
- IAM roles follow least-privilege principles

For production deployments, consider:

- Enabling MFA on Cognito users
- Setting up custom domains with your own certificates
- Configuring additional monitoring and alerting
- Implementing backup strategies for any persistent data


## Docker Cross-Platform Build Setup (Required for non-ARM machines)

**Important**: BedrockAgentCore Runtime only supports ARM64 architecture. If you're deploying from a non-ARM machine (x86_64/amd64), you need to enable Docker's cross-platform building capabilities.

Check your machine architecture:
```bash
uname -m
```

If the output is `x86_64` (not `aarch64` or `arm64`), run these commands:

1. **Install QEMU for ARM64 emulation:**
   ```bash
   docker run --privileged --rm tonistiigi/binfmt --install all
   ```

2. **Enable Docker buildx and create a multi-platform builder:**
   ```bash
   docker buildx create --use --name multiarch --driver docker-container
   docker buildx inspect --bootstrap
   ```

3. **Verify ARM64 support is available:**
   ```bash
   docker buildx ls
   ```
   You should see `linux/arm64` in the platforms list.

**Note**: This setup is only required once per machine. The CDK deployment will automatically use these capabilities to build ARM64 containers.


## Understanding aws-exports.json

The `aws-exports.json` file is a critical configuration file that enables the React frontend to communicate with AWS Cognito for authentication. This file is automatically generated during frontend deployment and contains the necessary configuration parameters for Cognito authentication.

**What is aws-exports.json?**

The `aws-exports.json` file contains authentication configuration that the React application reads to properly configure Cognito Authentication. It's created automatically by the deployment script and placed in `frontend/public/aws-exports.json`.

**Why is it necessary?**

This configuration file is essential because:

- It provides the React application with the correct Cognito User Pool and Client IDs
- It specifies the authentication endpoints and redirect URIs
- It configures the authentication flow parameters
- Without this file, Cognito authentication will not work

**How is it created?**

The file is automatically generated by `deploy-frontend.py` which:

1. Extracts configuration from your deployed CDK stack outputs
2. Automatically detects the AWS region from the CloudFormation stack ARN
3. Retrieves the required values: `CognitoClientId`, `CognitoUserPoolId`, and `AmplifyUrl`
4. Generates the configuration file with the following structure:

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

**Important**: You should not manually edit this file as it's regenerated on each deployment. If authentication isn't working, redeploy the frontend to ensure you have the latest configuration.
