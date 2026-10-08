"""Personal project collections: a per-user, folder-like grouping of
projects for dashboard organization (Plan.md §9 Phase 13). Purely cosmetic
filing — see Membership.collection — never shared with co-authors.
"""

import uuid

from django.db import IntegrityError
from django.db.models import Count
from django.shortcuts import get_object_or_404
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.auth import SessionAuth
from core.session import get_current_user

from .models import ProjectCollection

router = Router(auth=SessionAuth())


class ProjectCollectionOut(Schema):
    id: uuid.UUID
    name: str
    created_at: str
    project_count: int


def _collection_out(collection: ProjectCollection) -> ProjectCollectionOut:
    return ProjectCollectionOut(
        id=collection.id,
        name=collection.name,
        created_at=collection.created_at.isoformat(),
        project_count=collection.project_count,
    )


@router.get("/collections", response=list[ProjectCollectionOut])
def list_collections(request):
    user = get_current_user(request)
    collections = (
        ProjectCollection.objects.filter(owner=user)
        .annotate(project_count=Count("memberships"))
        .order_by("created_at")
    )
    return [_collection_out(c) for c in collections]


class ProjectCollectionCreateIn(Schema):
    name: str


@router.post("/collections", response=ProjectCollectionOut)
def create_collection(request, payload: ProjectCollectionCreateIn):
    user = get_current_user(request)
    name = payload.name.strip()
    if not name:
        raise HttpError(400, "Collection name is required.")
    try:
        collection = ProjectCollection.objects.create(owner=user, name=name)
    except IntegrityError:
        raise HttpError(409, "You already have a collection with that name.")
    collection.project_count = 0
    return _collection_out(collection)


@router.delete("/collections/{collection_id}")
def delete_collection(request, collection_id: uuid.UUID):
    user = get_current_user(request)
    collection = get_object_or_404(ProjectCollection, id=collection_id, owner=user)
    collection.delete()
    return {"detail": "deleted"}
