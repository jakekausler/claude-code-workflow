import { useReactFlow } from '@xyflow/react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

export function GraphControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
      <button
        onClick={() => zoomIn()}
        className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
        title="Zoom in"
      >
        <ZoomIn size={14} />
      </button>
      <button
        onClick={() => zoomOut()}
        className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
        title="Zoom out"
      >
        <ZoomOut size={14} />
      </button>
      <button
        onClick={() => fitView({ padding: 0.1 })}
        className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
        title="Fit view"
      >
        <Maximize2 size={14} />
      </button>
    </div>
  );
}
