import { useDrawerStore } from '../../store/drawer-store.js';
import { DetailDrawer } from './DetailDrawer.js';
import { EpicDetailContent } from './EpicDetailContent.js';
import { TicketDetailContent } from './TicketDetailContent.js';
import { StageDetailContent } from './StageDetailContent.js';
import { useEpic, useTicket, useStage } from '../../api/hooks.js';
import type { DrawerEntry } from '../../store/drawer-store.js';

export function DrawerHost() {
  const { stack } = useDrawerStore();

  if (stack.length === 0) return null;

  const current = stack[stack.length - 1];

  return <DrawerContent entry={current} />;
}

function DrawerContent({ entry }: { entry: DrawerEntry }) {
  const title = useDrawerTitle(entry.type, entry.id);

  return (
    <DetailDrawer title={title} subtitle={entry.id}>
      {entry.type === 'epic' && <EpicDetailContent epicId={entry.id} />}
      {entry.type === 'ticket' && <TicketDetailContent ticketId={entry.id} />}
      {entry.type === 'stage' && <StageDetailContent stageId={entry.id} />}
    </DetailDrawer>
  );
}

/**
 * Extracts a display title for the drawer header.
 * Uses `enabled` option to only fetch the relevant entity type.
 * React Query deduplicates with the content component's fetch.
 */
function useDrawerTitle(type: DrawerEntry['type'], id: string): string {
  const epicQuery = useEpic(id, { enabled: type === 'epic' });
  const ticketQuery = useTicket(id, { enabled: type === 'ticket' });
  const stageQuery = useStage(id, { enabled: type === 'stage' });

  if (type === 'epic') return epicQuery.data?.title ?? 'Epic';
  if (type === 'ticket') return ticketQuery.data?.title ?? 'Ticket';
  if (type === 'stage') return stageQuery.data?.title ?? 'Stage';
  return id;
}
