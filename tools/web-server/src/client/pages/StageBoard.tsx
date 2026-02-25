import { useParams } from 'react-router-dom';

export function StageBoard() {
  const { epicId, ticketId } = useParams<{
    epicId: string;
    ticketId: string;
  }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">
        Stage Pipeline Board
      </h1>
      <p className="mt-2 text-slate-600">
        Stages for ticket{' '}
        <code className="rounded bg-slate-200 px-1">{ticketId}</code> in epic{' '}
        <code className="rounded bg-slate-200 px-1">{epicId}</code>
      </p>
    </div>
  );
}
