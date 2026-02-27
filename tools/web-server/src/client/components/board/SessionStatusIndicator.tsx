export interface SessionStatusProps {
  status: {
    status: 'starting' | 'active' | 'ended';
    waitingType: 'user_input' | 'permission' | 'idle' | null;
  } | null;
  compact?: boolean;
}

interface IndicatorConfig {
  dotClass: string;
  label: string | null;
}

function getIndicatorConfig(
  sessionStatus: 'starting' | 'active' | 'ended',
  waitingType: 'user_input' | 'permission' | 'idle' | null,
): IndicatorConfig {
  if (waitingType === 'user_input') {
    return { dotClass: 'bg-yellow-500', label: 'Needs input' };
  }
  if (waitingType === 'permission') {
    return { dotClass: 'bg-blue-500', label: 'Needs approval' };
  }
  if (waitingType === 'idle') {
    return { dotClass: 'bg-gray-400', label: null };
  }
  // No waitingType — use session status
  if (sessionStatus === 'starting') {
    return { dotClass: 'bg-green-500', label: null };
  }
  // active with no waiting
  return { dotClass: 'bg-green-500 animate-pulse', label: null };
}

export { getIndicatorConfig };

export function SessionStatusIndicator({
  status,
  compact = false,
}: SessionStatusProps) {
  if (!status || status.status === 'ended') return null;

  const { dotClass, label } = getIndicatorConfig(status.status, status.waitingType);

  return (
    <div className="flex items-center gap-1.5">
      <span
        data-testid="session-indicator"
        className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
      />
      {label && !compact && <span className="text-xs text-zinc-400">{label}</span>}
    </div>
  );
}
