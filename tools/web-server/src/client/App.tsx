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
import { useInteractionSSE } from './api/interaction-hooks.js';
import { useSessionMap } from './api/use-session-map.js';
import { InteractionOverlay } from './components/interaction/InteractionOverlay.js';

function AppContent() {
  return (
    <>
      <InteractionOverlay />
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
          </Routes>
        </Layout>
      </BrowserRouter>
    </>
  );
}

export function App() {
  const [queryClient] = useState(() => new QueryClient());

  // Mount the interaction SSE listener at the app root level
  useInteractionSSE();

  // Global SSE subscription for session status — active on all pages
  useSessionMap();

  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
