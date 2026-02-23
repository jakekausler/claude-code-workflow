import matter from 'gray-matter';
import { readFile, writeFile } from 'node:fs/promises';

/**
 * Parsed frontmatter result: the YAML data and the markdown content body.
 */
export interface FrontmatterData {
  data: Record<string, unknown>;
  content: string;
}

/**
 * Injectable dependencies for the Locker.
 * Defaults to real implementations; tests can override.
 */
export interface LockerDeps {
  readFrontmatter: (filePath: string) => Promise<FrontmatterData>;
  writeFrontmatter: (filePath: string, data: Record<string, unknown>, content: string) => Promise<void>;
}

/**
 * Lock management interface for stage files.
 * Uses frontmatter `session_active` field to track lock state.
 */
export interface Locker {
  acquireLock(stageFilePath: string): Promise<void>;
  releaseLock(stageFilePath: string): Promise<void>;
  isLocked(stageFilePath: string): Promise<boolean>;
  readStatus(stageFilePath: string): Promise<string>;
}

async function defaultReadFrontmatter(filePath: string): Promise<FrontmatterData> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = matter(raw);
  return { data: parsed.data, content: parsed.content };
}

async function defaultWriteFrontmatter(filePath: string, data: Record<string, unknown>, content: string): Promise<void> {
  const output = matter.stringify(content, data);
  await writeFile(filePath, output, 'utf-8');
}

const defaultDeps: LockerDeps = {
  readFrontmatter: defaultReadFrontmatter,
  writeFrontmatter: defaultWriteFrontmatter,
};

/**
 * Create a Locker instance that manages stage locks via frontmatter fields.
 */
export function createLocker(deps: Partial<LockerDeps> = {}): Locker {
  const { readFrontmatter, writeFrontmatter } = { ...defaultDeps, ...deps };

  return {
    async acquireLock(stageFilePath: string): Promise<void> {
      const { data, content } = await readFrontmatter(stageFilePath);

      if (data.session_active === true) {
        throw new Error(`Stage already locked: ${stageFilePath}`);
      }

      data.session_active = true;
      await writeFrontmatter(stageFilePath, data, content);
    },

    async releaseLock(stageFilePath: string): Promise<void> {
      const { data, content } = await readFrontmatter(stageFilePath);

      data.session_active = false;
      await writeFrontmatter(stageFilePath, data, content);
    },

    async isLocked(stageFilePath: string): Promise<boolean> {
      const { data } = await readFrontmatter(stageFilePath);
      return data.session_active === true;
    },

    async readStatus(stageFilePath: string): Promise<string> {
      const { data } = await readFrontmatter(stageFilePath);

      if (data.status === undefined || data.status === null) {
        throw new Error(`Missing status field in frontmatter of ${stageFilePath}`);
      }

      if (typeof data.status !== 'string') {
        throw new Error(`Invalid status type in frontmatter of ${stageFilePath}: expected string, got ${typeof data.status}`);
      }

      return data.status;
    },
  };
}
