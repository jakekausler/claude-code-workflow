import { CodeBlockViewer } from './CodeBlockViewer.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function WriteRenderer({ execution }: Props) {
  const { input } = execution;
  const filePath = (input.file_path as string) ?? 'unknown';
  const content = input.content as string | undefined;

  if (!content) return null;

  return (
    <CodeBlockViewer
      fileName={filePath}
      content={content.replace(/\n$/, '')}
    />
  );
}
