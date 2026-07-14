from django.contrib import admin

from .models import CompileRun, Membership, Project, ProjectFile, ProjectSettings, ShareLink, Template


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


@admin.register(ProjectSettings)
class ProjectSettingsAdmin(admin.ModelAdmin):
    list_display = ("project", "compiler", "main_doc_path", "central_bib_path")
    list_filter = ("compiler",)


@admin.register(CompileRun)
class CompileRunAdmin(admin.ModelAdmin):
    list_display = ("id", "project", "compiler", "status", "started_at", "duration_ms")
    list_filter = ("status", "compiler")


@admin.register(Template)
class TemplateAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "category", "is_published", "created_by", "created_at")
    list_filter = ("is_published", "category")
    search_fields = ("name", "description")
