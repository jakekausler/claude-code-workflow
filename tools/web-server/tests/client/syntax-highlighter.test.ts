import { describe, it, expect } from 'vitest';
import { inferLanguage, highlightLine } from '../../src/client/utils/syntax-highlighter.js';
import React from 'react';

// Helper: extract the text content from a ReactNode array
function textOf(nodes: React.ReactNode[]): string {
  return nodes
    .map((n) => {
      if (typeof n === 'string') return n;
      if (React.isValidElement(n)) {
        const children = (n.props as { children?: React.ReactNode }).children;
        return typeof children === 'string' ? children : '';
      }
      return '';
    })
    .join('');
}

// Helper: find span nodes that have a specific color style
function spansWithColor(nodes: React.ReactNode[], color: string): string[] {
  return nodes
    .filter((n): n is React.ReactElement => {
      if (!React.isValidElement(n)) return false;
      const style = (n.props as { style?: { color?: string } }).style;
      return style?.color === color;
    })
    .map((n) => {
      const children = (n.props as { children?: React.ReactNode }).children;
      return typeof children === 'string' ? children : '';
    });
}

describe('syntax-highlighter', () => {
  // =========================================================================
  // inferLanguage
  // =========================================================================
  describe('inferLanguage', () => {
    it('maps .ts to typescript', () => {
      expect(inferLanguage('app.ts')).toBe('typescript');
    });

    it('maps .tsx to typescript', () => {
      expect(inferLanguage('Component.tsx')).toBe('typescript');
    });

    it('maps .js to javascript', () => {
      expect(inferLanguage('index.js')).toBe('javascript');
    });

    it('maps .jsx to javascript', () => {
      expect(inferLanguage('App.jsx')).toBe('javascript');
    });

    it('maps .py to python', () => {
      expect(inferLanguage('script.py')).toBe('python');
    });

    it('maps .rs to rust', () => {
      expect(inferLanguage('main.rs')).toBe('rust');
    });

    it('maps .go to go', () => {
      expect(inferLanguage('server.go')).toBe('go');
    });

    it('maps .rb to ruby', () => {
      expect(inferLanguage('app.rb')).toBe('ruby');
    });

    it('maps .php to php', () => {
      expect(inferLanguage('index.php')).toBe('php');
    });

    it('maps .sql to sql', () => {
      expect(inferLanguage('query.sql')).toBe('sql');
    });

    it('maps .r to r', () => {
      expect(inferLanguage('analysis.r')).toBe('r');
    });

    it('maps .md to markdown', () => {
      expect(inferLanguage('README.md')).toBe('markdown');
    });

    it('maps .mdx to markdown', () => {
      expect(inferLanguage('docs.mdx')).toBe('markdown');
    });

    it('maps .json to json', () => {
      expect(inferLanguage('package.json')).toBe('json');
    });

    it('maps .yaml and .yml to yaml', () => {
      expect(inferLanguage('config.yaml')).toBe('yaml');
      expect(inferLanguage('ci.yml')).toBe('yaml');
    });

    it('maps .css to css', () => {
      expect(inferLanguage('styles.css')).toBe('css');
    });

    it('maps .html and .htm to html', () => {
      expect(inferLanguage('index.html')).toBe('html');
      expect(inferLanguage('page.htm')).toBe('html');
    });

    it('maps .sh/.bash/.zsh to bash', () => {
      expect(inferLanguage('script.sh')).toBe('bash');
      expect(inferLanguage('build.bash')).toBe('bash');
      expect(inferLanguage('init.zsh')).toBe('bash');
    });

    it('maps Dockerfile to docker', () => {
      expect(inferLanguage('Dockerfile')).toBe('docker');
    });

    it('maps Makefile to make', () => {
      expect(inferLanguage('Makefile')).toBe('make');
    });

    it('maps .env* to env', () => {
      expect(inferLanguage('.env')).toBe('env');
      expect(inferLanguage('.env.local')).toBe('env');
      expect(inferLanguage('.env.production')).toBe('env');
    });

    it('handles full paths', () => {
      expect(inferLanguage('/home/user/project/src/main.rs')).toBe('rust');
    });

    it('returns empty string for unknown extensions', () => {
      expect(inferLanguage('file.xyz')).toBe('');
    });

    it('returns empty string for no extension', () => {
      expect(inferLanguage('LICENSE')).toBe('');
    });
  });

  // =========================================================================
  // highlightLine
  // =========================================================================
  describe('highlightLine', () => {
    it('returns plain text for unknown language', () => {
      const result = highlightLine('hello world', 'unknown');
      expect(result).toEqual(['hello world']);
    });

    it('returns empty array content for empty line', () => {
      const result = highlightLine('', 'typescript');
      // Empty string → nothing emitted, segments stays empty
      expect(result).toEqual([]);
    });

    it('highlights keywords in typescript', () => {
      const result = highlightLine('const x = 42;', 'typescript');
      const keywords = spansWithColor(result, '#60a5fa');
      expect(keywords).toContain('const');
    });

    it('highlights string literals with double quotes', () => {
      const result = highlightLine('const s = "hello";', 'typescript');
      const strings = spansWithColor(result, '#c084fc');
      expect(strings).toContain('"hello"');
    });

    it('highlights string literals with single quotes', () => {
      const result = highlightLine("const s = 'world';", 'typescript');
      const strings = spansWithColor(result, '#c084fc');
      expect(strings).toContain("'world'");
    });

    it('highlights template literals', () => {
      const result = highlightLine('const s = `tmpl`;', 'typescript');
      const strings = spansWithColor(result, '#c084fc');
      expect(strings).toContain('`tmpl`');
    });

    it('highlights numbers', () => {
      const result = highlightLine('let n = 3.14;', 'typescript');
      const numbers = spansWithColor(result, '#f59e0b');
      expect(numbers).toContain('3.14');
    });

    it('highlights // comments (rest of line)', () => {
      const result = highlightLine('x = 1; // comment', 'typescript');
      const comments = spansWithColor(result, '#6b7280');
      expect(comments.length).toBe(1);
      expect(comments[0]).toBe('// comment');
    });

    it('highlights # comments for python', () => {
      const result = highlightLine('x = 1 # note', 'python');
      const comments = spansWithColor(result, '#6b7280');
      expect(comments.length).toBe(1);
      expect(comments[0]).toBe('# note');
    });

    it('highlights -- comments for sql', () => {
      const result = highlightLine('SELECT 1 -- pick', 'sql');
      const comments = spansWithColor(result, '#6b7280');
      expect(comments.length).toBe(1);
      expect(comments[0]).toBe('-- pick');
    });

    it('highlights type-like words (uppercase start)', () => {
      const result = highlightLine('new MyClass();', 'typescript');
      const types = spansWithColor(result, '#4ade80');
      expect(types).toContain('MyClass');
    });

    it('highlights operators', () => {
      const result = highlightLine('a + b', 'typescript');
      const ops = spansWithColor(result, '#94a3b8');
      expect(ops).toContain('+');
    });

    it('reconstructs full line text from segments', () => {
      const line = 'const x: number = 42; // answer';
      const result = highlightLine(line, 'typescript');
      expect(textOf(result)).toBe(line);
    });

    it('handles a comment-only line', () => {
      const result = highlightLine('// entire line is comment', 'typescript');
      expect(result.length).toBe(1);
      const comments = spansWithColor(result, '#6b7280');
      expect(comments).toContain('// entire line is comment');
    });

    it('handles line with only whitespace', () => {
      const result = highlightLine('   ', 'typescript');
      // whitespace characters emitted one at a time as plain text
      expect(textOf(result)).toBe('   ');
    });

    it('handles SQL keywords case-insensitively', () => {
      const result = highlightLine('select id from users', 'sql');
      const keywords = spansWithColor(result, '#60a5fa');
      expect(keywords).toContain('select');
      expect(keywords).toContain('from');
    });

    it('handles escaped quotes in strings', () => {
      const result = highlightLine('const s = "he said \\"hi\\"";', 'typescript');
      const strings = spansWithColor(result, '#c084fc');
      // The escaped string should be captured properly
      expect(strings.length).toBeGreaterThan(0);
      // The full text should reconstruct
      expect(textOf(result)).toBe('const s = "he said \\"hi\\"";');
    });

    it('handles python keywords', () => {
      const result = highlightLine('def foo(self):', 'python');
      const keywords = spansWithColor(result, '#60a5fa');
      expect(keywords).toContain('def');
      expect(keywords).toContain('self');
    });

    it('handles rust keywords', () => {
      const result = highlightLine('fn main() {', 'rust');
      const keywords = spansWithColor(result, '#60a5fa');
      expect(keywords).toContain('fn');
    });

    it('handles go keywords', () => {
      const result = highlightLine('func main() {', 'go');
      const keywords = spansWithColor(result, '#60a5fa');
      expect(keywords).toContain('func');
    });

    it('handles ruby keywords', () => {
      const result = highlightLine('def hello', 'ruby');
      const keywords = spansWithColor(result, '#60a5fa');
      expect(keywords).toContain('def');
    });

    it('handles php keywords', () => {
      const result = highlightLine('function test() {', 'php');
      const keywords = spansWithColor(result, '#60a5fa');
      expect(keywords).toContain('function');
    });

    it('handles json (supported without keywords)', () => {
      const result = highlightLine('{ "key": "value" }', 'json');
      // Should have some styled spans (strings, operators)
      const strings = spansWithColor(result, '#c084fc');
      expect(strings.length).toBeGreaterThan(0);
    });
  });
});
