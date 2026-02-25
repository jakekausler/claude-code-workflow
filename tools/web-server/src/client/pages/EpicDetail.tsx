import { useParams } from 'react-router-dom';

export function EpicDetail() {
  const { epicId } = useParams<{ epicId: string }>();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Epic Detail</h1>
      <p className="mt-2 text-slate-600">
        Details for <code className="rounded bg-slate-200 px-1">{epicId}</code>
      </p>
    </div>
  );
}
