"""
Custom Resource Lambda for managing AgentCore Gateway Cedar Policy lifecycle.

This Lambda is invoked by CloudFormation during stack deployment to manage
a Policy Engine and Cedar Policy for AgentCore Gateway. It handles the full
three-step process:
  1. Create a Policy Engine and wait for ACTIVE status
  2. Create a Cedar Policy inside the engine and wait for ACTIVE status
  3. Attach the Policy Engine to the Gateway and wait for READY status

CloudFormation Events:
- Create: Creates policy engine, cedar policy, and attaches to gateway
- Update: Deletes all existing managed policies, creates a new one with the
  updated document, and verifies the policy engine is still attached to the
  gateway. Uses a shared helper (_delete_managed_policies) that handles stale
  policy IDs from the PhysicalResourceId by listing and deleting all policies
  matching the managed policy naming convention.
- Delete: Detaches policy engine from gateway, deletes all managed policies,
  and deletes the policy engine

Waiter Strategy:
- Policy creation uses the policy_active waiter. Policy deletion uses the
  policy_deleted waiter. Policy Engine creation uses the policy_engine_active
  waiter. Policy Engine deletion uses the policy_engine_deleted waiter.
- Gateway operations currently use a custom polling loop as the
  bedrock-agentcore-control service does not provide an official
  waiter for gateway status changes.
"""

import logging
import time
import uuid

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

client = boto3.client("bedrock-agentcore-control")

# Polling configuration for gateway
GATEWAY_POLL_INTERVAL_SECONDS = 5
GATEWAY_TIMEOUT_SECONDS = 300


def handler(event: dict, context: dict) -> dict:
    """
    CloudFormation Custom Resource handler for Cedar Policy lifecycle.

    Args:
        event: CloudFormation event containing RequestType and ResourceProperties.
        context: Lambda context object.

    Returns:
        Response dict with PhysicalResourceId and optional Data attributes.
    """
    request_type = event["RequestType"]
    props = event["ResourceProperties"]

    logger.info(f"Request type: {request_type}")
    logger.info(f"Gateway ID: {props['GatewayIdentifier']}")

    try:
        if request_type == "Create":
            return handle_create(props)
        elif request_type == "Update":
            return handle_update(event, props)
        elif request_type == "Delete":
            return handle_delete(event, props)
        else:
            raise ValueError(f"Unknown request type: {request_type}")

    except Exception as e:
        logger.error(f"Error handling {request_type}: {str(e)}", exc_info=True)
        raise


def handle_create(props: dict) -> dict:
    """
    Create Policy Engine, Cedar Policy, and attach to Gateway.

    Steps:
      1. Create Policy Engine -> wait for ACTIVE (official waiter)
      2. Create Cedar Policy -> wait for ACTIVE (official waiter)
      3. Attach Policy Engine to Gateway -> wait for READY (custom polling)

    Args:
        props: ResourceProperties from CloudFormation event.

    Returns:
        Response with PhysicalResourceId containing engine and policy IDs.
    """
    gateway_id = props["GatewayIdentifier"]
    policy_document = props["PolicyDocument"]
    description = props.get("Description", "Cedar policy for AgentCore Gateway")
    engine_name = props["PolicyEngineName"]

    # Step 1: Create Policy Engine
    logger.info(f"Creating Policy Engine: {engine_name}")
    engine_response = client.create_policy_engine(
        name=engine_name,
        description=f"Policy engine for gateway {gateway_id}",
        clientToken=str(uuid.uuid4()),
    )
    policy_engine_id = engine_response["policyEngineId"]
    logger.info(f"Policy Engine created: {policy_engine_id}")

    # Wait for Policy Engine to become ACTIVE using official waiter
    logger.info(f"Waiting for Policy Engine {policy_engine_id} to become ACTIVE...")
    waiter = client.get_waiter("policy_engine_active")
    waiter.wait(policyEngineId=policy_engine_id)
    logger.info(f"Policy Engine {policy_engine_id} is now ACTIVE")

    # Get the Policy Engine ARN for attaching to gateway
    engine_details = client.get_policy_engine(policyEngineId=policy_engine_id)
    policy_engine_arn = engine_details["policyEngineArn"]

    # Step 2: Create Cedar Policy
    policy_name = f"{engine_name}_cedar_policy"
    logger.info(f"Creating Cedar Policy: {policy_name}")
    policy_response = client.create_policy(
        policyEngineId=policy_engine_id,
        name=policy_name,
        description=description,
        definition={"cedar": {"statement": policy_document}},
    )
    policy_id = policy_response["policyId"]
    logger.info(f"Cedar Policy created: {policy_id}")

    # Wait for Cedar Policy to become ACTIVE using official waiter
    logger.info(f"Waiting for Cedar Policy {policy_id} to become ACTIVE...")
    waiter = client.get_waiter("policy_active")
    waiter.wait(policyEngineId=policy_engine_id, policyId=policy_id)
    logger.info(f"Cedar Policy {policy_id} is now ACTIVE")

    # Step 3: Attach Policy Engine to Gateway
    _attach_policy_engine_to_gateway(gateway_id, policy_engine_arn)

    # Encode both IDs in PhysicalResourceId for use in Update/Delete
    physical_id = f"{policy_engine_id}|{policy_id}"

    return {
        "PhysicalResourceId": physical_id,
        "Data": {
            "PolicyEngineId": policy_engine_id,
            "PolicyId": policy_id,
            "PolicyEngineArn": policy_engine_arn,
        },
    }


