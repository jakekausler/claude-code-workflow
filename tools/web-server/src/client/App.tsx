import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/layout/Layout.js';
import { Dashboard } from './pages/Dashboard.js';
import { EpicBoard } from './pages/EpicBoard.js';
import { TicketBoard } from './pages/TicketBoard.js';
import { StageBoard } from './pages/StageBoard.js';
import { EpicDetail } from './pages/EpicDetail.js';
import { TicketDetail } from './pages/TicketDetail.js';
import { StageDetail } from './pages/StageDetail.js';
import { SessionDetail } from './pages/SessionDetail.js';
import { DependencyGraph } from './pages/DependencyGraph.js';

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/epics" element={<EpicBoard />} />
            <Route path="/epics/:epicId" element={<EpicDetail />} />
            <Route path="/epics/:epicId/tickets" element={<TicketBoard />} />
            <Route
              path="/epics/:epicId/tickets/:ticketId/stages"
              element={<StageBoard />}
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
    </QueryClientProvider>
  );
}
