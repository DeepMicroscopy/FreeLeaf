import { Navigate, Route, Routes } from "react-router-dom";
import { BrowserRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { ToastProvider } from "./components/ui/Toast";
import { AuthProvider, useAuth } from "./lib/auth";
import { PageSpinner } from "./components/ui/Spinner";
import { JoinPage } from "./routes/JoinPage";
import { LoginPage } from "./routes/LoginPage";
import { MagicLinkCallbackPage } from "./routes/MagicLinkCallbackPage";
import { ProjectsPage } from "./routes/ProjectsPage";
import { ProjectWorkspace } from "./routes/ProjectWorkspace";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (user) return <Navigate to="/projects" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route path="/auth/magic-link" element={<MagicLinkCallbackPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route
        path="/projects"
        element={
          <RequireAuth>
            <ProjectsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/*"
        element={
          <RequireAuth>
            <ProjectWorkspace />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
