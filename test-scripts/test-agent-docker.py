#!/usr/bin/env python3

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Test AgentCore agent by building and running the Docker image locally.

Tests the actual production Docker artifact against deployed AWS resources
(Memory, Gateway, SSM parameters). This validates the complete container
before deployment.

Usage:
    python scripts/test-agent-docker.py              # Build & run
    python scripts/test-agent-docker.py --build-only # Build only
    python scripts/test-agent-docker.py --skip-build # Run existing image
    python scripts/test-agent-docker.py --pattern langgraph-single-agent
"""

import argparse
import atexit
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

import requests
from colorama import Fore, Style
from utils import (
    create_mock_jwt,
    generate_session_id,
    get_stack_config,
    print_msg,
    print_section,
)

# Globals
_container_id: Optional[str] = None
REPO_ROOT = Path(__file__).parent.parent
IMAGE_NAME = "fast-agent-local"


def build_docker_image(pattern: str) -> bool:
    """
    Build Docker image for the specified pattern.

    Args:
        pattern: Agent pattern name (e.g., 'strands-single-agent')

    Returns:
        bool: True if build succeeded, False otherwise
    """
    dockerfile = f"patterns/{pattern}/Dockerfile"
    dockerfile_path = REPO_ROOT / dockerfile

    if not dockerfile_path.exists():
        print_msg(f"Dockerfile not found: {dockerfile_path}", "error")
        return False

    print_section(f"Building Docker Image ({pattern})")
    print(f"Dockerfile: {dockerfile}")
    print(f"Context: {REPO_ROOT}\n")

    cmd = [
        "docker",
        "build",
        "-f",
        dockerfile,
        "-t",
        IMAGE_NAME,
        "--platform",
        "linux/arm64",
        ".",
    ]

    result = subprocess.run(cmd, cwd=REPO_ROOT)

    if result.returncode != 0:
        print_msg("Docker build failed", "error")
        return False

    print_msg("Docker build successful", "success")
    return True


def run_docker_container(memory_id: str, stack_name: str, region: str) -> Optional[str]:
    """
    Run the Docker container with required environment variables.

    Args:
        memory_id: AgentCore Memory ID
        stack_name: CloudFormation stack name for SSM lookups
        region: AWS region

    Returns:
        Container ID if successful, None otherwise
    """
    global _container_id

    print_section("Starting Docker Container")

    # Pass AWS credentials from environment
    env_args = []
    for var in ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]:
        val = os.environ.get(var)
        if val:
            env_args.extend(["-e", f"{var}={val}"])

    # Required environment variables for agent
    env_args.extend(
        [
            "-e",
            f"MEMORY_ID={memory_id}",
            "-e",
            f"STACK_NAME={stack_name}",
            "-e",
            f"AWS_DEFAULT_REGION={region}",
            "-e",
            f"AWS_REGION={region}",
        ]
    )

    cmd = [
        "docker",
        "run",
        "--rm",
        "-d",
        "-p",
        "8080:8080",
        "--platform",
        "linux/arm64",
        *env_args,
        IMAGE_NAME,
    ]

    print(f"Memory ID: {memory_id}")
    print(f"Stack Name: {stack_name}")
    print(f"Region: {region}\n")

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print_msg(f"Failed to start container: {result.stderr}", "error")
        return None

    _container_id = result.stdout.strip()
    print(f"Container ID: {_container_id[:12]}")

    # Buffer for container to be ready
    print("Waiting for agent to start...")
    for _ in range(30):
        try:
            import requests

            resp = requests.get("http://localhost:8080/ping", timeout=2)
            if resp.status_code == 200:
                print_msg("Agent is ready", "success")
                return _container_id
        except Exception:
            pass
        time.sleep(1)

    # Check if container is still running
    check = subprocess.run(
        ["docker", "ps", "-q", "-f", f"id={_container_id}"],
        capture_output=True,
        text=True,
    )
    if not check.stdout.strip():
        print_msg("Container exited unexpectedly. Checking logs...", "error")
        subprocess.run(["docker", "logs", _container_id])
        _container_id = None
        return None

    print_msg("Agent failed to start (timeout)", "error")
    stop_container()
    return None


def stop_container() -> None:
    """Stop the running container."""
    global _container_id
    if _container_id:
        print("\nStopping container...")
        subprocess.run(["docker", "stop", _container_id], capture_output=True)
        print_msg("Container stopped", "success")
        _container_id = None


def invoke_agent_docker(url: str, prompt: str, session_id: str, user_id: str) -> None:
    """
    Invoke agent and print streaming events.

    Sends a mock JWT Bearer token in the Authorization header so the agent
    can extract the user ID from the token's 'sub' claim, matching the
    production authentication flow.

    Args:
        url (str): Agent endpoint URL.
        prompt (str): User prompt.
        session_id (str): Session ID for conversation continuity.
        user_id (str): User ID to embed in the mock JWT.
    """
    payload = {
        "prompt": prompt,
        "runtimeSessionId": session_id,
    }

    mock_token = create_mock_jwt(user_id)

    try:
        response = requests.post(
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {mock_token}",
            },
            json=payload,
            stream=True,
            timeout=120,
        )

        if response.status_code != 200:
            print(f"Error: HTTP {response.status_code}: {response.text}")
            return

        for line in response.iter_lines(decode_unicode=True):
            if line:
                print(f"{Fore.GREEN}→{Style.RESET_ALL} {line}", flush=True)

    except requests.exceptions.ConnectionError:
        print_msg("Connection lost to container", "error")
    except Exception as e:
        print(f"Error: {e}")


def run_interactive_chat() -> None:
    """Run interactive chat against the local container."""
    session_id = generate_session_id()

    print_section("Interactive Chat (Docker)")
    print(f"Session ID: {session_id}")
    print(f"\n{Fore.YELLOW}Type 'exit' to quit, Ctrl+C to stop{Style.RESET_ALL}\n")

    while True:
        try:
            prompt = input(f"{Fore.CYAN}You:{Style.RESET_ALL} ").strip()
            if not prompt:
                continue
            if prompt.lower() in ["exit", "quit"]:
                break

            start = time.time()
            invoke_agent_docker(
                url="http://localhost:8080/invocations",
                prompt=prompt,
                session_id=session_id,
                user_id="docker-test-user",
            )
            elapsed = time.time() - start
            print(f"\n{Fore.CYAN}[{elapsed:.2f}s]{Style.RESET_ALL}\n")

        except (KeyboardInterrupt, EOFError):
            break

    print(f"\n{Fore.GREEN}Goodbye!{Style.RESET_ALL}")


def signal_handler(sig, frame) -> None:
    """Handle interrupt signal."""
    stop_container()
    sys.exit(0)


# Register cleanup handlers
atexit.register(stop_container)
signal.signal(signal.SIGINT, signal_handler)


def parse_arguments() -> argparse.Namespace:
    """
    Parse command-line arguments.

    Returns:
        Parsed arguments namespace
    """
    parser = argparse.ArgumentParser(
        description="Test AgentCore agent via Docker container",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/test-agent-docker.py                    # Build and run
  python scripts/test-agent-docker.py --build-only       # Build only
  python scripts/test-agent-docker.py --skip-build       # Use existing image
  python scripts/test-agent-docker.py --pattern langgraph-single-agent
        """,
    )

    parser.add_argument(
        "--pattern", type=str, help="Override agent pattern from config.yaml"
    )
    parser.add_argument(
        "--build-only", action="store_true", help="Build image only, don't run"
    )
    parser.add_argument(
        "--skip-build", action="store_true", help="Skip build, use existing image"
    )

    return parser.parse_args()


def main() -> None:
    """Main entry point."""
    print("=" * 60)
    print("AgentCore Docker Testing")
    print("=" * 60 + "\n")

    args = parse_arguments()

    # Get configuration from stack
    stack_cfg = get_stack_config()
    pattern = args.pattern or stack_cfg.get("pattern", "strands-single-agent")

    print(f"Pattern: {pattern}\n")

    # Build image
    if not args.skip_build:
        if not build_docker_image(pattern):
            sys.exit(1)

    if args.build_only:
        print("\nBuild complete. Use --skip-build to run without rebuilding.")
        return

    # Get stack outputs for runtime config
    outputs = stack_cfg["outputs"]
    memory_arn = outputs.get("MemoryArn")
    if not memory_arn:
        print_msg(
            "MemoryArn not found in stack outputs. Is the stack deployed?", "error"
        )
        sys.exit(1)

    memory_id = memory_arn.split("/")[-1]
    region = stack_cfg["region"]
    stack_name = stack_cfg["stack_name"]

    # Run container
    if not run_docker_container(memory_id, stack_name, region):
        sys.exit(1)

    # Interactive chat
    run_interactive_chat()
    stop_container()


if __name__ == "__main__":
    main()
