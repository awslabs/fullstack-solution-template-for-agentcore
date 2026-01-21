# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Order Tools Lambda for AgentCore Gateway.

Provides inventory check and order backlog query tools for the order audit agent.
These are mock implementations for demonstration purposes.

Tools:
- check_inventory: Check stock levels for product codes
- query_order_backlog: Query customer backlog information
"""

import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Mock inventory data (in production, this would query a real inventory system)
MOCK_INVENTORY = {
    "PRD-001": {"product_name": "Widget A", "available": 500, "reserved": 100, "unit": "pcs"},
    "PRD-002": {"product_name": "Widget B", "available": 30, "reserved": 10, "unit": "pcs"},
    "PRD-003": {"product_name": "Component X", "available": 1000, "reserved": 200, "unit": "pcs"},
    "PRD-004": {"product_name": "Component Y", "available": 0, "reserved": 50, "unit": "pcs"},
    "PRD-005": {"product_name": "Assembly Z", "available": 150, "reserved": 25, "unit": "sets"},
}

# Mock backlog data (in production, this would query a real order management system)
MOCK_BACKLOG = {
    "CUST-001": {
        "customer_name": "ABC Corporation",
        "backlog": [
            {"order_id": "ORD-2024-001", "amount": 50000, "due_date": "2025-02-01", "status": "pending"},
            {"order_id": "ORD-2024-005", "amount": 25000, "due_date": "2025-02-15", "status": "processing"},
        ],
    },
    "CUST-002": {
        "customer_name": "XYZ Trading",
        "backlog": [
            {"order_id": "ORD-2024-003", "amount": 100000, "due_date": "2025-01-30", "status": "overdue"},
        ],
    },
    "CUST-003": {
        "customer_name": "DEF Industries",
        "backlog": [],  # No backlog
    },
}


def check_inventory(product_codes: list) -> dict:
    """
    Check inventory levels for the specified product codes.

    Args:
        product_codes: List of product codes to check

    Returns:
        Dictionary containing inventory status for each product
    """
    logger.info(f"Checking inventory for: {product_codes}")

    results = []
    for code in product_codes:
        if code in MOCK_INVENTORY:
            inventory = MOCK_INVENTORY[code]
            results.append({
                "product_code": code,
                "product_name": inventory["product_name"],
                "available": inventory["available"],
                "reserved": inventory["reserved"],
                "net_available": inventory["available"] - inventory["reserved"],
                "unit": inventory["unit"],
                "status": "in_stock" if inventory["available"] > inventory["reserved"] else "out_of_stock",
            })
        else:
            results.append({
                "product_code": code,
                "product_name": "Unknown",
                "available": 0,
                "reserved": 0,
                "net_available": 0,
                "unit": "N/A",
                "status": "not_found",
            })

    summary = {
        "total_products": len(results),
        "in_stock": sum(1 for r in results if r["status"] == "in_stock"),
        "out_of_stock": sum(1 for r in results if r["status"] == "out_of_stock"),
        "not_found": sum(1 for r in results if r["status"] == "not_found"),
    }

    return {
        "inventory_check_results": results,
        "summary": summary,
    }


def query_order_backlog(customer_id: str) -> dict:
    """
    Query order backlog information for a customer.

    Args:
        customer_id: Customer ID to query

    Returns:
        Dictionary containing backlog information for the customer
    """
    logger.info(f"Querying backlog for customer: {customer_id}")

    if customer_id in MOCK_BACKLOG:
        customer_data = MOCK_BACKLOG[customer_id]
        backlog = customer_data["backlog"]

        total_amount = sum(order["amount"] for order in backlog)
        overdue_count = sum(1 for order in backlog if order["status"] == "overdue")

        return {
            "customer_id": customer_id,
            "customer_name": customer_data["customer_name"],
            "backlog_orders": backlog,
            "summary": {
                "total_orders": len(backlog),
                "total_amount": total_amount,
                "overdue_orders": overdue_count,
                "has_backlog": len(backlog) > 0,
            },
        }
    else:
        return {
            "customer_id": customer_id,
            "customer_name": "Unknown",
            "backlog_orders": [],
            "summary": {
                "total_orders": 0,
                "total_amount": 0,
                "overdue_orders": 0,
                "has_backlog": False,
            },
            "note": "Customer not found in system",
        }


def handler(event, context):
    """
    Order Tools Lambda handler for AgentCore Gateway.

    This Lambda implements two tools:
    - check_inventory: Check stock levels for product codes
    - query_order_backlog: Query customer backlog information

    Args:
        event: Tool arguments passed directly from gateway
        context: Lambda context with AgentCore metadata in client_context.custom

    Returns:
        dict: Response object with 'content' array or 'error' string
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        # Get tool name from context and strip the target prefix
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter):]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "check_inventory":
            product_codes = event.get("product_codes", [])
            if not product_codes:
                return {"error": "product_codes is required and cannot be empty"}

            result = check_inventory(product_codes)
            return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}

        elif tool_name == "query_order_backlog":
            customer_id = event.get("customer_id")
            if not customer_id:
                return {"error": "customer_id is required"}

            result = query_order_backlog(customer_id)
            return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}

        else:
            logger.error(f"Unexpected tool name: {tool_name}")
            return {
                "error": f"Unknown tool: {tool_name}. This Lambda supports 'check_inventory' and 'query_order_backlog'"
            }

    except KeyError as e:
        logger.error(f"Missing required field: {e}")
        return {"error": f"Missing required field: {e}"}
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return {"error": f"Internal server error: {str(e)}"}
