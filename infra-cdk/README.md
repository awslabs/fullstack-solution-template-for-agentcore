# Fullstack AgentCore Solution Template - Infrastructure

This directory contains the AWS CDK infrastructure code for deploying the Fullstack AgentCore Solution Template.

## Prerequisites

- Node.js 18+
- AWS CLI configured with appropriate credentials
- AWS CDK CLI installed: `npm install -g aws-cdk`

## Minimal IAM Policy for Deployment

The file `minimal-deploy-policy.json` contains the minimum IAM permissions required to deploy this CDK application. This policy includes 30 actions across 7 statements covering CloudFormation, S3, SSM, ECR, IAM PassRole, and Amplify.

**Important:** This policy assumes CDK bootstrap has already been run in the target account. It does not include permissions for `cdk bootstrap`. To bootstrap a fresh account, you'll need additional IAM permissions (CreateRole, AttachRolePolicy, PutRolePolicy, etc.) - refer to the AWS CDK Bootstrap documentation for details.

**Security Note:** Some wildcards are present for resources (e.g., `arn:aws:cloudformation:*:*:stack/*`). For production environments, replace these with your specific resource ARNs to further scope down permissions.

## Getting Started

All of the following commands assuming you are in the top of the `infra-cdk/` directory
### Install Dependencies

```bash
npm install
```

### Build TypeScript

```bash
npm run build
```

### Bootstrap CDK (First Time Only)

```bash
npx cdk bootstrap
```

### Deploy

```bash
npx cdk deploy --all
```

## Useful Commands

* `npm run build`   - Compile TypeScript to JavaScript
* `npm run watch`   - Watch for changes and compile automatically
* `npm run test`    - Run Jest unit tests
* `npx cdk deploy --all` - Deploy all stacks to your AWS account/region
* `npx cdk diff`    - Compare deployed stack with current state
* `npx cdk synth`   - Emit the synthesized CloudFormation template
* `npx cdk destroy --all` - Remove all deployed resources

## Configuration

Edit `config.yaml` to customize your deployment:

```yaml
stack_name_base: "fullstack-agentcore-solution-template"

frontend:
  domain_name: null  # Optional: Set to your custom domain
  certificate_arn: null  # Optional: Set to your ACM certificate ARN

backend:
  pattern: strands-single-agent  # Available: strands-single-agent, langgraph-single-agent
  deployment_type: docker  # Available: docker, zip
  agent_name: StrandsAgent
  network_mode: PUBLIC  # Available: PUBLIC, PRIVATE
  memory_expiration_days: 30  # How long AgentCore Memory retains conversation history
```

## Project Structure

```
infra-cdk/
├── bin/
│   └── fast-cdk.ts          # CDK app entry point
├── lib/
│   ├── fast-main-stack.ts   # Main orchestrator stack
│   ├── backend-stack.ts     # BackendConstruct
│   ├── cognito-stack.ts     # CognitoConstruct
│   ├── amplify-hosting-stack.ts  # AmplifyHostingConstruct
│   └── utils/               # Utility functions and constructs
├── test/
│   └── fast-cdk.test.ts     # Unit tests
├── cdk.json                 # CDK configuration
├── config.yaml              # Application configuration
├── package.json
└── tsconfig.json
```

## Development Workflow

1. Make changes to TypeScript files in `lib/`
2. Run `npm run build` to compile
3. Run `npx cdk diff` to see what will change
4. Run `npx cdk deploy --all` to deploy changes

For faster iteration, use watch mode:
```bash
npm run watch
```

## Deployment Details

The CDK deployment creates a single CloudFormation stack containing all resources, organized into logical Constructs.

### Architecture

The main stack (`FASTStack`) composes three Constructs:

1. **CognitoConstruct**: User authentication
   - Cognito User Pool and Client
   - User Pool Domain for hosted UI
   - Machine Client for service-to-service auth

2. **BackendConstruct**: AgentCore infrastructure
   - AgentCore Gateway with Lambda tool targets
   - AgentCore Runtime for agent execution
   - AgentCore Memory for conversation history
   - ECR repository and CodeBuild for container builds
   - DynamoDB table for feedback
   - API Gateway for feedback endpoints

3. **AmplifyHostingConstruct**: Frontend hosting
   - Amplify app for React frontend
   - Branch configuration for deployments
   - Custom domain setup (if configured)

### Docker Build Configuration

The agent container builds use a specific configuration to handle the repository structure efficiently:

#### Build Context Strategy

**Problem**: Agent patterns need access to the shared `gateway/` utilities package, but Docker build contexts cannot access parent directories using `../` paths.

**Solution**: Use repository root as build context with optimized file filtering:

1. **Build Context**: Repository root (`/path/to/fullstack-agentcore-solution-template/`)
2. **Dockerfile Location**: `patterns/{pattern}/Dockerfile` 
3. **Package Installation**: Install FAST package (`gateway/` + `pyproject.toml`) as proper Python package
4. **File Filtering**: `.dockerignore` excludes large directories to prevent build hangs

#### Docker Context Optimization

**Issue**: Large build contexts (including `node_modules/`, `.git/`, etc.) cause Docker builds to hang during the "transferring context" phase, especially in CDK deployments.

**Solution**: `.dockerignore` file at repository root excludes:
- `node_modules/` directories (frontend and infra)
- `.git/` version control data  
- Build artifacts (`cdk.out/`, `.next/`, `dist/`)
- Cache directories (`.ruff_cache/`, `__pycache__/`)

**Result**: Build context reduced from ~100MB+ to ~10MB, eliminating hang issues.

#### Package-Based Architecture

Instead of copying files with relative paths, the Dockerfile:

1. **Installs FAST package**: `RUN pip install --no-cache-dir -e .`
   - Makes `gateway` utilities available as `from gateway.utils.*`
   - Eliminates need for file copying between directories
   - Works consistently across all agent patterns

2. **Copies only agent code**: `COPY patterns/strands-single-agent/basic_agent.py .`
   - Minimal file copying for the specific agent
   - Clean separation between shared utilities and agent logic

3. **Removes problematic requirements**: Cleaned `requirements.txt` to avoid duplicate FAST installation

This approach scales to multiple agent patterns without code duplication while maintaining clean Docker builds.

### Key Resources Created

- **Authentication**: Cognito User Pool, Client, Domain, Machine Client
- **AgentCore**: Gateway, Runtime, Memory
- **Compute**: Lambda functions, ECR repository, CodeBuild project
- **Storage**: DynamoDB tables
- **Frontend**: Amplify app with custom domain support
- **APIs**: API Gateway for feedback endpoints
- **Security**: IAM roles and policies

## Troubleshooting

### Build Errors

If you encounter TypeScript compilation errors:
```bash
npm run build
```

### Deployment Failures

Check CloudFormation events in the AWS Console for detailed error messages.

### Clean Build

If you need to start fresh:
```bash
rm -rf node_modules cdk.out
npm install
npm run build
```

## Testing

Run unit tests:
```bash
npm test
```

## Learn More

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS CDK TypeScript Reference](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-construct-library.html)
- [Bedrock AgentCore Documentation](https://docs.aws.amazon.com/bedrock/)
