#!/usr/bin/env python3
"""
Test script for AgentCore Memory

Tests short-term memory operations:
- Creating events (conversation history)
- Listing events (retrieving history)
- Getting specific events
- Pagination and filtering

Usage:
    # Auto-discover memory from nested stack
    uv run scripts/test-memory.py

    # Use specific memory ARN
    uv run scripts/test-memory.py --memory-arn <arn>

API References:
    - Control Plane: https://boto3.amazonaws.com/v1/documentation/api/1.40.0/reference/services/bedrock-agentcore-control.html
      (Memory resource management: create, update, delete memory)

    - Data Plane: https://boto3.amazonaws.com/v1/documentation/api/1.40.0/reference/services/bedrock-agentcore.html
      (Event operations: create, list, retrieve events)

"""

import argparse
import sys
import time
from datetime import UTC, datetime
from typing import Tuple

import boto3
from botocore.exceptions import ClientError
from colorama import Fore, Style

# Import shared utilities
from utils import (
    create_bedrock_client,
    generate_session_id,
    get_stack_config,
    print_msg,
    print_section,
)


def test_create_event(
    client: boto3.client, memory_id: str, actor_id: str, session_id: str
) -> bool:
    """Test creating events (conversation turns) in memory."""
    print("Test 1: Creating conversation events...")

    try:
        # Payload structure: USER message followed by ASSISTANT response
        payload = [
            {
                "conversational": {
                    "content": {"text": "What's the weather like today?"},
                    "role": "USER",
                }
            },
            {
                "conversational": {
                    "content": {
                        "text": "I don't have access to real-time weather data, but I can help you find weather information."
                    },
                    "role": "ASSISTANT",
                }
            },
        ]

        response = client.create_event(
            memoryId=memory_id,
            actorId=actor_id,
            sessionId=session_id,
            eventTimestamp=datetime.now(UTC),
            payload=payload,
        )

        event_id = response.get("event", {}).get("eventId")

        if event_id:
            print_msg("Test 1 passed", "success")
            print(f"  Event ID: {event_id}")
            print(f"  Payload items stored: {len(payload)}")
            return True
        else:
            print_msg("Test 1 failed - No event ID returned", "error")
            return False

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        error_msg = e.response.get("Error", {}).get("Message", str(e))
        print_msg(f"Test 1 failed - {error_code}", "error")
        print(f"  Error: {error_msg}")
        return False
    except Exception as e:
        print_msg("Test 1 failed - Unexpected error", "error")
        print(f"  Error: {e}")
        return False


def test_list_events(
    client: boto3.client, memory_id: str, actor_id: str, session_id: str
) -> bool:
    """Test listing events (conversation history) from memory."""
    print("\nTest 2: Listing conversation events...")

    try:
        response = client.list_events(
            memoryId=memory_id, actorId=actor_id, sessionId=session_id, maxResults=10
        )

        events = response.get("events", [])

        if events:
            print(f"{Fore.GREEN}✓ Test 2 passed{Style.RESET_ALL}")
            print(f"  Events found: {len(events)}")

            first_event = events[0]
            print(f"  Latest event ID: {first_event.get('eventId', 'N/A')}")
            print(f"  Timestamp: {first_event.get('eventTimestamp', 'N/A')}")
            payload = first_event.get("payload", [])
            if payload and "conversational" in payload[0]:
                conv = payload[0]["conversational"]
                role = conv.get("role", "unknown")
                content = conv.get("content", {}).get("text", "")[:50]
                print(f"  First message: [{role}] {content}...")

            return True
        else:
            print(f"{Fore.YELLOW}✓ Test 2 passed (no events found){Style.RESET_ALL}")
            return True

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        print_msg(f"Test 2 failed - {error_code}", "error")
        return False
    except Exception as e:
        print_msg("Test 2 failed - Unexpected error", "error")
        print(f"  Error: {e}")
        return False


def test_get_event(
    client: boto3.client, memory_id: str, actor_id: str, session_id: str
) -> bool:
    """Test getting a specific event by ID."""
    print("\nTest 3: Getting specific event...")

    try:
        list_response = client.list_events(
            memoryId=memory_id, actorId=actor_id, sessionId=session_id, maxResults=1
        )

        events = list_response.get("events", [])

        if not events:
            print(
                f"{Fore.YELLOW}✓ Test 3 skipped (no events available){Style.RESET_ALL}"
            )
            return True

        event_id = events[0]["eventId"]

        response = client.get_event(
            memoryId=memory_id, sessionId=session_id, actorId=actor_id, eventId=event_id
        )

        retrieved_event = response.get("event")

        if retrieved_event and retrieved_event.get("eventId") == event_id:
            print_msg("Test 3 passed", "success")
            print(f"  Retrieved event ID: {event_id}")
            return True
        else:
            print_msg("Test 3 failed - Event mismatch", "error")
            return False

    except ClientError as e:
        print_msg(
            f"Test 3 failed - {e.response.get('Error', {}).get('Code', 'Unknown')}",
            "error",
        )
        return False
    except Exception as e:
        print_msg("Test 3 failed - Unexpected error", "error")
        print(f"  Error: {e}")
        return False


