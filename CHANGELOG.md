# Changelog

All notable changes to the GenAIID AgentCore Starter Pack (GASP) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Typo fix in top level GASP stack description
- Updated version references from 0.0.1 to 0.1.0 in infra-cdk/package.json
- Removed unused imports

### Security
- Enhanced error handling for Secrets Manager operations
- Implemented comprehensive security controls across infrastructure
- Added proper access logging and monitoring

## [0.1.0] - 2025-11-13

### Added
- Initial release of GenAIID AgentCore Starter Pack
- Full-stack React frontend with Next.js, TypeScript, and Tailwind CSS
- AgentCore backend integration with multiple agent providers
- AWS Cognito authentication with JWT support
- CDK infrastructure deployment
- Strands and LangGraph agent pattern support
- Gateway integration with tool support
- Memory integration capabilities
- Streaming support
- Comprehensive documentation and deployment guides
