import { useState } from 'react';
import { FolderSearch, Folder, FolderOpen, File } from 'lucide-react';
import { extractResultContent } from '../../utils/session-formatters.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  children: TreeNode[];
}

/**
 * Parse a flat list of file paths into a nested tree structure.
 */
export function buildFileTree(files: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isFile: false, children: [] };

  for (const filePath of files) {
    const parts = filePath.replace(/^\//, '').split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');

      let existing = current.children.find((c) => c.name === part);
      if (!existing) {
        existing = { name: part, path, isFile, children: [] };
        current.children.push(existing);
      }
      current = existing;
    }
  }

  return root.children;
}

interface TreeNodeViewProps {
  node: TreeNode;
  depth: number;
}

function TreeNodeView({ node, depth }: TreeNodeViewProps) {
  const [open, setOpen] = useState(true);

  if (node.isFile) {
    return (
      <div
        className="flex items-center gap-1 py-0.5 text-xs font-mono text-slate-700"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <File className="w-3 h-3 shrink-0 text-slate-400" />
        <span>{node.name}</span>
      </div>
    );
  }

  return (
    <div>
      <button
        className="flex items-center gap-1 py-0.5 text-xs font-mono text-slate-600 hover:text-slate-900 w-full text-left"
        style={{ paddingLeft: `${depth * 12}px` }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <FolderOpen className="w-3 h-3 shrink-0 text-amber-500" />
        ) : (
          <Folder className="w-3 h-3 shrink-0 text-amber-500" />
        )}
        <span>{node.name}/</span>
      </button>
      {open &&
        node.children.map((child) => (
          <TreeNodeView key={child.path} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

export function GlobRenderer({ execution }: Props) {
  const { input } = execution;
  const pattern = input.pattern as string | undefined;

  const output = extractResultContent(execution.result);
  const files = output ? output.split('\n').filter(Boolean) : [];
  const tree = buildFileTree(files);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <FolderSearch className="w-4 h-4" />
        {pattern && (
          <code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded">{pattern}</code>
        )}
        <span className="text-xs text-slate-400">
          {files.length === 0
            ? 'No files matched'
            : `${files.length} file${files.length === 1 ? '' : 's'} matched`}
        </span>
      </div>
      {files.length > 0 && (
        <div className="bg-slate-50 rounded-lg p-3 max-h-64 overflow-y-auto">
          {tree.map((node) => (
            <TreeNodeView key={node.path} node={node} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}
