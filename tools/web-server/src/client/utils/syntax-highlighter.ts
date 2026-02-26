import React from 'react';

// =============================================================================
// Syntax Highlighting (Character-scanning tokenizer)
// =============================================================================

// Color palette (Tailwind-compatible hex values for dark backgrounds)
const COLORS = {
  string: '#c084fc',   // purple-400
  comment: '#6b7280',  // gray-500
  number: '#f59e0b',   // amber-500
  keyword: '#60a5fa',  // blue-400
  type: '#4ade80',     // green-400
  operator: '#94a3b8', // slate-400
} as const;

// Per-language keyword sets
const KEYWORDS: Record<string, Set<string>> = {
  typescript: new Set([
    'import', 'export', 'from', 'const', 'let', 'var', 'function', 'class',
    'interface', 'type', 'enum', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
    'new', 'this', 'super', 'extends', 'implements', 'async', 'await',
    'public', 'private', 'protected', 'static', 'readonly', 'abstract',
    'as', 'typeof', 'instanceof', 'in', 'of', 'keyof', 'void', 'never',
    'unknown', 'any', 'null', 'undefined', 'true', 'false', 'default',
  ]),
  javascript: new Set([
    'import', 'export', 'from', 'const', 'let', 'var', 'function', 'class',
    'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
    'continue', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super',
    'extends', 'async', 'await', 'typeof', 'instanceof', 'in', 'of',
    'void', 'null', 'undefined', 'true', 'false', 'default',
  ]),
  python: new Set([
    'import', 'from', 'as', 'def', 'class', 'return', 'if', 'elif', 'else',
    'for', 'while', 'break', 'continue', 'try', 'except', 'finally', 'raise',
    'with', 'pass', 'lambda', 'yield', 'global', 'nonlocal', 'assert',
    'and', 'or', 'not', 'in', 'is', 'True', 'False', 'None',
    'async', 'await', 'self', 'cls',
  ]),
  rust: new Set([
    'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait',
    'pub', 'mod', 'use', 'crate', 'self', 'super', 'where', 'for', 'loop',
    'while', 'if', 'else', 'match', 'return', 'break', 'continue', 'move',
    'ref', 'as', 'in', 'unsafe', 'async', 'await', 'dyn', 'true', 'false',
    'type', 'extern',
  ]),
  go: new Set([
    'package', 'import', 'func', 'var', 'const', 'type', 'struct', 'interface',
    'map', 'chan', 'go', 'defer', 'return', 'if', 'else', 'for', 'range',
    'switch', 'case', 'default', 'break', 'continue', 'fallthrough', 'select',
    'nil', 'true', 'false',
  ]),
  ruby: new Set([
    'def', 'class', 'module', 'end', 'do', 'if', 'elsif', 'else', 'unless',
    'while', 'until', 'for', 'in', 'begin', 'rescue', 'ensure', 'raise',
    'return', 'yield', 'block_given?', 'require', 'require_relative',
    'include', 'extend', 'attr_accessor', 'attr_reader', 'attr_writer',
    'self', 'super', 'nil', 'true', 'false', 'and', 'or', 'not', 'then',
    'when', 'case', 'lambda', 'proc', 'puts', 'print',
  ]),
  php: new Set([
    'function', 'class', 'interface', 'trait', 'extends', 'implements',
    'namespace', 'use', 'public', 'private', 'protected', 'static', 'abstract',
    'final', 'const', 'var', 'new', 'return', 'if', 'elseif', 'else', 'for',
    'foreach', 'while', 'do', 'switch', 'case', 'break', 'continue', 'default',
    'try', 'catch', 'finally', 'throw', 'as', 'echo', 'print', 'require',
    'require_once', 'include', 'include_once', 'true', 'false', 'null',
    'array', 'isset', 'unset', 'empty', 'self', 'this',
  ]),
  sql: new Set([
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'UPDATE', 'SET', 'DELETE',
    'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'VIEW', 'DATABASE',
    'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'FULL', 'CROSS', 'ON',
    'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL',
    'AS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'UNION',
    'ALL', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'BEGIN', 'COMMIT', 'ROLLBACK',
    'TRANSACTION', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT',
    'DEFAULT', 'VALUES', 'TRUE', 'FALSE',
    'INTEGER', 'VARCHAR', 'TEXT', 'BOOLEAN', 'DATE', 'TIMESTAMP',
  ]),
  r: new Set([
    'if', 'else', 'for', 'while', 'repeat', 'function', 'return', 'next',
    'break', 'in', 'library', 'require', 'source', 'TRUE', 'FALSE', 'NULL',
    'NA', 'Inf', 'NaN', 'NA_integer_', 'NA_real_', 'NA_complex_',
    'NA_character_',
  ]),
};

// Alias tsx/jsx to their base languages
KEYWORDS.tsx = KEYWORDS.typescript;
KEYWORDS.jsx = KEYWORDS.javascript;

// Languages that use # for line comments
const HASH_COMMENT_LANGUAGES = new Set(['python', 'bash', 'r', 'ruby', 'php']);

// Languages with built-in highlighting support even without keywords
const SUPPORTED_NO_KEYWORDS = new Set(['json', 'css', 'html', 'bash', 'markdown']);

/**
 * Map file extension (or filename) to language name.
 */
