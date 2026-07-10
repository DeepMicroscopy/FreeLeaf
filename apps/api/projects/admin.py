from django.contrib import admin

from .models import Membership, Project, ProjectFile, ShareLink


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "owner", "created_at", "updated_at")
    search_fields = ("name",)


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("project", "user", "role", "created_at")
    list_filter = ("role",)


@admin.register(ShareLink)
class ShareLinkAdmin(admin.ModelAdmin):
    list_display = ("id", "project", "role", "expires_at", "created_at")


@admin.register(ProjectFile)
class ProjectFileAdmin(admin.ModelAdmin):
    list_display = ("id", "project", "path", "type", "size", "updated_at")
    list_filter = ("type",)
    search_fields = ("path",)
