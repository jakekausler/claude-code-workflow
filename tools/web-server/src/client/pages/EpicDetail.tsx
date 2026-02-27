import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDrawerStore } from '../store/drawer-store.js';

export function EpicDetail() {
  const { epicId } = useParams<{ epicId: string }>();
  const navigate = useNavigate();
  const { setStack } = useDrawerStore();

  useEffect(() => {
    if (epicId) {
      setStack([{ type: 'epic', id: epicId }]);
    }
    navigate('/board', { replace: true });
  }, [epicId, setStack, navigate]);

  return null;
}
