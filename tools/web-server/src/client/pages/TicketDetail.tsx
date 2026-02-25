import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDrawerStore } from '../store/drawer-store.js';

export function TicketDetail() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const navigate = useNavigate();
  const { setStack } = useDrawerStore();

  useEffect(() => {
    if (ticketId) {
      setStack([{ type: 'ticket', id: ticketId }]);
    }
    navigate('/board', { replace: true });
  }, [ticketId, setStack, navigate]);

  return null;
}
