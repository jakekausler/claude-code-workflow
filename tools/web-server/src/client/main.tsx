// Remote console logging — forwards all console.* to server log file
(() => {
  const originals = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

  function safeStringify(arg: unknown): string {
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }

  function remoteLog(level: string, args: unknown[]) {
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        args: args.map(safeStringify),
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {}); // fire-and-forget
  }

  for (const [level, orig] of Object.entries(originals)) {
    (console as any)[level] = (...args: unknown[]) => {
      orig(...args);
      remoteLog(level, args);
    };
  }

  // Clear log file on page load
  fetch('/api/log/clear', { method: 'POST' }).catch(() => {});
})();

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
