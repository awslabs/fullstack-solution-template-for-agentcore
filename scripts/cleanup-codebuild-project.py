#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Cleanup script for persistent CodeBuild deployment resources.

Removes the CodeBuild project, IAM role, and permission boundary created
by deploy-with-codebuild.py. Does NOT affect your deployed FAST stack.

Usage: python scripts/cleanup-codebuild-project.py
"""

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict

if sys.version_info < (3, 11):
    print("Error: Python 3.11 or higher is required")
    sys.exit(1)

RESOURCE_PREFIX: str = "fast-deploy"


# --- Logging helpers ---


def log_info(message: str) -> None:
    """Print an info message."""
    print(f"ℹ {message}")


def log_success(message: str) -> None:
    """Print a success message."""
    print(f"✓ {message}")


def log_error(message: str) -> None:
    """Print an error message to stderr."""
    print(f"✗ {message}", file=sys.stderr)


# --- Utility functions ---


def run_command(command: list, check: bool = True) -> subprocess.CompletedProcess:
    """
    Execute a command securely via subprocess.

    Args:
        command: List of command arguments
        check: Whether to raise on non-zero exit

    Returns:
        CompletedProcess instance with command results
    """
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=check,
        shell=False,
        timeout=60,
    )


def parse_config_yaml(config_path: Path) -> Dict[str, str]:
    """
    Parse config.yaml using regex (no PyYAML dependency).

    Args:
        config_path: Path to config.yaml file

    Returns:
        Dictionary with stack_name_base value
    """
    config: Dict[str, str] = {"stack_name_base": ""}
    if not config_path.exists():
        return config

    content = config_path.read_text()
    match = re.search(r"^stack_name_base:\s*(\S+)", content, re.MULTILINE)
    if match:
        config["stack_name_base"] = match.group(1).strip("\"'")

    return config


# --- Cleanup functions ---


def delete_codebuild_project(project_name: str) -> bool:
    """
    Delete the CodeBuild project if it exists.

    Args:
        project_name: Name of the CodeBuild project

    Returns:
        True if deleted or didn't exist, False on error
    """
    log_info(f"Checking for CodeBuild project: {project_name}")

    # Check if project exists
    try:
        run_command(
            [
                "aws",
                "codebuild",
                "batch-get-projects",
                "--names",
                project_name,
                "--output",
                "json",
            ]
        )
    except subprocess.CalledProcessError:
        log_info(f"CodeBuild project does not exist: {project_name}")
        return True

    # Delete project
    try:
        run_command(
            [
                "aws",
                "codebuild",
                "delete-project",
                "--name",
                project_name,
                "--output",
                "json",
            ]
        )
        log_success(f"Deleted CodeBuild project: {project_name}")
        return True
    except subprocess.CalledProcessError as exc:
        log_error(f"Failed to delete CodeBuild project: {exc}")
        return False


def delete_iam_role(role_name: str) -> bool:
    """
    Delete the IAM role if it exists.

    Args:
        role_name: Name of the IAM role

    Returns:
        True if deleted or didn't exist, False on error
    """
    log_info(f"Checking for IAM role: {role_name}")

    # Check if role exists
    try:
        run_command(
            [
                "aws",
                "iam",
                "get-role",
                "--role-name",
                role_name,
                "--output",
                "json",
            ]
        )
    except subprocess.CalledProcessError:
        log_info(f"IAM role does not exist: {role_name}")
        return True

    # Detach managed policies
    try:
        run_command(
            [
                "aws",
                "iam",
                "detach-role-policy",
                "--role-name",
                role_name,
                "--policy-arn",
                "arn:aws:iam::aws:policy/AdministratorAccess",
                "--output",
                "json",
            ]
        )
    except subprocess.CalledProcessError:
        pass  # Policy might not be attached

    # Delete role
    try:
        run_command(
            [
                "aws",
                "iam",
                "delete-role",
                "--role-name",
                role_name,
                "--output",
                "json",
            ]
        )
        log_success(f"Deleted IAM role: {role_name}")
        return True
    except subprocess.CalledProcessError as exc:
        log_error(f"Failed to delete IAM role: {exc}")
        return False


def delete_permission_boundary(boundary_arn: str) -> bool:
    """
    Delete the permission boundary policy if it exists.

    Args:
        boundary_arn: ARN of the permission boundary policy

    Returns:
        True if deleted or didn't exist, False on error
    """
    log_info(f"Checking for permission boundary: {boundary_arn}")

    # Check if policy exists
    try:
        run_command(
            [
                "aws",
                "iam",
                "get-policy",
                "--policy-arn",
                boundary_arn,
                "--output",
                "json",
            ]
        )
    except subprocess.CalledProcessError:
        log_info(f"Permission boundary does not exist: {boundary_arn}")
        return True

    # Delete policy
    try:
        run_command(
            [
                "aws",
                "iam",
                "delete-policy",
                "--policy-arn",
                boundary_arn,
                "--output",
                "json",
            ]
        )
        log_success(f"Deleted permission boundary: {boundary_arn}")
        return True
    except subprocess.CalledProcessError as exc:
        log_error(f"Failed to delete permission boundary: {exc}")
        return False


# --- Main ---


def main() -> int:
    """
    Main cleanup function.

    Returns:
        Exit code (0 for success, 1 for failure)
    """
    config_path = Path(__file__).parent.parent / "infra-cdk" / "config.yaml"

    log_info("🧹 Cleaning up CodeBuild deployment resources...")
    print()

    # Verify AWS credentials
    log_info("Verifying AWS credentials...")
    try:
        result = run_command(["aws", "sts", "get-caller-identity", "--output", "json"])
        account_id: str = json.loads(result.stdout)["Account"]
        log_success(f"Account: {account_id}")
    except subprocess.CalledProcessError:
        log_error("AWS credentials not configured or invalid")
        return 1

    # Load stack name
    stack_name = parse_config_yaml(config_path=config_path).get("stack_name_base")
    if not stack_name:
        log_error("'stack_name_base' not found in infra-cdk/config.yaml")
        return 1
    log_success(f"Stack name: {stack_name}")

    # Generate resource names
    project_name = f"{RESOURCE_PREFIX}-{stack_name}"
    role_name = f"{RESOURCE_PREFIX}-role-{stack_name}"
    boundary_name = f"{RESOURCE_PREFIX}-boundary-{stack_name}"
    boundary_arn = f"arn:aws:iam::{account_id}:policy/{boundary_name}"

    print()
    log_info("Resources to delete:")
    log_info(f"  - CodeBuild project: {project_name}")
    log_info(f"  - IAM role: {role_name}")
    log_info(f"  - Permission boundary: {boundary_name}")
    print()

    # Delete resources in order (project → role → boundary)
    success = True

    if not delete_codebuild_project(project_name):
        success = False

    if not delete_iam_role(role_name):
        success = False

    if not delete_permission_boundary(boundary_arn):
        success = False

    print()
    if success:
        log_success("All resources cleaned up successfully")
        log_info("Note: This does NOT affect your deployed FAST stack")
        log_info("To remove the FAST stack, run: cd infra-cdk && cdk destroy --all")
        return 0
    else:
        log_error("Some resources could not be deleted (see errors above)")
        return 1


if __name__ == "__main__":
    sys.exit(main())
