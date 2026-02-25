import { Check, AlertCircle } from 'lucide-react';
import { useDrawerStore } from '../../store/drawer-store.js';
import type { DependencyItem } from '../../api/hooks.js';

interface DependencyListProps {
  label: string;
  dependencies: DependencyItem[];
  /** Which end of the dependency to display as the linked item */
  displayField: 'from_id' | 'to_id';
}

export function DependencyList({ label, dependencies, displayField }: DependencyListProps) {
  const { open } = useDrawerStore();

  if (dependencies.length === 0) return null;

  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </h3>
      <ul className="space-y-1">
        {dependencies.map((dep) => {
          const targetId = dep[displayField];
          const targetType = displayField === 'to_id' ? dep.to_type : dep.from_type;
          return (
            <li key={dep.id} className="flex items-center gap-2 text-sm">
              {dep.resolved ? (
                <Check size={14} className="text-green-500" />
              ) : (
                <AlertCircle size={14} className="text-red-500" />
              )}
              <button
                onClick={() => open({ type: targetType as 'epic' | 'ticket' | 'stage', id: targetId })}
                className="text-blue-600 hover:underline"
                aria-label={`Open ${targetType} ${targetId}`}
              >
                {targetId}
              </button>
              <span className="text-xs text-slate-400">
                {dep.resolved ? 'resolved' : 'unresolved'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
