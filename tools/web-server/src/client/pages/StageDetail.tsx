import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDrawerStore } from '../store/drawer-store.js';

export function StageDetail() {
  const { stageId } = useParams<{ stageId: string }>();
  const navigate = useNavigate();
  const { setStack } = useDrawerStore();

  useEffect(() => {
    if (stageId) {
      setStack([{ type: 'stage', id: stageId }]);
    }
    navigate('/board', { replace: true });
  }, [stageId, setStack, navigate]);

  return null;
}