def handle_update(event: dict, props: dict) -> dict:
    """
    Update Cedar Policy by deleting all existing managed policies and creating
    a new one with the updated policy document.

    Also verifies the Policy Engine is still attached to the Gateway and
    re-attaches if needed. This handles cases where a previous failed
    deployment rollback may have detached the engine.

    Returns the SAME PhysicalResourceId to prevent CloudFormation from
    interpreting the update as a resource replacement (which would trigger
    a cleanup Delete that detaches the policy engine). The new policy ID
    is available in the Data attributes for CfnOutput access.

    Args:
        event: CloudFormation event.
        props: ResourceProperties from CloudFormation event.

    Returns:
        Response with original PhysicalResourceId and new policy ID in Data.
    """
    physical_id = event["PhysicalResourceId"]
    policy_engine_id, old_policy_id = physical_id.split("|")

    gateway_id = props["GatewayIdentifier"]
    policy_document = props["PolicyDocument"]
    description = props.get("Description", "Cedar policy for AgentCore Gateway")

    # Delete all policies managed by this Custom Resource.
    # The PhysicalResourceId may contain a stale policy ID if handle_update
    # was called previously (the same PhysicalResourceId is returned to prevent
    # CloudFormation from triggering a cleanup Delete). The helper first tries
    # the ID from PhysicalResourceId, then lists and deletes all policies
    # matching the managed naming convention to clean up any leftovers from
    # prior updates.
    _delete_managed_policies(policy_engine_id, old_policy_id, props)

    # Create new policy
    engine_name = props["PolicyEngineName"]
    policy_name = f"{engine_name}_cedar_policy_{int(time.time())}"
    logger.info(f"Creating new Cedar Policy: {policy_name}")
    policy_response = client.create_policy(
        policyEngineId=policy_engine_id,
        name=policy_name,
        description=description,
        definition={"cedar": {"statement": policy_document}},
    )
    new_policy_id = policy_response["policyId"]
    logger.info(f"New Cedar Policy created: {new_policy_id}")

    # Wait for new policy to become ACTIVE using official waiter
    logger.info(f"Waiting for Cedar Policy {new_policy_id} to become ACTIVE...")
    waiter = client.get_waiter("policy_active")
    waiter.wait(policyEngineId=policy_engine_id, policyId=new_policy_id)
    logger.info(f"Cedar Policy {new_policy_id} is now ACTIVE")

    # Verify the Policy Engine is still attached to the Gateway.
    # A previous failed deployment rollback or manual change may have detached it.
    logger.info("Verifying Policy Engine is attached to Gateway...")
    gateway = client.get_gateway(gatewayIdentifier=gateway_id)
    pe_config = gateway.get("policyEngineConfiguration") or {}

    if not pe_config.get("arn"):
        # Policy Engine is detached — re-attach it
        logger.warning("Policy Engine is detached from Gateway — re-attaching...")
        engine_details = client.get_policy_engine(policyEngineId=policy_engine_id)
        policy_engine_arn = engine_details["policyEngineArn"]
        _attach_policy_engine_to_gateway(gateway_id, policy_engine_arn)
        logger.info("Policy Engine re-attached to Gateway successfully")
    else:
        logger.info("Policy Engine is attached to Gateway")

    # CRITICAL: Return the SAME PhysicalResourceId as the original resource.
    # Returning a new ID (e.g., with new_policy_id) causes CloudFormation to
    # interpret the change as a resource replacement and call Delete on the old
    # physical ID, which detaches the Policy Engine from the Gateway. The new
    # policy ID is passed in Data attributes instead for CfnOutput access.
    return {
        "PhysicalResourceId": event["PhysicalResourceId"],
        "Data": {
            "PolicyEngineId": policy_engine_id,
            "PolicyId": new_policy_id,
        },
    }


