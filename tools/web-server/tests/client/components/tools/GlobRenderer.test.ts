import { describe, it, expect } from 'vitest';
import { buildFileTree } from '../../../../src/client/components/tools/GlobRenderer.js';

describe('buildFileTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it('returns a single file at root level', () => {
    const tree = buildFileTree(['file.ts']);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'file.ts', isFile: true, children: [] });
  });

  it('groups files under a shared directory', () => {
    const tree = buildFileTree(['src/a.ts', 'src/b.ts']);
    expect(tree).toHaveLength(1);
    const src = tree[0];
    expect(src.name).toBe('src');
    expect(src.isFile).toBe(false);
    expect(src.children).toHaveLength(2);
    expect(src.children.map((c) => c.name)).toEqual(['a.ts', 'b.ts']);
  });

  it('handles deeply nested paths', () => {
    const tree = buildFileTree(['a/b/c/deep.ts']);
    expect(tree[0].name).toBe('a');
    expect(tree[0].children[0].name).toBe('b');
    expect(tree[0].children[0].children[0].name).toBe('c');
    expect(tree[0].children[0].children[0].children[0]).toMatchObject({
      name: 'deep.ts',
      isFile: true,
    });
  });

  it('merges common directory prefixes', () => {
    const tree = buildFileTree(['src/utils/foo.ts', 'src/utils/bar.ts', 'src/index.ts']);
    expect(tree).toHaveLength(1);
    const src = tree[0];
    expect(src.name).toBe('src');
    // Should have utils/ dir and index.ts
    const names = src.children.map((c) => c.name).sort();
    expect(names).toEqual(['index.ts', 'utils']);
    const utils = src.children.find((c) => c.name === 'utils')!;
    expect(utils.isFile).toBe(false);
    expect(utils.children).toHaveLength(2);
  });

  it('handles files with leading slash', () => {
    const tree = buildFileTree(['/src/main.ts']);
    expect(tree[0].name).toBe('src');
    expect(tree[0].children[0].name).toBe('main.ts');
  });

  it('handles multiple top-level directories', () => {
    const tree = buildFileTree(['src/a.ts', 'tests/b.test.ts']);
    const names = tree.map((n) => n.name).sort();
    expect(names).toEqual(['src', 'tests']);
  });

  it('does not duplicate nodes for repeated paths', () => {
    const tree = buildFileTree(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(3);
  });

  it('marks directories as non-file nodes', () => {
    const tree = buildFileTree(['dir/file.ts']);
    expect(tree[0].isFile).toBe(false);
    expect(tree[0].children[0].isFile).toBe(true);
  });

  it('sets correct path on each node', () => {
    const tree = buildFileTree(['a/b/c.ts']);
    expect(tree[0].path).toBe('a');
    expect(tree[0].children[0].path).toBe('a/b');
    expect(tree[0].children[0].children[0].path).toBe('a/b/c.ts');
  });
});
