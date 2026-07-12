"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path
from ninja import NinjaAPI

from accounts.admin_api import router as admin_router
from accounts.api import router as accounts_router
from accounts.setup_api import router as setup_router
from accounts.sso_admin_api import router as sso_admin_router
from accounts.sso_api import router as sso_router
from health.views import router as health_router
from projects.api import router as projects_router
from projects.bibliography_api import router as bibliography_router
from projects.collab_api import internal_router as collab_internal_router
from projects.collab_api import router as collab_router
from projects.comments_api import router as comments_router
from projects.compile_api import router as compile_router
from projects.files_api import router as files_router
from projects.versions_api import router as versions_router

api = NinjaAPI(title="FreeLeaf API")
api.add_router("", health_router)
api.add_router("", accounts_router)
api.add_router("", projects_router)
api.add_router("", files_router)
api.add_router("", compile_router)
api.add_router("", collab_router)
api.add_router("", collab_internal_router)
api.add_router("", bibliography_router)
api.add_router("", admin_router)
api.add_router("", versions_router)
api.add_router("", comments_router)
api.add_router("", sso_router)
api.add_router("", sso_admin_router)
api.add_router("", setup_router)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', api.urls),
]
