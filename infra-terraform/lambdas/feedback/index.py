# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Feedback API Lambda Handler"""

import os
import time
import uuid
from typing import Any, Dict, Literal, Optional

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.event_handler import APIGatewayRestResolver, CORSConfig
from aws_lambda_powertools.logging.correlation_paths import API_GATEWAY_REST
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

# Environment variables
TABLE_NAME = os.environ["TABLE_NAME"]
CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "*")

# Parse CORS origins - can be comma-separated list
cors_origins = [
    origin.strip() for origin in CORS_ALLOWED_ORIGINS.split(",") if origin.strip()
]
primary_origin = cors_origins[0] if cors_origins else "*"
extra_origins = cors_origins[1:] if len(cors_origins) > 1 else None

# Configure CORS
cors_config = CORSConfig(
    allow_origin=primary_origin,
    extra_origins=extra_origins,
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=True,
)

# Initialize DynamoDB client
dynamodb = boto3.client("dynamodb")

tracer = Tracer()
logger = Logger()
app = APIGatewayRestResolver(cors=cors_config)

# Validation constants
MAX_SESSION_ID_LENGTH = 100
MAX_MESSAGE_LENGTH = 5000


class FeedbackRequest(BaseModel):
    """
    Feedback request payload model.

    Accepts camelCase from client but uses snake_case internally.

    Attributes:
        session_id: The conversation session identifier
        message: The agent's response that is receiving feedback (what the AI said)
        feedback_type: Either 'positive' or 'negative'
        comment: User's explanation for their feedback rating (optional)
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,  # Allows population by either snake_case or camelCase
    )

    session_id: str = Field(
        ...,
        min_length=1,
        max_length=MAX_SESSION_ID_LENGTH,
        description="Conversation session identifier",
    )
    message: str = Field(
        ...,
        min_length=1,
        max_length=MAX_MESSAGE_LENGTH,
        description="Agent's response being rated",
    )
    feedback_type: Literal["positive", "negative"] = Field(
        ..., description="User's rating of the response"
    )
    comment: Optional[str] = Field(
        None,
        max_length=MAX_MESSAGE_LENGTH,
        description="User's explanation for their rating",
    )

    @field_validator("session_id")
    @classmethod
    def validate_session_id_format(cls, v: str) -> str:
        """
        Validate session_id contains only alphanumeric characters, hyphens, and underscores.

        Args:
            v: Session ID value to validate

        Returns:
            Validated session ID

        Raises:
            ValueError: If session ID contains invalid characters
        """
        if not v.replace("-", "").replace("_", "").isalnum():
            raise ValueError(
                "sessionId must contain only alphanumeric characters, hyphens, and underscores"
            )
        return v


@app.post("/feedback")
def submit_feedback() -> Dict[str, Any]:
    """
    Handle POST /feedback endpoint.

    Returns:
        Response with feedback ID on success
    """
    try:
        # Parse and validate request body using Pydantic
        feedback_data = FeedbackRequest(**app.current_event.json_body)

        # Extract user ID from Cognito claims
        request_context = app.current_event.request_context
        authorizer = request_context.authorizer
        claims = authorizer.get("claims", {}) if authorizer else {}

        if not claims:
            return {"error": "Unauthorized"}, 401

        user_id = claims.get("sub") or "unknown"

        # Generate feedback ID and timestamp
        feedback_id = str(uuid.uuid4())
        timestamp = int(time.time() * 1000)  # Milliseconds since epoch

        # Save to DynamoDB
        item = {
            "feedbackId": {"S": feedback_id},
            "sessionId": {"S": feedback_data.session_id},
            "message": {"S": feedback_data.message},  # Agent's response being rated
            "userId": {"S": user_id},
            "feedbackType": {"S": feedback_data.feedback_type},
            "timestamp": {"N": str(timestamp)},
        }

        # Add optional comment field if provided
        if feedback_data.comment:
            item["comment"] = {
                "S": feedback_data.comment
            }  # User's explanation for their rating

        dynamodb.put_item(TableName=TABLE_NAME, Item=item)

        return {
            "success": True,
            "feedbackId": feedback_id,
        }

    except ValueError as e:
        logger.warning(f"Validation error: {str(e)}")
        return {"error": str(e)}, 400

    except ClientError as e:
        logger.error(f"DynamoDB error: {e.response['Error']['Message']}")
        return {"error": "Internal server error"}, 500

    except Exception as e:
        logger.error(f"Error saving feedback: {str(e)}")
        return {"error": "Internal server error"}, 500


@logger.inject_lambda_context(correlation_id_path=API_GATEWAY_REST)
def handler(event: dict, context: LambdaContext) -> dict:
    """
    Lambda handler for feedback API.

    Args:
        event: API Gateway event
        context: Lambda context

    Returns:
        API Gateway response
    """
    return app.resolve(event, context)
