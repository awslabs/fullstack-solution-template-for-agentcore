# Changelog

All notable changes to the Fullstack AgentCore Solution Template (FAST) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Updated architecture diagram with latest logos (`docs/architecture-diagram/FAST-architecture-20260403.png`)

## [0.4.1] - 2026-03-25

### Added

- AG-UI agent patterns for both Strands and LangGraph (`patterns/agui-strands-agent/`, `patterns/agui-langgraph-agent/`) with tool support (Gateway, Code Interpreter)
- AG-UI streaming parser in frontend (`frontend/src/lib/agentcore-client/parsers/agui.ts`)
- AG-UI integration documentation (`docs/AGUI_INTEGRATION.md`)
- AgentCore Evaluations integration guide (`docs/AGENTCORE_EVALUATIONS_GUIDE.md`)
- X-Ray VPC endpoint to private VPC deployment documentation

### Changed

- Restructured existing Strands and LangGraph agent patterns with modular `tools/` directories for Gateway and Code Interpreter
- Simplified `basic_agent.py` and `langgraph_agent.py` by extracting tool definitions into separate modules
- Updated OpenTelemetry distro version across all agent pattern Dockerfiles

### Fixed

- API Gateway cache encryption at rest enabled in both CDK and Terraform
- ASH PR comment artifact consolidation and dependabot auto-merge workflow trigger
- Security scanner false positive suppressions (nosemgrep/nosec) for CDK path operations, JWT decode, and zip-packager urlopen
- Added USER directive to `Dockerfile.frontend.dev` (CKV_DOCKER_3)

### Security

- Updated `tj-actions/changed-files` to v47.0.5 (CVE fix for GHSA-mrrh-fwg8-r2c3 and GHSA-mcph-m25j-8j63)
- Bumped `fast-xml-parser` and `@aws-sdk/xml-builder` in frontend
- Bumped `flatted` from 3.3.3 to 3.4.2 in frontend
- Bumped `langgraph` in patterns/langgraph-single-agent

## [0.4.0] - 2026-03-12

### Added

- Claude Agent SDK agent pattern (`patterns/claude-agent-sdk/`) with single-agent and multi-agent variants
- AgentCore client library (`frontend/src/lib/agentcore-client/`) with SSE streaming and parsers for Strands, LangGraph, and Bedrock Converse agents
- Inline tool call rendering with message segments approach in the frontend
- Markdown rendering with syntax highlighting and copy button for chat messages
- Tool renderer registry and default `ToolCallDisplay` component for extensible tool output rendering
- Streaming documentation update (`docs/STREAMING.md`) with new parser architecture and event flow
- Local Docker testing for AgentCore with Docker Compose support (`docker/`)
- GitHub repo-stats workflow for daily traffic tracking
- ASH (Automated Security Helper) scan workflows for PR and full repository scanning
- Dependabot auto-merge and PR labeler GitHub Actions workflows
- JS/TS and Python linting workflows for pull requests
- Prettier configuration and formatting for frontend source files
- Prettier added to Makefile lint pipeline and frontend dev dependencies
- READMEs for strands, langgraph, and claude-agent-sdk agent patterns
- Permission boundary for CodeBuild temporary IAM role
- VPC deployment mode (`network_mode: VPC`) for deploying AgentCore Runtime into an existing user-provided VPC for private network isolation
- VPC configuration in `config.yaml` with `vpc_id`, `subnet_ids`, and optional `security_group_ids`
- VPC configuration validation in `ConfigManager` for required fields when VPC mode is enabled
- `buildNetworkConfiguration()` method in backend stack to import existing VPC, subnets, and security groups
- VPC deployment documentation in `docs/DEPLOYMENT.md` including required VPC endpoints, subnet requirements, and traffic flow explanation
- CodeBuild-based deployment script (`scripts/deploy-with-codebuild.py`) that enables deploying FAST without requiring Docker
- [Terraform] Full Terraform infrastructure alternative to CDK (`infra-terraform/`) with modules for Amplify Hosting, Cognito, and Backend (Runtime, Gateway, Memory, Feedback API, SSM)
- [Terraform] Support for both Docker and Zip deployment types via `deployment_type` variable
- [Terraform] OAuth2 Credential Provider support
- [Terraform] VPC deployment mode with input/output parity to CDK
- [Terraform] Dedicated scripts for frontend deployment (`deploy-frontend.py`, `deploy-frontend.sh`), Docker image build (`build-and-push-image.sh`), and agent testing (`test-agent.py`)
- [Terraform] S3 backend configuration example (`backend.tf.example`) for remote state management
- [Terraform] Version bump playbook (`TF_VERSION_BUMP_PLAYBOOK.md`) with independent versioning scheme
- OAuth2 Credential Provider Lambda handler (`infra-cdk/lambdas/oauth2-provider/index.py`) for lifecycle management with Create, Update, and Delete support
- AgentCore Identity OAuth2 integration via `@requires_access_token` decorator in agent patterns
- Token refresh helpers (`_fetch_gateway_token`) in both Strands and LangGraph agents for fresh token retrieval
- Decorator comment explaining OAuth2 Credential Provider and Token Vault caching behavior
- Runtime environment variable `GATEWAY_CREDENTIAL_PROVIDER_NAME` for OAuth2 provider lookup
- OAuth2 Credential Provider and Token Vault IAM permissions to agent runtime role
- Scoped Secrets Manager IAM permissions to agent runtime role for OAuth2 secrets
- `docs/RUNTIME_GATEWAY_AUTH.md` - Comprehensive documentation of the M2M authentication workflow between AgentCore Runtime and Gateway, covering both deployment (OAuth2 provider registration) and runtime (token retrieval and validation) phases
- Updated architecture diagram (`docs/architecture-diagram/FAST-architecture-20260302.png`) illustrating OAuth2 M2M authentication flow with Token Vault and OAuth2 Credential Provider

