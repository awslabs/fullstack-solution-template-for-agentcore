#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Ephemeral CodeBuild deployment script for FAST.

Deploys the full FAST stack using a CodeBuild project. Requires Python 3.11+,
AWS CLI, and git. Only git-tracked or staged files are deployed; untracked
files are skipped with a warning.

Flow: zip source → create source bucket/IAM role/boundary/project →
      upload source → stream logs → on success, tear down everything.

On success, all created resources (source bucket, project, IAM role, boundary)
are removed. On failure, they are retained for debugging and reused on the next
run. The bucket has a 1-day object-expiry rule so a leftover archive can't
linger. Does NOT remove the deployed FAST stack (use `cd infra-cdk && cdk destroy`).

Usage: python scripts/deploy-with-codebuild.py
"""

import io
import json
import os
import re
import subprocess  # nosec B404 - subprocess used securely with explicit parameters
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

if sys.version_info < (3, 11):
    print("Error: Python 3.11 or higher is required")
    sys.exit(1)

RESOURCE_PREFIX: str = "fast-deploy"
LOG_POLL_INTERVAL: int = 5


# --- Logging helpers ---


def log_info(message: str) -> None:
    """Print an info message."""
    print(f"ℹ {message}")


def log_success(message: str) -> None:
    """Print a success message."""
    print(f"✓ {message}")


def log_warn(message: str) -> None:
    """Print a warning message."""
    print(f"⚠ {message}")


def log_error(message: str) -> None:
    """Print an error message to stderr."""
    print(f"✗ {message}", file=sys.stderr)


# --- Utility functions ---


def run_command(
    command: list,
    capture_output: bool = True,
    check: bool = True,
    cwd: Optional[str] = None,
) -> subprocess.CompletedProcess:
    """
    Execute a command securely via subprocess.

    Args:
        command: List of command arguments
        capture_output: Whether to capture stdout/stderr
        check: Whether to raise on non-zero exit
        cwd: Working directory for the command

    Returns:
        CompletedProcess instance with command results
    """
    return subprocess.run(  # nosec B603
        command,
        capture_output=capture_output,
        text=True,
        check=check,
        shell=False,
        timeout=300,
        cwd=cwd,
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


def get_stack_outputs(stack_name: str) -> Dict[str, str]:
    """
    Fetch CloudFormation stack outputs via AWS CLI.

    Args:
        stack_name: Name of the CloudFormation stack

    Returns:
        Dictionary mapping output keys to values
    """
    result = run_command(
        [
            "aws",
            "cloudformation",
            "describe-stacks",
            "--stack-name",
            stack_name,
            "--output",
            "json",
        ]
    )
    stacks = json.loads(result.stdout).get("Stacks", [])
    if not stacks:
        raise ValueError(f"Stack '{stack_name}' not found")
    outputs = stacks[0].get("Outputs", [])
    return {o["OutputKey"]: o["OutputValue"] for o in outputs}


# --- Source packaging ---


def _collect_tracked_files(repo_root: Path) -> List[str]:
    """
    Collect git-tracked and staged files via git ls-files.

    Only files git knows about (committed or staged) are returned, so
    untracked local files never get packaged. Requires git.

    Args:
        repo_root: Path to the repository root

    Returns:
        List of relative file paths

    Raises:
        SystemExit: If git is not available or the repo can't be read.
    """
    try:
        result = run_command(
            command=["git", "ls-files", "-z"],
            cwd=str(repo_root),
        )
    except FileNotFoundError:
        log_error(
            "git is required to package the source but was not found on PATH. "
            "Install git and run from inside the repository."
        )
        sys.exit(1)
    except subprocess.CalledProcessError:
        log_error(
            "Failed to list files with git. Run this script from inside the "
            "FAST git repository."
        )
        sys.exit(1)

    return [f for f in result.stdout.split("\0") if f]


def _warn_unstaged_files(repo_root: Path) -> None:
    """
    Warn about untracked, non-ignored files that will NOT be deployed.

    These are files git is not tracking and that aren't gitignored — likely
    new code the user forgot to stage. Best-effort; never raises.

    Args:
        repo_root: Path to the repository root
    """
    try:
        result = run_command(
            command=["git", "ls-files", "--others", "--exclude-standard", "-z"],
            cwd=str(repo_root),
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return

    untracked = [f for f in result.stdout.split("\0") if f]
    if not untracked:
        return

    log_warn(
        f"{len(untracked)} untracked file(s) will NOT be deployed. "
        "Run 'git add' to include them:"
    )
    for path in untracked[:20]:
        log_warn(f"  - {path}")
    if len(untracked) > 20:
        log_warn(f"  …and {len(untracked) - 20} more")


def create_source_zip() -> bytes:
    """
    Create an in-memory zip of the git-tracked source.

    Only tracked or staged files are packaged. Untracked files are skipped
    and reported via a warning so local secrets never leave the machine.

    Returns:
        Raw bytes of the zip archive
    """
    repo_root: Path = Path(__file__).parent.parent

    _warn_unstaged_files(repo_root)
    files = _collect_tracked_files(repo_root)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in files:
            full = repo_root / rel
            if full.is_file():
                zf.write(filename=str(full), arcname=rel)

    log_success(
        f"Zipped {len(files)} files ({len(buf.getvalue()) / 1024 / 1024:.1f} MB)"
    )
    return buf.getvalue()


# --- AWS resource creation ---


def get_or_create_source_bucket(bucket_name: str, region: str) -> None:
    """
    Get or create the source bucket for this deployment run.

    Removed after a successful run, retained on failure. A 1-day object-expiry
    rule ensures a leftover archive can't linger.

    Args:
        bucket_name: Name of the bucket
        region: AWS region for the bucket
    """
    # Adopt the bucket if a previous interrupted run already created it.
    try:
        run_command(
            ["aws", "s3api", "head-bucket", "--bucket", bucket_name],
        )
        log_success(f"Using existing source bucket: {bucket_name}")
        return
    except subprocess.CalledProcessError:
        pass  # Bucket doesn't exist (or isn't ours yet) — create it.

    log_info(f"Creating source bucket: {bucket_name}")
    cmd = ["aws", "s3api", "create-bucket", "--bucket", bucket_name, "--output", "json"]
    # us-east-1 does not accept a LocationConstraint
    if region != "us-east-1":
        cmd += ["--create-bucket-configuration", f"LocationConstraint={region}"]
    run_command(cmd)

    # Expire objects after a day so a leftover archive can't linger.
    run_command(
        [
            "aws",
            "s3api",
            "put-bucket-lifecycle-configuration",
            "--bucket",
            bucket_name,
            "--lifecycle-configuration",
            json.dumps(
                {
                    "Rules": [
                        {
                            "ID": "expire-source-archives",
                            "Status": "Enabled",
                            "Filter": {},
                            "Expiration": {"Days": 1},
                            "AbortIncompleteMultipartUpload": {
                                "DaysAfterInitiation": 1
                            },
                        }
                    ]
                }
            ),
            "--output",
            "json",
        ]
    )
    log_success(f"Source bucket created: {bucket_name}")


def get_or_create_permission_boundary(policy_name: str, account_id: str) -> str:
    """
    Get existing permission boundary policy or create it if it doesn't exist.

    Args:
        policy_name: Name for the IAM boundary policy
        account_id: AWS account ID

    Returns:
        The ARN of the permission boundary policy
    """
    boundary_arn = f"arn:aws:iam::{account_id}:policy/{policy_name}"

    # Check if policy already exists
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
        log_success(f"Using existing permission boundary: {boundary_arn}")
        return boundary_arn
    except subprocess.CalledProcessError:
        pass  # Policy doesn't exist, create it

    log_info(f"Creating permission boundary: {policy_name}")

    # Deny dangerous actions that a CDK deployment should never need.
    boundary_policy: Dict[str, Any] = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "DenyDangerousActions",
                "Effect": "Deny",
                "Action": [
                    "iam:CreateUser",
                    "iam:CreateAccessKey",
                    "iam:CreateLoginProfile",
                    "iam:AttachUserPolicy",
                    "iam:PutUserPolicy",
                    "organizations:*",
                    "account:*",
                    "kms:PutKeyPolicy",
                    "kms:CreateGrant",
                ],
                "Resource": "*",
            },
            {
                "Sid": "AllowEverythingElse",
                "Effect": "Allow",
                "Action": "*",
                "Resource": "*",
            },
        ],
    }

    result = run_command(
        [
            "aws",
            "iam",
            "create-policy",
            "--policy-name",
            policy_name,
            "--policy-document",
            json.dumps(boundary_policy),
            "--output",
            "json",
        ]
    )
    boundary_arn = json.loads(result.stdout)["Policy"]["Arn"]
    log_success(f"Permission boundary created: {boundary_arn}")
    return boundary_arn


def get_or_create_codebuild_iam_role(
    role_name: str, boundary_arn: str, account_id: str
) -> str:
    """
    Get existing IAM role or create it if it doesn't exist.

    The role has AdministratorAccess constrained by a permission boundary
    that blocks dangerous actions (creating IAM users, access keys, etc.).

    Args:
        role_name: Name for the IAM role
        boundary_arn: ARN of the permission boundary policy to attach
        account_id: AWS account ID

    Returns:
        The ARN of the role
    """
    role_arn = f"arn:aws:iam::{account_id}:role/{role_name}"

    # Check if role already exists
    try:
        result = run_command(
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
        log_success(f"Using existing IAM role: {role_arn}")
        return role_arn
    except subprocess.CalledProcessError:
        pass  # Role doesn't exist, create it

    log_info(f"Creating IAM role: {role_name}")

    trust_policy: Dict[str, Any] = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"Service": "codebuild.amazonaws.com"},
                "Action": "sts:AssumeRole",
            }
        ],
    }

    result = run_command(
        [
            "aws",
            "iam",
            "create-role",
            "--role-name",
            role_name,
            "--assume-role-policy-document",
            json.dumps(trust_policy),
            "--permissions-boundary",
            boundary_arn,
            "--output",
            "json",
        ]
    )
    role_arn = json.loads(result.stdout)["Role"]["Arn"]

    run_command(
        [
            "aws",
            "iam",
            "attach-role-policy",
            "--role-name",
            role_name,
            "--policy-arn",
            "arn:aws:iam::aws:policy/AdministratorAccess",
            "--output",
            "json",
        ]
    )

    # IAM is eventually consistent — CodeBuild will fail to assume the role
    # if we proceed too quickly after creation.
    log_info("Waiting 10s for IAM role propagation...")
    time.sleep(10)

    log_success(f"IAM role created: {role_arn}")
    return role_arn


def get_or_create_codebuild_project(
    project_name: str,
    role_arn: str,
    bucket_name: str,
    source_key: str,
    stack_name: str,
    region: str,
) -> None:
    """
    Get existing CodeBuild project or create it if it doesn't exist.

    Args:
        project_name: Name for the CodeBuild project
        role_arn: ARN of the IAM service role
        bucket_name: S3 bucket containing the source zip
        source_key: S3 key of the source zip
        stack_name: CDK stack name base (passed as env var)
        region: AWS region
    """
    # Define buildspec once for both create and update paths
    buildspec: str = (
        "version: 0.2\n"
        "phases:\n"
        "  install:\n"
        "    runtime-versions:\n"
        "      python: 3.12\n"
        "      nodejs: 20\n"
        "    commands:\n"
        "      - npm install -g aws-cdk\n"
        "      - cd $CODEBUILD_SRC_DIR/infra-cdk && npm ci\n"
        "  build:\n"
        "    commands:\n"
        '      - echo "Source dir contents:" && ls -la $CODEBUILD_SRC_DIR/\n'
        "      - cd $CODEBUILD_SRC_DIR/infra-cdk && cdk bootstrap\n"
        "      - cd $CODEBUILD_SRC_DIR/infra-cdk && cdk deploy --all --require-approval never\n"
        "  post_build:\n"
        "    commands:\n"
        "      - cd $CODEBUILD_SRC_DIR && python scripts/deploy-frontend.py\n"
    )

    # Check if project already exists
    try:
        result = run_command(
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
        projects = json.loads(result.stdout).get("projects", [])
        if projects:
            # Update source location to point to new temp bucket
            log_info(f"Updating existing CodeBuild project source: {project_name}")
            run_command(
                [
                    "aws",
                    "codebuild",
                    "update-project",
                    "--name",
                    project_name,
                    "--source",
                    json.dumps(
                        {
                            "type": "S3",
                            "location": f"{bucket_name}/{source_key}",
                            "buildspec": buildspec,
                        }
                    ),
                    "--output",
                    "json",
                ]
            )
            log_success(f"Using existing CodeBuild project: {project_name}")
            return
    except subprocess.CalledProcessError:
        pass  # Project doesn't exist, create it

    log_info(f"Creating CodeBuild project: {project_name}")

    project_input: Dict[str, Any] = {
        "name": project_name,
        "source": {
            "type": "S3",
            "location": f"{bucket_name}/{source_key}",
            "buildspec": buildspec,
        },
        "artifacts": {"type": "NO_ARTIFACTS"},
        "environment": {
            "type": "ARM_CONTAINER",
            "image": "aws/codebuild/amazonlinux2-aarch64-standard:3.0",
            "computeType": "BUILD_GENERAL1_LARGE",
            "privilegedMode": True,
            "environmentVariables": [
                {"name": "STACK_NAME", "value": stack_name, "type": "PLAINTEXT"},
                {"name": "AWS_DEFAULT_REGION", "value": region, "type": "PLAINTEXT"},
            ],
        },
        "serviceRole": role_arn,
        "timeoutInMinutes": 60,
    }

    run_command(
        [
            "aws",
            "codebuild",
            "create-project",
            "--cli-input-json",
            json.dumps(project_input),
            "--output",
            "json",
        ]
    )
    log_success(f"CodeBuild project created: {project_name}")


def start_codebuild(project_name: str) -> str:
    """
    Start a CodeBuild build and return the build ID.

    Args:
        project_name: Name of the CodeBuild project

    Returns:
        The build ID string
    """
    log_info("Starting CodeBuild build...")
    result = run_command(
        [
            "aws",
            "codebuild",
            "start-build",
            "--project-name",
            project_name,
            "--output",
            "json",
        ]
    )
    build_id: str = json.loads(result.stdout)["build"]["id"]
    log_success(f"Build ID: {build_id}")
    return build_id


# --- Log streaming ---


def poll_log_events(
    log_group: str, log_stream: str, next_token: Optional[str]
) -> Optional[str]:
    """
    Fetch and print new CloudWatch log events.

    Args:
        log_group: CloudWatch log group name
        log_stream: CloudWatch log stream name
        next_token: Forward token from previous poll (None for first call)

    Returns:
        Updated forward token for the next poll
    """
    cmd = [
        "aws",
        "logs",
        "get-log-events",
        "--log-group-name",
        log_group,
        "--log-stream-name",
        log_stream,
        "--start-from-head",
        "--output",
        "json",
    ]
    if next_token:
        cmd += ["--next-token", next_token]

    try:
        result = run_command(command=cmd, check=True)
    except subprocess.CalledProcessError:
        return next_token  # log stream may not exist yet

    data: Dict[str, Any] = json.loads(result.stdout)
    for event in data.get("events", []):
        print(event.get("message", "").rstrip("\n"))

    return data.get("nextForwardToken", next_token)


def stream_build_logs(build_id: str) -> str:
    """
    Poll CodeBuild status and stream CloudWatch logs until completion.

    Args:
        build_id: The CodeBuild build ID to monitor

    Returns:
        Final build status string (e.g. 'SUCCEEDED', 'FAILED')
    """
    log_group: Optional[str] = None
    log_stream: Optional[str] = None
    next_token: Optional[str] = None

    while True:
        result = run_command(
            [
                "aws",
                "codebuild",
                "batch-get-builds",
                "--ids",
                build_id,
                "--output",
                "json",
            ]
        )
        build_info: Dict[str, Any] = json.loads(result.stdout)["builds"][0]
        status: str = build_info["buildStatus"]
        phase: str = build_info.get("currentPhase", "UNKNOWN")

        # Discover log group/stream once available
        if log_group is None:
            logs_info = build_info.get("logs", {})
            log_group = logs_info.get("groupName")
            log_stream = logs_info.get("streamName")

        # Stream new log events
        if log_group and log_stream:
            next_token = poll_log_events(
                log_group=log_group,
                log_stream=log_stream,
                next_token=next_token,
            )

        if status != "IN_PROGRESS":
            # Final poll to catch remaining lines
            if log_group and log_stream:
                poll_log_events(
                    log_group=log_group,
                    log_stream=log_stream,
                    next_token=next_token,
                )
            break

        log_info(f"Phase: {phase} | Status: {status}")
        time.sleep(LOG_POLL_INTERVAL)

    return status


# --- Cleanup ---


def _delete_codebuild_project(project_name: Optional[str]) -> None:
    """Best-effort delete of the CodeBuild project. Logged, never raised."""
    if not project_name:
        return
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
    except subprocess.CalledProcessError as exc:
        log_error(f"Failed to delete CodeBuild project: {exc}")


def _delete_iam_role(role_name: Optional[str]) -> None:
    """Best-effort detach of AdministratorAccess and delete of the role."""
    if not role_name:
        return
    # Detach the managed policy first (ignore if not attached / role absent).
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
        pass
    try:
        run_command(
            ["aws", "iam", "delete-role", "--role-name", role_name, "--output", "json"]
        )
        log_success(f"Deleted IAM role: {role_name}")
    except subprocess.CalledProcessError as exc:
        log_error(f"Failed to delete IAM role: {exc}")


def _delete_permission_boundary(boundary_arn: Optional[str]) -> None:
    """Best-effort delete of the permission boundary policy."""
    if not boundary_arn:
        return
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
    except subprocess.CalledProcessError as exc:
        log_error(f"Failed to delete permission boundary: {exc}")


def _delete_source_bucket(bucket_name: Optional[str]) -> None:
    """Best-effort empty and delete of the source bucket."""
    if not bucket_name:
        return
    try:
        run_command(["aws", "s3", "rb", f"s3://{bucket_name}", "--force"])
        log_success(f"Deleted source bucket: {bucket_name}")
    except subprocess.CalledProcessError as exc:
        log_error(f"Failed to delete source bucket: {exc}")


def teardown(resources: Dict[str, Optional[str]]) -> None:
    """
    Remove every resource this run created. Best-effort and idempotent.

    Order matters: the IAM role must be deleted before its permission
    boundary, since IAM won't delete a policy still attached as a boundary.
    Deleting a resource that doesn't exist is a no-op.

    Args:
        resources: Mapping with keys 'project', 'role', 'boundary_arn', 'bucket'
    """
    if not any(resources.values()):
        return

    log_info("Cleaning up deployment resources...")
    _delete_codebuild_project(resources.get("project"))
    _delete_iam_role(resources.get("role"))
    _delete_permission_boundary(resources.get("boundary_arn"))
    _delete_source_bucket(resources.get("bucket"))


# --- Main ---


def main() -> int:
    """
    Main deployment function.

    Returns:
        Exit code (0 for success, 1 for failure)
    """
    # Track every resource this run creates so we can tear them all down on a
    # successful build, or report them for debugging if the build fails.
    resources: Dict[str, Optional[str]] = {
        "project": None,
        "role": None,
        "boundary_arn": None,
        "bucket": None,
    }
    source_key: str = "source.zip"

    config_path = Path(__file__).parent.parent / "infra-cdk" / "config.yaml"

    log_info("🚀 Starting CodeBuild deployment...")
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

    # Detect region
    region: str = (
        os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or ""
    )
    if not region:
        try:
            region = run_command(["aws", "configure", "get", "region"]).stdout.strip()
        except subprocess.CalledProcessError:
            region = ""
    if not region:
        log_error("AWS region not configured")
        return 1
    log_success(f"Region: {region}")

    # Load stack name
    stack_name = parse_config_yaml(config_path=config_path).get("stack_name_base")
    if not stack_name:
        log_error("'stack_name_base' not found in infra-cdk/config.yaml")
        return 1
    log_success(f"Stack name: {stack_name}")

    # Stable resource names. Normalize the stack name for S3 (lowercase, valid
    # chars) and cap at the 63-char bucket limit.
    project_name = f"{RESOURCE_PREFIX}-{stack_name}"
    role_name = f"{RESOURCE_PREFIX}-role-{stack_name}"
    boundary_name = f"{RESOURCE_PREFIX}-boundary-{stack_name}"
    safe_stack = re.sub(r"[^a-z0-9-]", "-", stack_name.lower()).strip("-")
    source_bucket = (f"{RESOURCE_PREFIX}-src-{account_id}-{safe_stack}")[:63].rstrip(
        "-"
    )

    # Register names up front so teardown/debug-report works even on partial failure.
    resources["project"] = project_name
    resources["role"] = role_name
    resources["boundary_arn"] = f"arn:aws:iam::{account_id}:policy/{boundary_name}"
    resources["bucket"] = source_bucket

    # Package source
    log_info("Packaging source...")
    zip_bytes: bytes = create_source_zip()

    # Get or create the source bucket and upload
    get_or_create_source_bucket(bucket_name=source_bucket, region=region)
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        tmp.write(zip_bytes)
        tmp_path = tmp.name
    try:
        log_info(f"Uploading source to s3://{source_bucket}/{source_key}")
        run_command(
            [
                "aws",
                "s3",
                "cp",
                tmp_path,
                f"s3://{source_bucket}/{source_key}",
                "--no-progress",
            ]
        )
        log_success("Source uploaded")
    finally:
        os.unlink(tmp_path)

    # Get or create the IAM role and its permission boundary
    boundary_arn: str = get_or_create_permission_boundary(
        policy_name=boundary_name,
        account_id=account_id,
    )
    role_arn: str = get_or_create_codebuild_iam_role(
        role_name=role_name,
        boundary_arn=boundary_arn,
        account_id=account_id,
    )

    # Get or create CodeBuild project
    get_or_create_codebuild_project(
        project_name=project_name,
        role_arn=role_arn,
        bucket_name=source_bucket,
        source_key=source_key,
        stack_name=stack_name,
        region=region,
    )

    # Start build
    build_id: str = start_codebuild(project_name=project_name)

    # Stream logs
    final_status: str = stream_build_logs(build_id=build_id)

    # Report result and clean up based on outcome.
    print()
    if final_status == "SUCCEEDED":
        log_success(f"Build finished with status: {final_status}")
        try:
            outputs = get_stack_outputs(stack_name=stack_name)
            app_url = outputs.get("AmplifyUrl")
            if app_url:
                log_success(f"App URL: {app_url}")
        except (subprocess.CalledProcessError, ValueError):
            log_info("Could not retrieve App URL - check the AWS console")

        # Success: remove all build resources, leaving zero footprint.
        print()
        teardown(resources)
    else:
        log_error(f"Build finished with status: {final_status}")
        log_info("Check the build output above for details")

        # Failure: retain resources so the build can be inspected and retried.
        console_url = (
            f"https://{region}.console.aws.amazon.com/codesuite/"
            f"codebuild/projects/{project_name}"
        )
        print()
        log_warn("Build resources retained for debugging:")
        log_warn(f"  - CodeBuild project: {project_name}")
        log_warn(f"  - Console: {console_url}")
        log_warn(f"  - CloudWatch logs: /aws/codebuild/{project_name}")
        log_info(
            "Re-run this script after fixing the issue — it reuses these "
            "resources, and a successful run removes them all."
        )

    return 0 if final_status == "SUCCEEDED" else 1


if __name__ == "__main__":
    sys.exit(main())
