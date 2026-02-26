import React, { useMemo, useState } from 'react';
import { FileCode, Copy, Check } from 'lucide-react';
import { inferLanguage, highlightLine } from '../../utils/syntax-highlighter.js';

interface CodeBlockViewerProps {
  fileName: string;
  content: string;
  language?: string;
  startLine?: number;
  endLine?: number;
  maxHeight?: string;
}

function getBaseName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

export function CodeBlockViewer({
  fileName,
  content,
  language,
  startLine = 1,
  endLine,
  maxHeight = 'max-h-96',
}: CodeBlockViewerProps) {
  const [isCopied, setIsCopied] = useState(false);

  const detectedLanguage = language ?? inferLanguage(fileName);
  const lines = useMemo(() => content.split('\n'), [content]);
  const totalLines = lines.length;
  const actualEndLine = endLine ?? startLine + totalLines - 1;

  const gutterChars = String(actualEndLine).length;

  const handleCopy = async () => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        // Fallback for non-HTTPS contexts
        const textarea = document.createElement('textarea');
        textarea.value = content;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Clipboard not available at all
    }
  };

  const displayFileName = getBaseName(fileName);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-700 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode className="w-4 h-4 shrink-0 text-slate-400" />
          <span
            className="truncate font-mono text-xs text-slate-300"
            title={fileName}
          >
            {displayFileName}
          </span>
          {(startLine > 1 || endLine) && (
            <span className="shrink-0 text-xs text-slate-500">
              (lines {startLine}-{actualEndLine})
            </span>
          )}
          {detectedLanguage && detectedLanguage !== 'text' && (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-xs bg-slate-700 text-slate-400 border border-slate-600">
              {detectedLanguage}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="rounded p-1 hover:bg-slate-700 transition-colors"
          title="Copy to clipboard"
        >
          {isCopied ? (
            <Check className="w-4 h-4 text-green-400" />
          ) : (
            <Copy className="w-4 h-4 text-slate-400" />
          )}
        </button>
      </div>

      {/* Code content */}
      <div className={`overflow-auto ${maxHeight} bg-slate-900`}>
        <pre className="m-0 bg-transparent p-0">
          <code className="block font-mono text-xs leading-relaxed">
            {lines.map((line, index) => {
              const lineNumber = startLine + index;
              return (
                <div key={index} className="flex hover:bg-slate-800/50">
                  <span
                    className="shrink-0 select-none py-0.5 text-right text-slate-500 border-r border-slate-700"
                    style={{ width: `${gutterChars + 2}ch`, paddingLeft: '0.5rem', paddingRight: '0.75rem' }}
                  >
                    {lineNumber}
                  </span>
                  <span className="flex-1 whitespace-pre px-4 py-0.5 text-slate-100">
                    {detectedLanguage ? highlightLine(line, detectedLanguage) : line}
                  </span>
                </div>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}
