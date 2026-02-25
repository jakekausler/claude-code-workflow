import { useParams } from 'react-router-dom';

export function TicketDetail() {
  const { ticketId } = useParams<{ ticketId: string }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Ticket Detail</h1>
      <p className="mt-2 text-slate-600">
        Details for{' '}
        <code className="rounded bg-slate-200 px-1">{ticketId}</code>
      </p>
    </div>
  );
}
