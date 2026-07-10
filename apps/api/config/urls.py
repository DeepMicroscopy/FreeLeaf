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

from accounts.api import router as accounts_router
from health.views import router as health_router
from projects.api import router as projects_router
from projects.files_api import router as files_router

api = NinjaAPI(title="FreeLeaf API")
api.add_router("", health_router)
api.add_router("", accounts_router)
api.add_router("", projects_router)
api.add_router("", files_router)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', api.urls),
]
