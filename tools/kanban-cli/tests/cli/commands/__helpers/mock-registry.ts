import type { RegistryDeps } from '../../../../src/repos/registry.js';

export interface MockDeps extends RegistryDeps {
  _files: Map<string, string>;
}

export function makeDeps(): MockDeps {
  const files = new Map<string, string>();
  return {
    registryPath: '/fake/.config/kanban-workflow/repos.yaml',
    readFile: (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    writeFile: (p: string, data: string) => {
      files.set(p, data);
    },
    existsSync: (p: string) => files.has(p),
    mkdirSync: () => {},
    _files: files,
  };
}
