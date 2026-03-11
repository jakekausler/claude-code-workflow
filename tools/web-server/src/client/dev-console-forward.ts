// Reset log file synchronously on page load/refresh — must complete before any
// console patching so that early logs are never lost to a late-arriving reset.
const xhr = new XMLHttpRequest();
xhr.open('POST', '/api/dev/logs/reset', false); // synchronous
xhr.send();

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function forwardLog(level: string, args: unknown[]): void {
  const message = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');

  fetch('/api/dev/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, message, timestamp: new Date().toISOString() }),
  }).catch(() => {});
}

console.log = (...args: unknown[]) => {
  originalLog.apply(console, args);
  forwardLog('log', args);
};

console.warn = (...args: unknown[]) => {
  originalWarn.apply(console, args);
  forwardLog('warn', args);
};

console.error = (...args: unknown[]) => {
  originalError.apply(console, args);
  forwardLog('error', args);
};