### Changed

- Removed `userId` from client invocation — user identity now extracted server-side from JWT to prevent impersonation via prompt injection
- Split claude-agent-sdk into single-agent and multi-agent pattern variants
- Frontend switched from `access_token` to `id_token` for AgentCore authentication (`access_token` lacks required `aud` claim)
- Removed old JS service files, replaced by new `agentcore-client` library
- Migrated Gateway authentication to AgentCore SDK `@requires_access_token` decorator
- Simplified agent code in `patterns/strands-single-agent/basic_agent.py` and `patterns/langgraph-single-agent/langgraph_agent.py`
- Use `cr.Provider` pattern for OAuth2 provider to avoid IAM propagation delays
- Implemented scoped IAM permissions for OAuth2 provider, Token Vault, and Secrets Manager
- Updated OAuth2 Custom Resource to pass secret ARN for enhanced security (secret retrieved at Lambda runtime)
- Modified agent token handling to fetch fresh tokens on reconnection (Strands) and per-request (LangGraph)
- Moved Secrets Manager permissions from base `AgentCoreRole` utility class to backend-stack.ts for better separation of concerns
- Updated `README.md` to reference new architecture diagram and clarify OAuth2 M2M authentication flow descriptions
- Updated `test-scripts/README.md` to remove Docker container testing documentation
- Updated contributing docs to use `main` branch instead of `develop`

### Removed

- Docker container testing script (`test-scripts/test-agent-docker.py`)
- Docker testing documentation (`docs/LOCAL_DOCKER_TESTING.md`)
- Manual OAuth2 functions from `patterns/utils/auth.py` (`get_gateway_access_token()`, `get_secret()`)
- Manual token fetching logic from agent code
- Direct Secrets Manager access from agents
- Wildcard Secrets Manager IAM permissions from base `AgentCoreRole` utility class
- Old JS service files (replaced by `agentcore-client` library)

### Fixed

- LangGraph plain string content handling in `AIMessageChunk`
- Test-agent `user_id` bug, added streaming parser and dynamic tool name lookup to test scripts
- Frontend build issues: unused `sessionId` param and excluded test directory from `tsc`
- Repo-stats workflow failing on forks
- Real VPC/subnet IDs replaced with placeholders in `config.yaml`
- Backend agent entrypoints
- Docker Compose v2 syntax and outdated `userId` references in docs
- JWT auth compatibility, Vite host binding, and credential docs
- Stale token errors in agents by implementing fresh token retrieval on MCP Gateway reconnection (Strands) and per-request (LangGraph)
- IAM permission scoping to prevent overly broad wildcard access
- Removed `iam:PutRolePolicy` from CodeBuild permission boundary, added `cdk bootstrap`, fixed region detection
- Resolved all ESLint warnings in frontend
- CI: pinned `tj-actions/changed-files` to SHA and bumped Node to 20

### Security

- Enhanced security by delegating OAuth2 token management to AgentCore Identity service
- Improved token lifecycle management with automatic refresh and error handling via Token Vault
- Bumped `hono` from 4.11.9 to 4.12.7 in frontend
- Bumped `@hono/node-server` in frontend
- Bumped `rollup` from 4.56.0 to 4.59.0 in frontend
- Bumped `minimatch` in frontend and `aws-cdk-lib` in infra-cdk
- Bumped `fast-xml-parser` and `@aws-sdk/xml-builder` in frontend and infra-cdk
- Bumped `qs` from 6.14.1 to 6.14.2 in frontend
- Bumped `langgraph` in patterns/langgraph-single-agent
- Bumped `@aws-sdk/client-bedrock-agentcore` in infra-cdk

## [0.3.1] - 2026-02-11

### Added

- Vite as build tool with optimized development server and production builds
- React Router (react-router-dom v6) for client-side routing
- Frontend test suite with unit tests and property-based tests using Vitest
- New application entry points: `main.tsx`, `App.tsx`, and route components
- Vite configuration with code splitting and optimized chunk strategy
- TypeScript configuration optimized for Vite bundler
- Environment variable type definitions for Vite (`vite-env.d.ts`)
- Minimal IAM policy for CDK deployment

### Changed