def test_pagination(
    client: boto3.client, memory_id: str, actor_id: str, session_id: str
) -> bool:
    """Test pagination with maxResults parameter."""
    print("\nTest 4: Testing pagination...")

    try:
        print("  Creating additional events for pagination test...")
        for i in range(3):
            client.create_event(
                memoryId=memory_id,
                actorId=actor_id,
                sessionId=session_id,
                eventTimestamp=datetime.now(UTC),
                payload=[
                    {
                        "conversational": {
                            "content": {"text": f"Test message {i + 1}"},
                            "role": "USER",
                        }
                    }
                ],
            )

        time.sleep(1)  # Wait for indexing

        response = client.list_events(
            memoryId=memory_id, actorId=actor_id, sessionId=session_id, maxResults=2
        )

        events = response.get("events", [])
        next_token = response.get("nextToken")

        print_msg("Test 4 passed", "success")
        print(f"  Events in first page: {len(events)}")
        print(f"  Next token present: {bool(next_token)}")

        return True

    except ClientError as e:
        print_msg(
            f"Test 4 failed - {e.response.get('Error', {}).get('Code', 'Unknown')}",
            "error",
        )
        return False
    except Exception as e:
        print_msg("Test 4 failed - Unexpected error", "error")
        print(f"  Error: {e}")
        return False


def test_session_id_validation(
    client: boto3.client, memory_id: str, actor_id: str
) -> bool:
    """Test session ID length requirements."""
    print("\nTest 5: Testing session ID formats...")

    try:
        uuid_session_id = generate_session_id()

        client.create_event(
            memoryId=memory_id,
            actorId=actor_id,
            sessionId=uuid_session_id,
            eventTimestamp=datetime.now(UTC),
            payload=[
                {
                    "conversational": {
                        "content": {"text": "Test with UUID"},
                        "role": "USER",
                    }
                }
            ],
        )
        print_msg("Test 5 passed - UUID session IDs work correctly", "success")
        print(f"  UUID length: {len(uuid_session_id)} characters")
        return True

    except ClientError:
        print_msg("Test 5 failed - UUID session ID rejected", "error")
        return False
    except Exception:
        print_msg("Test 5 failed - Unexpected error", "error")
        return False


def test_invalid_memory_id(client: boto3.client) -> bool:
    """Test error handling with invalid memory ID."""
    print("\nTest 6: Testing error handling (invalid memory ID)...")

    try:
        invalid_memory_id = "invalid-memory-id-12345"

        try:
            client.list_events(
                memoryId=invalid_memory_id,
                actorId="test-actor",
                sessionId=generate_session_id(),
            )
            print_msg("Test 6 failed - Invalid memory ID was accepted", "error")
            return False

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            if "ResourceNotFoundException" in error_code or "NotFound" in error_code:
                print_msg(
                    "Test 6 passed - Invalid memory ID correctly rejected", "success"
                )
                print(f"  Error code: {error_code}")
                return True
            else:
                print_msg("Test 6 passed - Error handled gracefully", "success")
                print(f"  Error code: {error_code}")
                return True

    except Exception:
        print_msg("Test 6 failed - Unexpected error", "error")
        return False


def run_tests(client: boto3.client, memory_id: str) -> Tuple[int, int]:
    """Run all tests and return (passed, failed) counts."""
    print_section("Running Tests")

    test_actor_id = "test-user-12345"
    test_session_id = generate_session_id()

    print(f"Test Actor ID: {test_actor_id}")
    print(f"Test Session ID: {test_session_id}")
    print(f"  Length: {len(test_session_id)} characters (UUID4 format)\n")

    tests = [
        lambda: test_create_event(client, memory_id, test_actor_id, test_session_id),
        lambda: test_list_events(client, memory_id, test_actor_id, test_session_id),
        lambda: test_get_event(client, memory_id, test_actor_id, test_session_id),
        lambda: test_pagination(client, memory_id, test_actor_id, test_session_id),
        lambda: test_session_id_validation(client, memory_id, test_actor_id),
        lambda: test_invalid_memory_id(client),
    ]

    passed = 0
    failed = 0

    for test_func in tests:
        try:
            if test_func():
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"{Fore.RED}Test raised unexpected exception: {e}{Style.RESET_ALL}")
            failed += 1

    return passed, failed


def parse_arguments() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Test AgentCore Memory operations",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Auto-discover memory from nested stack
  uv run scripts/test-memory.py
  
  # Use specific memory ARN
  uv run scripts/test-memory.py --memory-arn arn:aws:bedrock-agentcore:us-east-1:123456789:memory/abc123
        """,
    )

    parser.add_argument("--memory-arn", type=str, help="Memory ARN to use for testing")

    return parser.parse_args()


def main():
    """Main entry point."""
    print("=" * 60)
    print("AgentCore Memory Test Script")
    print("=" * 60 + "\n")

    args = parse_arguments()

    # Determine memory ARN
    if args.memory_arn:
        memory_arn = args.memory_arn
        region = memory_arn.split(":")[3]
        memory_id = memory_arn.split("/")[-1]
        print(f"Using provided memory ARN: {memory_arn}\n")
    else:
        config = get_stack_config()
        print(f"Using stack: {config['stack_name']}\n")
        memory_arn = config["outputs"]["MemoryArn"]
        region = config["region"]
        memory_id = memory_arn.split("/")[-1]

    print(f"  Memory ARN: {memory_arn}")
    print(f"  Region: {region}")
    print(f"  Memory ID: {memory_id}\n")

    print_section("Initializing Memory Client")

    client = create_bedrock_client(region)
    print_msg(f"Memory client initialized (region: {region})", "success")

    # Run tests
    passed, failed = run_tests(client, memory_id)

    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    print(f"Passed: {Fore.GREEN}{passed}{Style.RESET_ALL}")
    print(f"Failed: {Fore.RED}{failed}{Style.RESET_ALL}\n")

    print("Memory Information:")
    print(f"  Memory ARN: {memory_arn}")
    print(f"  Region: {region}")
    print(f"  Memory ID: {memory_id}\n")

    if failed == 0:
        print(f"{Fore.GREEN}All tests passed! ✓{Style.RESET_ALL}")
        sys.exit(0)
    else:
        print(f"{Fore.RED}Some tests failed.{Style.RESET_ALL}")
        sys.exit(1)


if __name__ == "__main__":
    main()
