# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Presigned URL Lambda for Order Upload

Generates presigned URLs for secure Excel file uploads with:
- Content-MD5 checksum for data integrity verification
- UUID-based filename replacement (path traversal protection)
- 5-minute expiration (AWS recommended)
"""

import base64
import hashlib
import json
import logging
import os
import uuid

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")
TEMP_BUCKET = os.environ.get("TEMP_BUCKET")

# Allowed file extensions
ALLOWED_EXTENSIONS = {".xlsx", ".xls"}

# Maximum file size (10MB)
MAX_FILE_SIZE = 10 * 1024 * 1024


def get_cors_headers(origin: str = "*") -> dict:
    """Return CORS headers for the response."""
    allowed_origins = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
    origins = [o.strip() for o in allowed_origins.split(",")]

    # Check if the request origin is allowed
    response_origin = origin if origin in origins else origins[0]

    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": response_origin,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }


def validate_file_extension(filename: str) -> bool:
    """Validate that the file has an allowed extension."""
    if not filename:
        return False
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_EXTENSIONS


def handler(event, context):
    """
    POST /orders/presigned-url

    Request Body:
        {
            "fileName": "order.xlsx",
            "fileContent": "<base64-encoded-content>"
        }

    Response (200):
        {
            "presignedUrl": "https://...",
            "tempKey": "temp/<uuid>/<safe-filename>",
            "contentMd5": "<base64-md5>",
            "originalFileName": "order.xlsx"
        }

    Security features:
    - Filename replaced with UUID (path traversal protection)
    - Content-MD5 checksum (data integrity)
    - 5-minute expiration (AWS best practice)
    """
    logger.info("Presigned URL request received")

    # Get origin for CORS
    headers = event.get("headers", {}) or {}
    origin = headers.get("origin", headers.get("Origin", "*"))

    # Handle OPTIONS request
    if event.get("httpMethod") == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": get_cors_headers(origin),
            "body": "",
        }

    try:
        # Validate environment
        if not TEMP_BUCKET:
            logger.error("TEMP_BUCKET environment variable not set")
            return {
                "statusCode": 500,
                "headers": get_cors_headers(origin),
                "body": json.dumps({"error": "Server configuration error"}),
            }

        # Parse request body
        body = json.loads(event.get("body", "{}"))
        original_file_name = body.get("fileName")
        file_content_b64 = body.get("fileContent")

        # Validate required fields
        if not original_file_name or not file_content_b64:
            return {
                "statusCode": 400,
                "headers": get_cors_headers(origin),
                "body": json.dumps({"error": "Missing required fields: fileName and fileContent"}),
            }

        # Validate file extension
        if not validate_file_extension(original_file_name):
            return {
                "statusCode": 400,
                "headers": get_cors_headers(origin),
                "body": json.dumps({"error": "Invalid file type. Only .xlsx and .xls files are allowed."}),
            }

        # Decode file content
        try:
            file_content = base64.b64decode(file_content_b64)
        except Exception:
            return {
                "statusCode": 400,
                "headers": get_cors_headers(origin),
                "body": json.dumps({"error": "Invalid base64 encoding"}),
            }

        # Validate file size
        if len(file_content) > MAX_FILE_SIZE:
            return {
                "statusCode": 400,
                "headers": get_cors_headers(origin),
                "body": json.dumps({"error": f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB"}),
            }

        # Security: Replace filename with UUID (path traversal protection)
        file_extension = os.path.splitext(original_file_name)[1].lower()
        safe_file_name = f"{uuid.uuid4()}{file_extension}"
        temp_key = f"temp/{uuid.uuid4()}/{safe_file_name}"

        # Calculate Content-MD5 checksum (data integrity verification)
        content_md5 = base64.b64encode(hashlib.md5(file_content).digest()).decode()

        # Determine content type
        content_type = (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            if file_extension == ".xlsx"
            else "application/vnd.ms-excel"
        )

        # Upload to temporary bucket
        logger.info(f"Uploading to s3://{TEMP_BUCKET}/{temp_key}")
        s3_client.put_object(
            Bucket=TEMP_BUCKET,
            Key=temp_key,
            Body=file_content,
            ContentType=content_type,
            ContentMD5=content_md5,
            Metadata={
                "original-filename": original_file_name[:255],  # Limit metadata length
                "upload-source": "order-upload-ui",
            },
        )

        # Generate GET presigned URL (5 minutes expiration - AWS recommended)
        presigned_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": TEMP_BUCKET, "Key": temp_key},
            ExpiresIn=300,  # 5 minutes
        )

        logger.info(f"Presigned URL generated successfully for {temp_key}")

        return {
            "statusCode": 200,
            "headers": get_cors_headers(origin),
            "body": json.dumps({
                "presignedUrl": presigned_url,
                "tempKey": temp_key,
                "contentMd5": content_md5,
                "originalFileName": original_file_name,
            }),
        }

    except ClientError as e:
        logger.error(f"S3 error: {e}")
        return {
            "statusCode": 500,
            "headers": get_cors_headers(origin),
            "body": json.dumps({"error": "Failed to upload file"}),
        }
    except json.JSONDecodeError:
        return {
            "statusCode": 400,
            "headers": get_cors_headers(origin),
            "body": json.dumps({"error": "Invalid JSON in request body"}),
        }
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return {
            "statusCode": 500,
            "headers": get_cors_headers(origin),
            "body": json.dumps({"error": "Internal server error"}),
        }