- Migrated frontend from Next.js 16 (App Router) to Vite + React + React Router stack
- Replaced Next.js build system with Vite for faster builds and simpler configuration
- Updated environment variable prefix from `NEXT_PUBLIC_*` to `VITE_*`
- Migrated environment variable access from `process.env` to `import.meta.env`
- Restructured application entry points from Next.js layout/page pattern to explicit React rendering
- Moved global styles from `app/globals.css` to `src/styles/globals.css`
- Updated npm scripts: `dev` now runs Vite, `build` runs TypeScript check + Vite build
- Updated ESLint configuration to remove Next.js-specific rules
- Updated frontend README with Vite-specific instructions and development workflow

### Security

- Bumped `vite` from 5.4.21 to 7.3.1
- Bumped `fast-xml-parser` and `aws-amplify` in frontend
- Bumped `@modelcontextprotocol/sdk` from 1.25.1 to 1.26.0
- Bumped `hono` from 4.11.3 to 4.11.7
- Bumped `lodash` from 4.17.21 to 4.17.23
- Bumped `@smithy/config-resolver` and `aws-amplify` in frontend

### Removed

- Next.js framework and dependencies (`next`, `eslint-config-next`)
- Next.js configuration file (`next.config.ts`)
- Next.js App Router file structure (`app/layout.tsx`, `app/page.tsx`)
- Next.js-specific build artifacts and references

## [0.3.0] - 2026-01-15

### Changed

- Open source release

## [0.2.1] - 2026-01-09

### Added

- Zip deployment type for AgentCore runtime
- MkDocs documentation system with automated builds
- Enhanced CI/CD security scanning configuration

### Changed

- Updated LangGraph version to address security vulnerability
- Upgraded to Cognito's new managed login UI
- Improved documentation structure and navigation
- Updated frontend dependencies to latest versions

### Fixed

- CloudWatch Logs permissions for AgentCore runtime
- Security scan execution to run on all branches
- Documentation links and structure issues
- CI/CD pipeline configuration for proper security scanning

## [0.2.0] - 2025-12-21

### Changed

- Updated GitLab references to GitHub for open source release
- Updated internal AWS references to generic paths
- Upgraded Python version requirement from 3.8 to 3.11
- Replaced bash frontend deployment script with cross-platform Python script
- Improved deployment documentation with clearer prerequisites

### Fixed

- API Gateway CloudWatch logs role creation issue
- Enhanced error handling in frontend deployment script
- Added explicit AWS credentials validation before deployment

### Added

- CONTRIBUTORS.md file listing project contributors
- Docker runtime requirement clarification in deployment docs

## [0.1.3] - 2025-12-11

### Changed

- Renamed project from "GenAIID AgentCore Starter Pack (GASP)" to "Fullstack AgentCore Solution Template (FAST)"
- Updated all documentation, code comments, and configuration files to use new naming
- Updated repository URLs and package names to reflect new branding
- Improved configuration management to require explicit config.yaml file

### Fixed

- Fixed Cognito domain prefix to use lowercase for compatibility
- Removed hardcoded default values in configuration manager

## [0.1.2] - 2025-12-05

### Added

- AgentCore Code Interpreter direct integration with comprehensive documentation
- Reusable Code Interpreter tools for cross-pattern compatibility
- Updated architecture diagrams to include Code Interpreter integration

### Changed

- Restructured Code Interpreter implementation for better reusability across agent patterns
- Streamlined documentation and updated README for improved clarity
- Removed unused description parameter from execute_python function

### Security

- **CRITICAL**: Updated React to 19.2.1 and Next.js to 16.0.7 to address CVE-2025-55182 (CVSS 10.0)
- Fixed React Server Components remote code execution vulnerability

### Fixed

- AgentCore Code Interpreter deployment issues
- Linting issues in Code Interpreter files
- Various code review feedback items

## [0.1.1] - 2025-11-26

### Added

- Comprehensive security enhancements for backend infrastructure
- SSL/TLS enforcement for S3 staging bucket requests
- S3 access logging for staging bucket
- Comprehensive CloudWatch logging for API Gateway
- Error handling for Secrets Manager operations in test scripts

### Changed

- Migrated from custom resource to CDK L1 constructs for Gateway
- Switched machine client secret storage from SSM to Secrets Manager
- Improved Dockerfile healthcheck and build caching
- Restricted Secrets Manager IAM permissions to specific secrets

### Fixed

- Typo fix in top level FAST stack description
- Updated version references from 0.0.1 to 0.1.0 in infra-cdk/package.json
- Removed unused imports

### Security

- Enhanced error handling for Secrets Manager operations
- Implemented comprehensive security controls across infrastructure
- Added proper access logging and monitoring

## [0.1.0] - 2025-11-13

### Added

- Initial release of Fullstack AgentCore Solution Template
- Full-stack React frontend with Next.js, TypeScript, and Tailwind CSS
- AgentCore backend integration with multiple agent providers
- AWS Cognito authentication with JWT support
- CDK infrastructure deployment
- Strands and LangGraph agent pattern support
- Gateway integration with tool support
- Memory integration capabilities
- Streaming support
- Comprehensive documentation and deployment guides
