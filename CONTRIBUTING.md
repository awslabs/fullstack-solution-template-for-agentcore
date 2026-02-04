Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0

# Contributing to the Fullstack AgentCore Solution Template (FAST)

Thank you for your interest in contributing to the Fullstack AgentCore Solution Template (FAST)! This document provides guidelines and instructions for contributing to this project.

## Table of Contents

- [Contributing to the Fullstack AgentCore Solution Template (FAST)](#contributing-to-the-fullstack-agentcore-solution-template-fast)
  - [Table of Contents](#table-of-contents)
- [Code of Conduct](#code-of-conduct)
  - [Use of AI Coding Assistants by Developers (Q CLI, Cline, Kiro, etc)](#use-of-ai-coding-assistants-by-developers-q-cli-cline-kiro-etc)
- [FAST Tenets](#fast-tenets)
- [Integrated Feature, or Documentation?](#integrated-feature-or-documentation)
- [Getting Started](#getting-started)
  - [Development Environment Setup](#development-environment-setup)
  - [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
  - [Branching Strategy](#branching-strategy)
  - [Making Changes](#making-changes)
  - [Testing Your Changes](#testing-your-changes)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Documentation](#documentation)
- [Reporting Bugs/Feature Requests](#reporting-bugsfeature-requests)

# Code of Conduct

This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct) (even though this code is not open sourced).
For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.

## Use of AI Coding Assistants by Developers (Q CLI, Cline, Kiro, etc)
Use of AI coding assistants is encouraged when developing the core FAST code base. However, **the developer leveraging AI should be able to explain every line of code that AI wrote, without the help of AI**. So, use it slowly, and understand what is doing before hitting "`y`".

Note, the above guideline applies to FAST core _developers_ who are _contributing_ to the FAST code base. FAST is designed for its _users_ to use AI coding assistants to build a full stack application with FAST as a starting point. _Users_ can hold themselves to whatever standards they prefer.

# FAST Tenets
Contributions must comply with the five core tenets of the FAST solution:
1. **Simplicity, simplicity, simplicity**: The starter pack should be just that, a starter pack. It should be bare bones and without any frills, to keep it as easy to adopt as possible. Developers, who are often scientists and not SDEs, should start with the starter pack to handle most of the undifferentiated heavy lifting components of building a full stack application then add onto it, not start with a bloated package and have to remove unnecessary features.
2. **Adoptability though Documentation**: The starter pack should be extremely well documented. While non-core features may not exist in the code base, approaches for implementing them should appear in markdown files in the repository. Users of FAST should instruct their coding assistants to prioritize following this documentation above all else. 
3. **Vibe Friendly**: The starter pack should have READMEs and guides demonstrating how to use adapt it according to best practices with vibe coding. It should have opinions on recommended MCP servers and workflows for development. It should show developers that they don’t need to understand any React to modify the frontend.
4. **Opinionated Language and Framework**: Python for the backend as it is the language everyone (including LLMs) is most comfortable with. React for the frontend to keep it as close to production grade as possible. CDK for the infrastructure as code for the modularity.
5. **Single threaded owner**: The starter pack should always have a single-threaded owner/team who maintains it and decides which features are important enough to add into code vs into documentation files (see Tenets #1 and #2).

# Integrated Feature, or Documentation?
FAST is a _documentation heavy solution_. Rather than supporting all possible configurations of agentic applications and requirements out-of-the-box, FAST will support basic starting points for common applications and will have extensive documentation (markdown files) describing how to build on the baseline with best practices so developers can use coding assistants to build exactly what they need.

In this vein, "contributing" to the FAST code base will often be in form of a single, well-authored markdown file which may or may not even contain code snippets. **It is recommended that developers research best practices, implement their desired feature, and submit a pull request for review.** It is possible that instead of accepting the pull request, the contributor to be asked to convert their contribution into a markdown document instead. That doesn't mean the effort coding up the PR was a waste! It instead means that the effort will serve future FAST users more effectively if it is condensed into a documentation file containing code snippets. This is the manifestation of enforcing Tenets #1 and #2 above.

# Getting Started
This section describes how _FAST contributors_ should get started. If you are a _FAST user_ (a scientist or engineer leveraging FAST to build a fullstack agentic solution for a customer engagement) please see the top level repository README instead.

## Development Environment Setup

1. **Prerequisites**:
   - Bash shell (Linux, MacOS)
   - AWS CLI
   - AWS SAM CLI
   - Python 3.11 or later
   - Docker

2. **Fork and Clone the Repository**:
   TODO

3. **Install Dependencies and test local build**:
   See the [Deployment Guide](docs/DEPLOYMENT.md) for prerequisites and setup instructions.
   
   For frontend-specific development, see [Frontend README](frontend/README.md).
   
   For infrastructure development, see [Infrastructure README](infra-cdk/README.md).

## Project Structure

Familiarize yourself with the project structure:

- `docs/`: Documentation files
- `frontend/`: Web UI components (React)
- `gateway/`: Shared utilities and tools for AgentCore Gateway integration
- `infra-cdk/`: Infrastructure as Code (CDK)
- `patterns/`: Implementation of Agentic patterns to be deployed into AgentCore
- `scripts/`: Utility scripts for development, testing, and deployment
- `tests/`: Unit and integration tests
- `vibe-context/`: AI coding assistant context and rules

# Development Workflow


## Branching Strategy

1. Create a branch from `develop` for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```
   
   Use prefixes like `feature/`, `fix/`, `docs/` to indicate the type of change.

## Making Changes

1. Make your changes in the appropriate files
2. Keep changes focused on a single issue or feature
3. Write/update tests as necessary
4. Ensure code passes linting rules:
   - For Python code: `ruff` is configured for this project
   - For UI code: ESLint is configured in `frontend/.eslintrc`

## Testing Your Changes

1. **Local Testing**:
   ```bash
   # Run linting and formatting checks
   make all
   
   # For frontend-specific testing
   cd frontend
   npm run lint
   cd ..
   ```
   
   For comprehensive testing procedures, see [Scripts README](scripts/README.md).

2. **Integration Testing**:
   TODO

# Pull Request Process

1. **Update Documentation**: Ensure all documentation affected by your changes is updated
2. **Run Tests**: Verify that your changes pass all tests
3. **Create a Pull Request**: Submit a PR to the `develop` branch with a clear description of:
   - What the changes do
   - Why the changes are needed
   - Any relevant context or considerations
4. **Address Review Feedback**: Be responsive to review comments and make requested changes
5. **Merge**: Once approved, your contribution will be merged

# Coding Standards

- **Python**: Follow PEP 8 style guidelines
- **JavaScript/TypeScript**: Follow the ESLint configuration in the project
- **Documentation**: Update relevant documentation for any changes to functionality
- **Commit Messages**: Write clear, descriptive commit messages
- **Versioning**: Follow semantic versioning principles

# Documentation

- Update `README.md` when adding significant features
- Add detailed documentation to `/docs` for new patterns or major features
- Include code comments for complex logic or non-obvious implementations
- Update configuration examples if you modify the configuration structure

# Reporting Bugs/Feature Requests

We welcome you to use the [GitHub issue tracker](https://github.com/awslabs/fullstack-solution-template-for-agentcore/issues) to report bugs or suggest features for the FAST solution.


---

Thank you for contributing to the Fullstack AgentCore Solution Template (FAST)!
