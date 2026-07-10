"""S3-compatible object storage abstraction (Plan.md §4: "Local FS (dev)
behind an S3-compatible abstraction; MinIO for self-host").

MinIO speaks the S3 API, so a plain boto3 client pointed at its endpoint
works for both dev and self-hosted deployments without a MinIO-specific
SDK — the same code would work unmodified against real AWS S3.

Storage keys are always server-generated opaque strings (see
projects.files.storage_key_for), never derived from user-controlled paths,
so this module doesn't need to defend against path traversal itself.
"""

import os
import threading

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

BUCKET = os.environ.get("MINIO_BUCKET", "freeleaf")

_bucket_ready = False
_bucket_lock = threading.Lock()


def _client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("MINIO_ENDPOINT", "http://minio:9000"),
        aws_access_key_id=os.environ.get("MINIO_ROOT_USER", "freeleaf"),
        aws_secret_access_key=os.environ.get("MINIO_ROOT_PASSWORD", "freeleafsecret"),
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def _ensure_bucket(client) -> None:
    global _bucket_ready
    if _bucket_ready:
        return
    with _bucket_lock:
        if _bucket_ready:
            return
        try:
            client.head_bucket(Bucket=BUCKET)
        except ClientError:
            client.create_bucket(Bucket=BUCKET)
        _bucket_ready = True


def put_object(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    client = _client()
    _ensure_bucket(client)
    client.put_object(Bucket=BUCKET, Key=key, Body=data, ContentType=content_type)


def get_object(key: str) -> bytes:
    client = _client()
    _ensure_bucket(client)
    response = client.get_object(Bucket=BUCKET, Key=key)
    return response["Body"].read()


def delete_object(key: str) -> None:
    client = _client()
    _ensure_bucket(client)
    client.delete_object(Bucket=BUCKET, Key=key)
