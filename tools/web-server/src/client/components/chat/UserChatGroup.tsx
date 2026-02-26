import React, { useState, useMemo } from 'react';
import { User } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatTimestampLong } from '../../utils/session-formatters.js';
import type { UserGroup } from '../../types/groups.js';

const COLLAPSE_THRESHOLD = 500;
const PATH_PATTERN = /@[^\s,)}\]]+/g;

interface Props {
  userGroup: UserGroup;
}

/**
 * Walks a text string, finds @path references, and wraps them in styled spans.
 * Uses the fileReferences from the group to validate which paths to highlight.
 */
function highlightTextNode(
  text: string,
  knownPaths: Set<string>,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const pattern = new RegExp(PATH_PATTERN.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const fullMatch = match[0];
    // Extract path (without @) and check if it's a known file reference
    const pathPart = fullMatch.slice(1);
    const isKnown = knownPaths.has(pathPart);

    if (isKnown) {
      parts.push(
        <span
          key={match.index}
          className="inline rounded px-1 py-0.5 font-mono text-xs"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
          }}
        >
          {fullMatch}
        </span>,
      );
    } else {
      parts.push(fullMatch);
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  if (parts.length === 0) return text;
  if (parts.length === 1) return parts[0];
  return <>{parts}</>;
}

/**
 * Recursively walks React children tree and highlights @path references in text nodes.
 */
function highlightPaths(
  children: React.ReactNode,
  knownPaths: Set<string>,
): React.ReactNode {
  return React.Children.map(children, (child): React.ReactNode => {
    if (typeof child === 'string') {
      return highlightTextNode(child, knownPaths);
    }

    if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.props.children) {
      return React.cloneElement(
        child,
        undefined,
        highlightPaths(child.props.children, knownPaths),
      );
    }

    return child;
  });
}

/**
 * Creates custom markdown components that apply @path highlighting.
 */
function createMarkdownComponents(knownPaths: Set<string>): Components {
  const hl = (children: React.ReactNode): React.ReactNode =>
    highlightPaths(children, knownPaths);

  return {
    p: ({ children }) => <p className="my-1">{hl(children)}</p>,
    ol: ({ children }) => (
      <ol className="my-1 list-decimal space-y-0.5 pl-5">
        {children}
      </ol>
    ),
    ul: ({ children }) => (
      <ul className="my-1 list-disc space-y-0.5 pl-5">
        {children}
      </ul>
    ),
    li: ({ children }) => <li className="text-sm">{hl(children)}</li>,
    h1: ({ children }) => <h1>{hl(children)}</h1>,
    h2: ({ children }) => <h2>{hl(children)}</h2>,
    h3: ({ children }) => <h3>{hl(children)}</h3>,
    td: ({ children }) => <td>{hl(children)}</td>,
    th: ({ children }) => <th>{hl(children)}</th>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-blue-400 pl-2 my-1">{hl(children)}</blockquote>
    ),
  };
}

export function UserChatGroup({ userGroup }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { content, timestamp } = userGroup;
  const text = content.rawText ?? content.text ?? '';
  const imageCount = content.images.length;
  const isLong = text.length > COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? text.slice(0, COLLAPSE_THRESHOLD) + '\u2026' : text;

  // Build set of known paths from extracted file references
  const knownPaths = useMemo(
    () => new Set(content.fileReferences.map((ref) => ref.path)),
    [content.fileReferences],
  );

  const markdownComponents = useMemo(
    () => createMarkdownComponents(knownPaths),
    [knownPaths],
  );

  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[80%] flex gap-2">
        <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm">
          {content.commands.length > 0 && (
            <div className="mb-1">
              {content.commands.map((cmd, i) => (
                <span key={i} className="inline-block text-xs bg-blue-500 text-blue-100 rounded px-1.5 py-0.5 mr-1">
                  /{cmd.name}{cmd.args ? ` ${cmd.args}` : ''}
                </span>
              ))}
            </div>
          )}
          {imageCount > 0 && (
            <span className="inline-block text-xs bg-blue-500 text-blue-100 rounded px-1.5 py-0.5 mb-1">
              [{imageCount} image{imageCount > 1 ? 's' : ''}]
            </span>
          )}
          <div className="prose prose-sm prose-invert max-w-none text-sm [&_pre]:bg-blue-700 [&_code]:bg-blue-700 [&_code]:text-blue-100">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {displayText}
            </ReactMarkdown>
          </div>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-200 hover:text-white underline mt-1"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
          <div className="text-xs text-blue-200 mt-1 text-right">
            {formatTimestampLong(timestamp)}
          </div>
        </div>
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
          <User className="w-4 h-4 text-blue-600" />
        </div>
      </div>
    </div>
  );
}
