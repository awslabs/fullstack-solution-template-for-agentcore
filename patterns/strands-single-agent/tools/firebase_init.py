"""Firebase Admin SDK initialization for Docent agent tools."""

import os
import json
import firebase_admin
from firebase_admin import credentials, firestore, storage

_app = None


def get_firestore_client():
    global _app
    if _app is None:
        cred_path = os.environ.get("FIREBASE_CREDENTIALS_PATH")
        if cred_path:
            cred = credentials.Certificate(cred_path)
        else:
            # Fall back to FIREBASE_CREDENTIALS JSON string (for container env)
            cred_json = os.environ.get("FIREBASE_CREDENTIALS")
            if cred_json:
                cred = credentials.Certificate(json.loads(cred_json))
            else:
                cred = credentials.ApplicationDefault()
        _app = firebase_admin.initialize_app(cred, {
            "storageBucket": "docent-76d5a.firebasestorage.app"
        })
    return firestore.client()


def get_storage_bucket():
    get_firestore_client()  # ensure initialized
    return storage.bucket()
