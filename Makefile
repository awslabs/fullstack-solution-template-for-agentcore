# Makefile for code quality and formatting

# Define color codes
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m  # No Color

# Default target - run both lint and test
all: lint test

# Run tests
# TODO

# Run all linting and formatting with auto-fix
lint: ruff-lint format eslint prettier

# Run ESLint on frontend code with auto-fix
eslint:
	cd frontend && npx eslint --fix src/

# Run Prettier on frontend code with auto-fix
prettier:
	cd frontend && npx prettier --write "src/**/*.{ts,tsx,js,jsx,css,json}"

# Run ruff linting checks and fix issues automatically
ruff-lint:
	ruff check --fix

# Format Python code according to project standards
format:
	ruff format

# CI/CD version of lint that only checks but doesn't modify files
# Used in CI pipelines to verify code quality without making changes
lint-cicd:
	@echo "Running code quality checks..."
	@if ! ruff check; then \
		echo -e "$(RED)ERROR: Ruff linting failed!$(NC)"; \
		echo -e "$(YELLOW)Please run 'make ruff-lint' locally to fix these issues.$(NC)"; \
		exit 1; \
	fi
	@if ! ruff format --check; then \
		echo -e "$(RED)ERROR: Code formatting check failed!$(NC)"; \
		echo -e "$(YELLOW)Please run 'make format' locally to fix these issues.$(NC)"; \
		exit 1; \
	fi
	@cd frontend && if ! npx eslint src/; then \
		echo -e "$(RED)ERROR: ESLint check failed!$(NC)"; \
		echo -e "$(YELLOW)Please run 'make eslint' locally to fix these issues.$(NC)"; \
		exit 1; \
	fi
	@cd frontend && if ! npx prettier --check "src/**/*.{ts,tsx,js,jsx,css,json}"; then \
		echo -e "$(RED)ERROR: Prettier formatting check failed!$(NC)"; \
		echo -e "$(YELLOW)Please run 'make prettier' locally to fix these issues.$(NC)"; \
		exit 1; \
	fi
	@echo -e "$(GREEN)All code quality checks passed!$(NC)"
