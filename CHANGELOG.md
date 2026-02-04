# Changelog

All notable changes to the Fullstack AgentCore Solution Template (FAST) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-02-02

### Added
- Vite as build tool with optimized development server and production builds
- React Router (react-router-dom v6) for client-side routing
- Comprehensive test suite with unit tests and property-based tests using Vitest
- New application entry points: `main.tsx`, `App.tsx`, and route components
- Vite configuration with code splitting and optimized chunk strategy
- TypeScript configuration optimized for Vite bundler
- Environment variable type definitions for Vite (`vite-env.d.ts`)

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