export function inferLanguage(filename: string): string {
  const base = filename.split('/').pop() || filename;

  // Special filenames
  if (base === 'Dockerfile') return 'docker';
  if (base === 'Makefile') return 'make';
  if (base.startsWith('.env')) return 'env';

  const ext = base.includes('.') ? base.split('.').pop()?.toLowerCase() : undefined;
  if (!ext) return '';

  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    pyw: 'python',
    pyx: 'python',
    rs: 'rust',
    go: 'go',
    rb: 'ruby',
    php: 'php',
    sql: 'sql',
    r: 'r',
    md: 'markdown',
    mdx: 'markdown',
    json: 'json',
    jsonl: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'text',
    xml: 'text',
    css: 'css',
    scss: 'css',
    sass: 'css',
    less: 'css',
    html: 'html',
    htm: 'html',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    env: 'text',
    gitignore: 'text',
    dockerignore: 'text',
    graphql: 'text',
    gql: 'text',
    vue: 'javascript',
    svelte: 'javascript',
    lua: 'text',
  };

  return map[ext] || 'text';
}

/**
 * Highlight a single line of source code. Returns an array of React nodes
 * (plain strings and styled <span> elements).
 */
export function highlightLine(line: string, language: string): React.ReactNode[] {
  const keywords = KEYWORDS[language] || new Set<string>();

  // If the language has no keywords and isn't one of our supported-by-default
  // languages, return the plain text.
  if (keywords.size === 0 && !SUPPORTED_NO_KEYWORDS.has(language)) {
    return [line];
  }

  const segments: React.ReactNode[] = [];
  let pos = 0;
  const len = line.length;

  while (pos < len) {
    const remaining = line.slice(pos);

    // --- String literals (double quote) ---
    if (remaining[0] === '"') {
      const end = findClosingQuote(remaining, '"');
      if (end !== -1) {
        const str = remaining.slice(0, end + 1);
        segments.push(
          React.createElement('span', { key: pos, style: { color: COLORS.string } }, str),
        );
        pos += str.length;
        continue;
      }
    }

    // --- String literals (single quote) ---
    if (remaining[0] === "'") {
      const end = findClosingQuote(remaining, "'");
      if (end !== -1) {
        const str = remaining.slice(0, end + 1);
        segments.push(
          React.createElement('span', { key: pos, style: { color: COLORS.string } }, str),
        );
        pos += str.length;
        continue;
      }
    }

    // --- Template literals (backtick) ---
    if (remaining[0] === '`') {
      const end = findClosingQuote(remaining, '`');
      if (end !== -1) {
        const str = remaining.slice(0, end + 1);
        segments.push(
          React.createElement('span', { key: pos, style: { color: COLORS.string } }, str),
        );
        pos += str.length;
        continue;
      }
    }

    // --- Line comment // ---
    if (remaining.startsWith('//')) {
      segments.push(
        React.createElement(
          'span',
          { key: pos, style: { color: COLORS.comment, fontStyle: 'italic' } },
          remaining,
        ),
      );
      break; // rest of line is comment
    }

    // --- Line comment # (Python/Bash/R/Ruby/PHP) ---
    if (HASH_COMMENT_LANGUAGES.has(language) && remaining[0] === '#') {
      segments.push(
        React.createElement(
          'span',
          { key: pos, style: { color: COLORS.comment, fontStyle: 'italic' } },
          remaining,
        ),
      );
      break;
    }

    // --- Line comment -- (SQL) ---
    if (language === 'sql' && remaining.startsWith('--')) {
      segments.push(
        React.createElement(
          'span',
          { key: pos, style: { color: COLORS.comment, fontStyle: 'italic' } },
          remaining,
        ),
      );
      break;
    }

    // --- Numbers ---
    const numberMatch = /^(\d+\.?\d*)/.exec(remaining);
    if (numberMatch && (pos === 0 || /\W/.test(line[pos - 1]))) {
      segments.push(
        React.createElement(
          'span',
          { key: pos, style: { color: COLORS.number } },
          numberMatch[1],
        ),
      );
      pos += numberMatch[1].length;
      continue;
    }

    // --- Words (keywords, types, identifiers) ---
    const wordMatch = /^([a-zA-Z_$][a-zA-Z0-9_$]*)/.exec(remaining);
    if (wordMatch) {
      const word = wordMatch[1];
      const isKeyword =
        keywords.has(word) || (language === 'sql' && keywords.has(word.toUpperCase()));

      if (isKeyword) {
        segments.push(
          React.createElement(
            'span',
            { key: pos, style: { color: COLORS.keyword, fontWeight: 500 } },
            word,
          ),
        );
      } else if (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase() && word.length > 1) {
        // Starts with uppercase letter → likely a type/class name
        segments.push(
          React.createElement('span', { key: pos, style: { color: COLORS.type } }, word),
        );
      } else {
        segments.push(word);
      }
      pos += word.length;
      continue;
    }

    // --- Operators and punctuation ---
    const opMatch = /^([=<>!+\-*/%&|^~?:;,.{}()[\]])/.exec(remaining);
    if (opMatch) {
      segments.push(
        React.createElement(
          'span',
          { key: pos, style: { color: COLORS.operator } },
          opMatch[1],
        ),
      );
      pos += 1;
      continue;
    }

    // --- Default: emit the character as-is ---
    segments.push(remaining[0]);
    pos += 1;
  }

  return segments;
}

/**
 * Find the index of the closing quote character, skipping escaped quotes.
 * Returns -1 if no closing quote is found. The search starts at index 1
 * (skipping the opening quote).
 */
function findClosingQuote(s: string, quote: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') {
      i++; // skip escaped character
      continue;
    }
    if (s[i] === quote) {
      return i;
    }
  }
  return -1;
}
