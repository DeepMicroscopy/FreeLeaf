from django.contrib import admin

from .models import MagicLink, User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("id", "kind", "email", "orcid_id", "display_name", "created_at")
    list_filter = ("kind",)
    search_fields = ("email", "orcid_id", "display_name")


@admin.register(MagicLink)
class MagicLinkAdmin(admin.ModelAdmin):
    list_display = ("email", "expires_at", "used_at", "created_at")
    search_fields = ("email",)