def handle_delete(event: dict, props: dict) -> dict:
    """
    Detach Policy Engine from Gateway, delete all managed Cedar Policies,
    and delete the Policy Engine.

    Steps:
      1. Detach Policy Engine from Gateway -> wait for READY
      2. Delete all managed Cedar Policies (handles stale IDs from prior updates)
      3. Delete Policy Engine

    Args:
        event: CloudFormation event.
        props: ResourceProperties from CloudFormation event.

    Returns:
        Response with PhysicalResourceId.
    """
    physical_id = event["PhysicalResourceId"]
    gateway_id = props["GatewayIdentifier"]

    # Parse the physical ID — may not contain "|" if Create failed partway
    if "|" in physical_id:
        policy_engine_id, policy_id = physical_id.split("|")
    else:
        logger.warning(f"Unexpected PhysicalResourceId format: {physical_id}")
        return {"PhysicalResourceId": physical_id}

    # Step 1: Detach Policy Engine from Gateway
    logger.info(f"Detaching Policy Engine from Gateway: {gateway_id}")
    try:
        gateway = client.get_gateway(gatewayIdentifier=gateway_id)
        # Omit policyEngineConfiguration entirely to detach
        client.update_gateway(
            gatewayIdentifier=gateway_id,
            name=gateway.get("name"),
            roleArn=gateway.get("roleArn"),
            protocolType=gateway.get("protocolType", "MCP"),
            authorizerType=gateway.get("authorizerType", "CUSTOM_JWT"),
            authorizerConfiguration=gateway.get("authorizerConfiguration"),
        )
        _wait_for_gateway_ready(gateway_id)
        logger.info("Policy Engine detached from Gateway")
    except Exception as e:
        logger.warning(f"Could not detach Policy Engine from Gateway: {e}")

    # Step 2: Delete all Cedar Policies managed by this Custom Resource.
    _delete_managed_policies(policy_engine_id, policy_id, props)

    # Step 3: Delete Policy Engine
    logger.info(f"Deleting Policy Engine: {policy_engine_id}")
    try:
        client.delete_policy_engine(policyEngineId=policy_engine_id)
        waiter = client.get_waiter("policy_engine_deleted")
        waiter.wait(policyEngineId=policy_engine_id)
        logger.info(f"Policy Engine deleted: {policy_engine_id}")
    except Exception as e:
        logger.warning(f"Could not delete Policy Engine {policy_engine_id}: {e}")

    return {"PhysicalResourceId": physical_id}


