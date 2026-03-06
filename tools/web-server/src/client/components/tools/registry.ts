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

export type ToolRendererComponent = ComponentType<{ execution: ToolExecution }>;

// Built-in renderers registered at module load
const builtinRegistry: Record<string, ToolRendererComponent> = {
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

// Runtime-registered custom renderers (override builtins)
const customRegistry: Record<string, ToolRendererComponent> = {};

export function registerToolRenderer(toolName: string, component: ToolRendererComponent): void {
  customRegistry[toolName] = component;
}

export function getToolRenderer(toolName: string): ToolRendererComponent {
  return customRegistry[toolName] ?? builtinRegistry[toolName] ?? DefaultRenderer;
}
