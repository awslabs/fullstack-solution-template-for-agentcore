"""Firebase Admin SDK initialization for Docent agent tools."""

import os
import json
import logging
import firebase_admin
from firebase_admin import credentials, firestore, storage

logger = logging.getLogger(__name__)
_app = None


def _get_credentials():
    """Load Firebase credentials from SSM, env var, or file."""
    # 1. SSM Parameter Store (production)
    stack_name = os.environ.get("STACK_NAME")
    if stack_name:
        try:
            import boto3
            ssm = boto3.client("ssm", region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
            resp = ssm.get_parameter(Name=f"/{stack_name}/firebase_credentials", WithDecryption=True)
            return credentials.Certificate(json.loads(resp["Parameter"]["Value"]))
        except Exception as e:
            logger.warning(f"SSM lookup failed: {e}")

    # 2. JSON string env var
    cred_json = os.environ.get("FIREBASE_CREDENTIALS")
    if cred_json:
        return credentials.Certificate(json.loads(cred_json))

    # 3. File path
    cred_path = os.environ.get("FIREBASE_CREDENTIALS_PATH")
    if cred_path:
        return credentials.Certificate(cred_path)

    return credentials.ApplicationDefault()


def get_firestore_client():
    global _app
    if _app is None:
        _app = firebase_admin.initialize_app(_get_credentials(), {
            "storageBucket": "docent-76d5a.firebasestorage.app"
        })
    return firestore.client()


def get_storage_bucket():
    get_firestore_client()
    return storage.bucket()
