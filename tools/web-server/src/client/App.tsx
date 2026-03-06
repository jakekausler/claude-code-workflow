import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/layout/Layout.js';
import { Dashboard } from './pages/Dashboard.js';
import { Board } from './pages/Board.js';
import { EpicDetail } from './pages/EpicDetail.js';
import { TicketDetail } from './pages/TicketDetail.js';
import { StageDetail } from './pages/StageDetail.js';
import { SessionDetail } from './pages/SessionDetail.js';
import { DependencyGraph } from './pages/DependencyGraph.js';
import { Settings } from './pages/Settings.js';
import { BranchHierarchy } from './pages/BranchHierarchy.js';
import { ImportIssues } from './pages/ImportIssues.js';
import { TeamManagement } from './pages/TeamManagement.js';
import { TeamDetail } from './pages/TeamDetail.js';
import { useInteractionSSE } from './api/interaction-hooks.js';
import { useSessionMap } from './api/use-session-map.js';
import { InteractionOverlay } from './components/interaction/InteractionOverlay.js';
import { GlobalSearch } from './components/search/GlobalSearch.js';
import { AuthProvider, useAuthContext } from './components/AuthProvider.js';
import { LoginPage } from './components/LoginPage.js';

/**
 * Gate component: in hosted mode, requires authentication before
 * rendering children. In local mode, renders children directly.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const deploymentMode = (window as unknown as { __DEPLOYMENT_MODE__?: string }).__DEPLOYMENT_MODE__;

  // Local mode: no auth required
  if (deploymentMode !== 'hosted') {
    return <>{children}</>;
  }

  // Hosted mode: check authentication
  const { isAuthenticated } = useAuthContext();
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <>{children}</>;
}

function AppContent() {
  // Hooks that require QueryClientProvider context must live here, not in App()
  useInteractionSSE();
  useSessionMap();

  return (
    <>
      <InteractionOverlay />
      <GlobalSearch />
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/board" element={<Board />} />
            <Route path="/epics" element={<Navigate to="/board" replace />} />
            <Route path="/epics/:epicId" element={<EpicDetail />} />
            <Route path="/epics/:epicId/tickets" element={<Navigate to="/board" replace />} />
            <Route
              path="/epics/:epicId/tickets/:ticketId/stages"
              element={<Navigate to="/board" replace />}
            />
            <Route path="/tickets/:ticketId" element={<TicketDetail />} />
            <Route path="/stages/:stageId" element={<StageDetail />} />
            <Route
              path="/sessions/:projectId/:sessionId"
              element={<SessionDetail />}
            />
            <Route path="/graph" element={<DependencyGraph />} />
            <Route path="/branches" element={<BranchHierarchy />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/teams" element={<TeamManagement />} />
            <Route path="/teams/:teamId" element={<TeamDetail />} />
            <Route path="/import" element={<ImportIssues />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </>
  );
}

export function App() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate>
          <AppContent />
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}