def _delete_managed_policies(
    policy_engine_id: str, known_policy_id: str, props: dict
) -> None:
    """
    Delete all Cedar policies managed by this Custom Resource.

    First tries to delete the known policy ID (from PhysicalResourceId). Then
    lists all policies in the engine and deletes any matching the managed
    naming convention. This handles stale IDs from prior updates and ensures no
    orphaned policies remain.

    Args:
        policy_engine_id: The Policy Engine identifier.
        known_policy_id: The policy ID from PhysicalResourceId (may be stale).
        props: ResourceProperties containing PolicyEngineName.
    """
    engine_name = props.get("PolicyEngineName", "")

    # Try deleting the known policy ID first
    logger.info(f"Deleting Cedar Policy: {known_policy_id}")
    try:
        client.delete_policy(
            policyEngineId=policy_engine_id,
            policyId=known_policy_id,
        )
        waiter = client.get_waiter("policy_deleted")
        waiter.wait(policyEngineId=policy_engine_id, policyId=known_policy_id)
        logger.info(f"Policy deleted: {known_policy_id}")
    except client.exceptions.ResourceNotFoundException:
        logger.warning(f"Policy {known_policy_id} not found (stale ID)")
    except Exception as e:
        logger.warning(f"Could not delete policy {known_policy_id}: {e}")

    # List and delete any remaining policies matching the managed naming
    # convention. This catches policies left behind by prior updates where the
    # PhysicalResourceId contained a stale ID.
    try:
        policies = client.list_policies(policyEngineId=policy_engine_id)
        for p in policies.get("policies", []):
            p_id = p["policyId"]
            p_name = p.get("name", "")
            if p_name.startswith(f"{engine_name}_cedar_policy"):
                logger.info(f"Deleting remaining policy: {p_id} ({p_name})")
                try:
                    client.delete_policy(
                        policyEngineId=policy_engine_id,
                        policyId=p_id,
                    )
                    waiter = client.get_waiter("policy_deleted")
                    waiter.wait(policyEngineId=policy_engine_id, policyId=p_id)
                    logger.info(f"Policy deleted: {p_id}")
                except Exception as e:
                    logger.warning(f"Could not delete policy {p_id}: {e}")
    except Exception as e:
        logger.warning(f"Could not list policies in engine: {e}")


def _attach_policy_engine_to_gateway(gateway_id: str, policy_engine_arn: str) -> None:
    """
    Attach a Policy Engine to a Gateway and wait for the Gateway to become READY.

    Args:
        gateway_id: The Gateway identifier.
        policy_engine_arn: The Policy Engine ARN to attach.
    """
    logger.info(f"Attaching Policy Engine {policy_engine_arn} to Gateway {gateway_id}")

    gateway = client.get_gateway(gatewayIdentifier=gateway_id)

    client.update_gateway(
        gatewayIdentifier=gateway_id,
        name=gateway.get("name"),
        roleArn=gateway.get("roleArn"),
        protocolType=gateway.get("protocolType", "MCP"),
        authorizerType=gateway.get("authorizerType", "CUSTOM_JWT"),
        authorizerConfiguration=gateway.get("authorizerConfiguration"),
        policyEngineConfiguration={
            "arn": policy_engine_arn,
            "mode": "ENFORCE",
        },
    )

    _wait_for_gateway_ready(gateway_id)
    logger.info("Policy Engine attached to Gateway successfully")


def _wait_for_gateway_ready(gateway_id: str) -> None:
    """
    Poll until the Gateway reaches READY status.

    This uses a custom polling loop as the boto3 SDK provides official waiters
    for Policy Engine and Policy operations (policy_engine_active,
    policy_engine_deleted, policy_active, policy_deleted) but not for Gateway
    status changes.

    Args:
        gateway_id: The Gateway identifier to poll.

    Raises:
        RuntimeError: If the gateway fails or times out.
    """
    logger.info(f"Waiting for Gateway {gateway_id} to become READY...")
    start_time = time.time()

    while time.time() - start_time < GATEWAY_TIMEOUT_SECONDS:
        gateway = client.get_gateway(gatewayIdentifier=gateway_id)
        status = gateway.get("status")
        logger.info(f"Gateway status: {status}")

        if status == "READY":
            return

        if status in ("FAILED", "UPDATE_UNSUCCESSFUL"):
            raise RuntimeError(f"Gateway reached terminal state: {status}")

        time.sleep(GATEWAY_POLL_INTERVAL_SECONDS)

    raise RuntimeError(
        f"Gateway {gateway_id} did not become READY within {GATEWAY_TIMEOUT_SECONDS}s"
    )
