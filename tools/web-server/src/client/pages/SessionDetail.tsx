import { useParams } from 'react-router-dom';

export function SessionDetail() {
  const { projectId, sessionId } = useParams<{
    projectId: string;
    sessionId: string;
  }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Session Detail</h1>
      <p className="mt-2 text-slate-600">
        Session{' '}
        <code className="rounded bg-slate-200 px-1">{sessionId}</code> in
        project{' '}
        <code className="rounded bg-slate-200 px-1">{projectId}</code>
      </p>
    </div>
  );
}
