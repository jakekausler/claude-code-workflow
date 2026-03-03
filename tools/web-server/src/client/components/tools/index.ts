import type { ComponentType } from 'react';
import type { ToolExecution } from '../../types/session.js';
import { ReadRenderer } from './ReadRenderer.js';
import { EditRenderer } from './EditRenderer.js';
import { WriteRenderer } from './WriteRenderer.js';
import { BashRenderer } from './BashRenderer.js';
import { GlobRenderer } from './GlobRenderer.js';
import { GrepRenderer } from './GrepRenderer.js';
import { SkillRenderer } from './SkillRenderer.js';
import { WebFetchRenderer } from './WebFetchRenderer.js';
import { NotebookEditRenderer } from './NotebookEditRenderer.js';
import { WebSearchRenderer } from './WebSearchRenderer.js';
import {
  TaskCreateRenderer,
  TaskUpdateRenderer,
  TaskListRenderer,
  TaskGetRenderer,
} from './TaskRenderers.js';
import { DefaultRenderer } from './DefaultRenderer.js';

type ToolRendererComponent = ComponentType<{ execution: ToolExecution }>;

const rendererMap: Record<string, ToolRendererComponent> = {
  Read: ReadRenderer,
  Edit: EditRenderer,
  Write: WriteRenderer,
  Bash: BashRenderer,
  Glob: GlobRenderer,
  Grep: GrepRenderer,
  Skill: SkillRenderer,
  NotebookEdit: NotebookEditRenderer,
  WebFetch: WebFetchRenderer,
  WebSearch: WebSearchRenderer,
  TaskCreate: TaskCreateRenderer,
  TaskUpdate: TaskUpdateRenderer,
  TaskList: TaskListRenderer,
  TaskGet: TaskGetRenderer,
};

export function getToolRenderer(toolName: string): ToolRendererComponent {
  return rendererMap[toolName] || DefaultRenderer;
}
